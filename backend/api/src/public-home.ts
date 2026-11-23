import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { BadRequestException, Controller, ForbiddenException, Get, Headers, HttpException, NotFoundException, Param, Query, Res, StreamableFile } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { Public } from './auth.js';
import { mediaConfig, mediaDir, uuidPattern } from './media-common.js';

const localePattern = /^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/;
const coverKeyPattern = /^[0-9a-f-]{36}\.(?:jpg|png|webp)$/;
const mimeTypes: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
type JsonRecord = Record<string, unknown>;
type Response = { setHeader(name: string, value: string | number): void; status(code: number): void };
type PublicStoryItem = {
  id: string;
  title: string;
  description: string | null;
  categoryId: string | null;
  categoryName: string | null;
  tags: string[];
  tagIds: string[];
  episodeCount: number;
  totalEpisodeCount: number | null;
  coverUrl: string | null;
  sortOrder: number;
  publishedAt: string;
  actorNames?: string[];
};

function record(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonRecord : null;
}

function localized(rows: unknown, locale: string, field: string, fallbackToEnglish = false): string | null {
  if (!Array.isArray(rows)) return null;
  const translations = rows.map(record).filter((row): row is JsonRecord => row !== null);
  const match = translations.find((row) => typeof row.locale === 'string' && row.locale.toLowerCase() === locale.toLowerCase());
  const english = fallbackToEnglish
    ? translations.find((row) => typeof row.locale === 'string' && row.locale.toLowerCase() === 'en')
    : undefined;
  const value = match?.[field] ?? english?.[field];
  return typeof value === 'string' && value.trim() ? value : null;
}

function validCoverKey(snapshot: JsonRecord): string | null {
  return typeof snapshot.coverKey === 'string' && coverKeyPattern.test(snapshot.coverKey)
    ? snapshot.coverKey
    : null;
}

function publicTags(snapshot: JsonRecord, locale: string, knownTagIds: Set<string>, systemTagIds: Set<string>): string[] {
  if (!Array.isArray(snapshot.tags)) return [];
  const names = snapshot.tags.flatMap((value) => {
    const tag = record(value);
    if (!tag || typeof tag.id !== 'string' || !knownTagIds.has(tag.id) || systemTagIds.has(tag.id)) return [];
    const name = localized(tag.names, locale, 'name', true);
    return name ? [name] : [];
  });
  return [...new Set(names)];
}

function publicTagIds(snapshot: JsonRecord, knownTagIds: Set<string>, systemTagIds: Set<string>): string[] {
  if (!Array.isArray(snapshot.tags)) return [];
  return [...new Set(snapshot.tags.flatMap((value) => {
    const tag = record(value);
    return tag && typeof tag.id === 'string' && knownTagIds.has(tag.id) && !systemTagIds.has(tag.id) ? [tag.id] : [];
  }))];
}

function publicActors(snapshot: JsonRecord): { name: string; roleName: string | null }[] {
  if (!Array.isArray(snapshot.actors)) return [];
  return snapshot.actors.flatMap((value) => {
    const actor = record(value);
    if (!actor || typeof actor.name !== 'string' || !actor.name.trim()) return [];
    const roleName = typeof actor.roleName === 'string' && actor.roleName.trim() ? actor.roleName.trim() : null;
    return [{ name: actor.name.trim(), roleName }];
  });
}

async function publicStories(prisma: PrismaService, locale: string, ids?: string[], includeActorNames = false): Promise<PublicStoryItem[]> {
  if (ids && ids.length === 0) return [];
  const [tags, rows] = await Promise.all([
    prisma.tag.findMany({ select: { id: true, systemKey: true } }),
    prisma.drama.findMany({
      where: {
        status: 'PUBLISHED', publication: { isNot: null }, episodes: { some: { status: 'PUBLISHED' } },
        ...(ids ? { id: { in: ids } } : {}),
      },
      select: {
        id: true,
        publication: { select: { snapshot: true, publishedAt: true } },
        episodes: { where: { status: 'PUBLISHED' }, select: { id: true } },
      },
    }),
  ]);
  const knownTagIds = new Set(tags.map((tag) => tag.id));
  const systemTagIds = new Set(tags.filter((tag) => tag.systemKey !== null).map((tag) => tag.id));
  const items = rows.flatMap((drama): PublicStoryItem[] => {
    const snapshot = record(drama.publication?.snapshot);
    if (!snapshot) return [];
    const title = localized(snapshot.translations, locale, 'title', true);
    if (!title) return [];

    const requestedOrder = snapshot.sortOrder;
    const sortOrder = typeof requestedOrder === 'number' && Number.isSafeInteger(requestedOrder) && requestedOrder >= 0
      ? requestedOrder
      : 0;
    const requestedTotal = snapshot.totalEpisodes;
    const totalEpisodeCount = typeof requestedTotal === 'number' && Number.isSafeInteger(requestedTotal) && requestedTotal > 0
      ? requestedTotal
      : null;
    const coverKey = validCoverKey(snapshot);

    return [{
      id: drama.id,
      title,
      description: localized(snapshot.translations, locale, 'description', true),
      categoryId: typeof snapshot.categoryId === 'string' ? snapshot.categoryId : null,
      categoryName: localized(snapshot.categoryNames, locale, 'name', true),
      tags: publicTags(snapshot, locale, knownTagIds, systemTagIds),
      tagIds: publicTagIds(snapshot, knownTagIds, systemTagIds),
      episodeCount: drama.episodes.length,
      totalEpisodeCount,
      coverUrl: coverKey ? '/api/public/dramas/' + drama.id + '/cover' : null,
      sortOrder,
      publishedAt: drama.publication!.publishedAt.toISOString(),
      ...(includeActorNames ? { actorNames: publicActors(snapshot).map((actor) => actor.name) } : {}),
    }];
  });

  items.sort((a, b) => a.sortOrder - b.sortOrder
    || Date.parse(b.publishedAt) - Date.parse(a.publishedAt)
    || a.id.localeCompare(b.id));
  return items;
}

@Controller('api/public')
export class PublicHomeController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get('search')
  async search(@Query('q') requestedQuery?: string, @Query('locale') requestedLocale?: string) {
    const locale = requestedLocale || 'en';
    if (!localePattern.test(locale)) throw new BadRequestException('Invalid locale');

    const query = (requestedQuery || '').normalize('NFKC').trim().slice(0, 120).toLowerCase();
    if (!query) return { items: [] };

    const terms = query.split(/\s+/).filter(Boolean);
    const items = await publicStories(this.prisma, locale, undefined, true);
    const matches = items.flatMap((item, index) => {
      const normalizedTitle = item.title.normalize('NFKC').toLowerCase();
      const description = (item.description || '').normalize('NFKC').toLowerCase();
      const categoryName = (item.categoryName || '').normalize('NFKC').toLowerCase();
      const tags = item.tags.map((tag) => tag.normalize('NFKC').toLowerCase());
      const actorNames = (item.actorNames || []).map((name) => name.normalize('NFKC').toLowerCase());
      const searchableContent = [normalizedTitle, description, categoryName, ...tags, ...actorNames];
      if (!terms.every((term) => searchableContent.some((field) => field.includes(term)))) return [];

      const score = terms.reduce((total, term) => total
        + (normalizedTitle.includes(term) ? 4 : description.includes(term) ? 2 : 1), 0);
      return [{ item, index, score }];
    });

    matches.sort((a, b) => b.score - a.score || a.index - b.index);
    return { items: matches.map(({ item }) => {
      const { actorNames: _actorNames, ...story } = item;
      return story;
    }) };
  }

  @Public()
  @Get('home')
  async home(@Query('locale') requestedLocale?: string) {
    const locale = requestedLocale || 'en';
    if (!localePattern.test(locale)) throw new BadRequestException('Invalid locale');
    const configuration = await this.prisma.homeConfiguration.findUnique({ where: { id: 'default' } });

    if (!configuration?.configured) {
      const popular = await this.stories(locale);
      return {
        featured: { items: [] },
        popular: { items: popular.items },
        ranking: { period: 'manual', updatedAt: null, items: [] },
      };
    }

    const ids = (value: unknown): string[] => Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string' && uuidPattern.test(item))
      : [];
    const featuredIds = ids(configuration.featured);
    const popularIds = ids(configuration.popular);
    const rankingIds = ids(configuration.ranking);
    const byId = new Map((await publicStories(this.prisma, locale, [...new Set([...featuredIds, ...popularIds, ...rankingIds])])).map((item) => [item.id, item]));
    const inOrder = (sectionIds: string[]) => sectionIds.flatMap((id) => {
      const item = byId.get(id);
      return item ? [item] : [];
    });
    return {
      featured: { items: inOrder(featuredIds) },
      popular: { items: inOrder(popularIds) },
      ranking: {
        period: 'manual',
        updatedAt: configuration.updatedAt.toISOString(),
        items: inOrder(rankingIds).map((item, index) => ({ ...item, rank: index + 1 })),
      },
    };
  }

  @Public()
  @Get('taxonomy')
  async taxonomy(@Query('locale') requestedLocale?: string) {
    const locale = requestedLocale || 'en';
    if (!localePattern.test(locale)) throw new BadRequestException('Invalid locale');

    const [categories, tags] = await Promise.all([
      this.prisma.category.findMany({ where: { active: true }, include: { translations: true }, orderBy: { id: 'asc' } }),
      this.prisma.tag.findMany({ where: { active: true, systemKey: null }, include: { translations: true }, orderBy: { id: 'asc' } }),
    ]);

    return {
      categories: categories.flatMap((category) => {
        const name = localized(category.translations, locale, 'name', true);
        return name ? [{ id: category.id, name }] : [];
      }),
      tags: tags.flatMap((tag) => {
        const name = localized(tag.translations, locale, 'name', true);
        return name ? [{ id: tag.id, name }] : [];
      }),
    };
  }

  @Public()
  @Get('home/featured')
  async featured(@Query('locale') requestedLocale?: string) {
    const locale = requestedLocale || 'en';
    if (!localePattern.test(locale)) throw new BadRequestException('Invalid locale');

    const configuration = await this.prisma.homeConfiguration.findUnique({ where: { id: 'default' } });
    if (configuration?.configured) {
      const featuredIds = Array.isArray(configuration.featured)
        ? configuration.featured.filter((id): id is string => typeof id === 'string' && uuidPattern.test(id))
        : [];
      const byId = new Map((await publicStories(this.prisma, locale, featuredIds)).map((item) => [item.id, item]));
      return {
        items: featuredIds.flatMap((id) => {
          const item = byId.get(id);
          if (!item) return [];
          const { title, description, categoryName, episodeCount, totalEpisodeCount, coverUrl, sortOrder, publishedAt } = item;
          return [{ id, title, description, categoryName, episodeCount, totalEpisodeCount, coverUrl, sortOrder, publishedAt }];
        }),
      };
    }

    return { items: [] };
  }

  @Public()
  @Get('home/stories')
  async stories(@Query('locale') requestedLocale?: string) {
    const locale = requestedLocale || 'en';
    if (!localePattern.test(locale)) throw new BadRequestException('Invalid locale');
    const items = await publicStories(this.prisma, locale);
    return { items: items.slice(0, 100) };
  }

  @Public()
  @Get('dramas/:id')
  async dramaDetail(@Param('id') id: string, @Query('locale') requestedLocale?: string) {
    if (!uuidPattern.test(id)) throw new NotFoundException();
    const locale = requestedLocale || 'en';
    if (!localePattern.test(locale)) throw new BadRequestException('Invalid locale');

    const [tags, drama] = await Promise.all([
      this.prisma.tag.findMany({ select: { id: true, systemKey: true } }),
      this.prisma.drama.findFirst({
        where: { id, status: 'PUBLISHED', publication: { isNot: null } },
        select: {
          id: true,
          publication: { select: { snapshot: true } },
          episodes: {
            where: { status: 'PUBLISHED', publication: { isNot: null } },
            orderBy: { number: 'asc' },
            select: { id: true, number: true, publication: { select: { snapshot: true } } },
          },
        },
      }),
    ]);
    const snapshot = record(drama?.publication?.snapshot);
    if (!drama || !snapshot) throw new NotFoundException();
    const title = localized(snapshot.translations, locale, 'title', true);
    if (!title) throw new NotFoundException();

    const requestedTotal = snapshot.totalEpisodes;
    const totalEpisodeCount = typeof requestedTotal === 'number' && Number.isSafeInteger(requestedTotal) && requestedTotal > 0
      ? requestedTotal
      : null;
    const coverKey = validCoverKey(snapshot);
    const isChinese = locale.toLowerCase().startsWith('zh');
    const knownTagIds = new Set(tags.map((tag) => tag.id));
    const systemTagIds = new Set(tags.filter((tag) => tag.systemKey !== null).map((tag) => tag.id));
    const episodes = drama.episodes.flatMap((episode) => {
      const episodeSnapshot = record(episode.publication?.snapshot);
      if (!episodeSnapshot) return [];
      const effectivePrice = record(episodeSnapshot.effectivePrice);
      const credits = effectivePrice?.credits;
      return [{
        id: episode.id,
        number: episode.number,
        title: localized(episodeSnapshot.translations, locale, 'title', true) ?? (isChinese ? `第 ${episode.number} 集` : `Episode ${episode.number}`),
        isFree: effectivePrice?.mode === 'FREE',
        priceCredits: effectivePrice?.mode === 'CREDITS' && typeof credits === 'number' && Number.isSafeInteger(credits) && credits > 0 ? credits : null,
      }];
    });

    return {
      id: drama.id,
      title,
      description: localized(snapshot.translations, locale, 'description', true),
      categoryName: localized(snapshot.categoryNames, locale, 'name', true),
      tags: publicTags(snapshot, locale, knownTagIds, systemTagIds),
      actors: publicActors(snapshot),
      episodeCount: episodes.length,
      totalEpisodeCount,
      coverUrl: coverKey ? '/api/public/dramas/' + drama.id + '/cover' : null,
      episodes,
    };
  }

  @Public()
  @Get('dramas/:dramaId/episodes/:episodeId/video')
  async publicEpisodeVideo(
    @Param('dramaId') dramaId: string,
    @Param('episodeId') episodeId: string,
    @Headers('range') range: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!uuidPattern.test(dramaId) || !uuidPattern.test(episodeId)) throw new NotFoundException();
    const episode = await this.prisma.episode.findUnique({
      where: { id: episodeId },
      select: {
        id: true,
        dramaId: true,
        status: true,
        publication: { select: { snapshot: true } },
        drama: { select: { status: true, publication: { select: { snapshot: true } } } },
      },
    });
    const episodeSnapshot = record(episode?.publication?.snapshot);
    const dramaSnapshot = record(episode?.drama.publication?.snapshot);
    if (!episode || episode.dramaId !== dramaId || episode.status !== 'PUBLISHED' || episode.drama.status !== 'PUBLISHED' || !episodeSnapshot || !dramaSnapshot) {
      throw new NotFoundException();
    }
    if (record(episodeSnapshot.effectivePrice)?.mode !== 'FREE') throw new ForbiddenException('Episode is locked');

    const mediaId = episodeSnapshot.mediaId;
    const mediaFingerprint = episodeSnapshot.mediaFingerprint;
    if (typeof mediaId !== 'string' || !uuidPattern.test(mediaId) || typeof mediaFingerprint !== 'string') throw new NotFoundException();
    const media = await this.prisma.mediaUpload.findUnique({
      where: { id: mediaId },
      select: { episodeId: true, fingerprint: true, transcodeStatus: true },
    });
    if (!media || media.episodeId !== episode.id || media.fingerprint !== mediaFingerprint || media.transcodeStatus !== 'SUCCEEDED') {
      throw new NotFoundException();
    }

    const path = join(mediaDir(mediaId), 'output.mp4');
    let size: number;
    try { size = (await stat(path)).size; } catch { throw new NotFoundException(); }
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    if (!range) {
      res.setHeader('Content-Length', size);
      return new StreamableFile(createReadStream(path));
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) {
      res.setHeader('Content-Range', `bytes */${size}`);
      throw new HttpException('Invalid range', 416);
    }
    const suffix = !match[1] ? Number(match[2]) : null;
    const start = suffix === null ? Number(match[1]) : Math.max(0, size - suffix);
    const end = suffix === null && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
      res.setHeader('Content-Range', `bytes */${size}`);
      throw new HttpException('Invalid range', 416);
    }
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.setHeader('Content-Length', end - start + 1);
    return new StreamableFile(createReadStream(path, { start, end }));
  }

  @Public()
  @Get('dramas/:id/cover')
  async publishedCover(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    if (!uuidPattern.test(id)) throw new NotFoundException();
    const drama = await this.prisma.drama.findUnique({ where: { id }, select: { status: true, publication: { select: { snapshot: true } } } });
    const snapshot = record(drama?.publication?.snapshot);
    const coverKey = snapshot ? validCoverKey(snapshot) : null;
    if (drama?.status !== 'PUBLISHED' || !snapshot || !coverKey) {
      throw new NotFoundException();
    }

    const path = join(mediaConfig.storageDir, 'drama-covers', id, coverKey);
    let size: number;
    try { size = (await stat(path)).size; } catch { throw new NotFoundException(); }
    const extension = coverKey.split('.').pop()!;
    res.setHeader('Content-Type', mimeTypes[extension]);
    res.setHeader('Content-Length', size);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(createReadStream(path));
  }
}
