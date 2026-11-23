import { BadRequestException, Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import type { Prisma } from './generated/prisma/client.js';
import { activeMediaStatuses, cleanupDeletedDramaFiles } from './deleted-media-cleanup.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const localePattern = /^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/;
const whole = (v: unknown, min: number, field: string): number | null => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > 2147483647) throw new BadRequestException(`Invalid ${field}`);
  return v;
};
const boundedText = (value: unknown, max: number, field: string): string | null => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > max) throw new BadRequestException(`Invalid ${field}`);
  return value.trim() || null;
};
const asObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('Invalid request');
  return value as Record<string, unknown>;
};

function parseDraft(input: unknown) {
  const data = asObject(input);
  if (!Array.isArray(data.translations) || data.translations.length < 1 || data.translations.length > 50) throw new BadRequestException('Translations required');
  const translations = data.translations.map((item) => {
    const row = asObject(item);
    if (typeof row.locale !== 'string' || !localePattern.test(row.locale)) throw new BadRequestException('Invalid locale');
    return { locale: row.locale, title: boundedText(row.title, 500, 'title'), description: boundedText(row.description, 10000, 'description') };
  });
  if (new Set(translations.map((t) => t.locale.toLowerCase())).size !== translations.length || !translations.some((t) => t.title)) throw new BadRequestException('At least one title and unique locales required');
  const categoryId = data.categoryId == null || data.categoryId === '' ? null : data.categoryId;
  if (categoryId !== null && (typeof categoryId !== 'string' || !uuid.test(categoryId))) throw new BadRequestException('Invalid category');
  if (!Array.isArray(data.tagIds) || data.tagIds.length > 100 || data.tagIds.some((id) => typeof id !== 'string' || !uuid.test(id)) || new Set(data.tagIds).size !== data.tagIds.length) throw new BadRequestException('Invalid tags');
  const tagIds = data.tagIds as string[];
  if (!Array.isArray(data.actors) || data.actors.length > 100) throw new BadRequestException('Invalid actors');
  const actors = data.actors.map((item, position) => {
    const row = asObject(item);
    const name = boundedText(row.name, 200, 'actor name');
    if (!name) throw new BadRequestException('Actor name required');
    return { name, roleName: boundedText(row.roleName, 200, 'role name'), position };
  });
  const totalEpisodes = whole(data.totalEpisodes, 1, 'totalEpisodes');
  const sortOrder = whole(data.sortOrder, 0, 'sortOrder') ?? 0;
  const previewSeconds = whole(data.previewSeconds, 0, 'previewSeconds') ?? 30;
  const pricingMode = data.pricingMode == null || data.pricingMode === '' ? null : data.pricingMode;
  if (pricingMode !== null && pricingMode !== 'FREE' && pricingMode !== 'PER_EPISODE') throw new BadRequestException('Invalid pricing mode');
  const freeEpisodes = whole(data.freeEpisodes, 0, 'freeEpisodes');
  const priceCredits = whole(data.priceCredits, 1, 'priceCredits');
  if (pricingMode !== 'PER_EPISODE' && (freeEpisodes !== null || priceCredits !== null)) throw new BadRequestException('Invalid pricing fields');
  if (totalEpisodes !== null && freeEpisodes !== null && freeEpisodes > totalEpisodes) throw new BadRequestException('Free episodes exceed total episodes');
  return { translations, categoryId: categoryId as string | null, tagIds, actors, totalEpisodes, sortOrder, previewSeconds, pricingMode: pricingMode as string | null, freeEpisodes, priceCredits };
}

const draftInclude = { translations: true, actors: { orderBy: { position: 'asc' as const } }, category: { include: { translations: true } }, tags: { include: { tag: { include: { translations: true } } } } };

@Controller('api/dramas')
export class DramaController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('options')
  async options(@Query('locale') requested?: string) {
    const locale = requested || 'en';
    if (!localePattern.test(locale)) throw new BadRequestException('Invalid locale');
    const [categories, tags] = await Promise.all([
      this.prisma.category.findMany({ include: { translations: true }, orderBy: { id: 'asc' } }),
      this.prisma.tag.findMany({ include: { translations: true }, orderBy: { id: 'asc' } }),
    ]);
    const name = (rows: { locale: string; name: string }[]) => rows.find((row) => row.locale.toLowerCase() === locale.toLowerCase())?.name ?? null;
    return { categories: categories.map((item) => ({ id: item.id, name: name(item.translations), active: item.active })), tags: tags.map((item) => ({ id: item.id, name: name(item.translations), active: item.active })) };
  }

  @Get()
  async list(@Query() q: Record<string, string | string[] | undefined>) {
    const str = (key: string): string => { const v = q[key]; if (Array.isArray(v)) throw new BadRequestException(`Invalid ${key}`); return v ?? ''; };
    const page = Number(str('page') || '1');
    const pageSize = Number(str('pageSize') || '20');
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || ![20, 50, 100].includes(pageSize)) throw new BadRequestException('Invalid pagination');
    const locale = str('locale') || 'en';
    if (!localePattern.test(locale)) throw new BadRequestException('Invalid locale');
    const keyword = str('keyword').trim();
    if (keyword.length > 500) throw new BadRequestException('Invalid keyword');
    const categoryId = str('categoryId');
    const tagIds = str('tagIds').split(',').filter(Boolean);
    if ((categoryId && !uuid.test(categoryId)) || tagIds.length > 100 || tagIds.some((id) => !uuid.test(id))) throw new BadRequestException('Invalid filter');
    const status = str('status');
    if (status && !['DRAFT', 'IN_REVIEW', 'PUBLISHED', 'OFFLINE'].includes(status)) throw new BadRequestException('Invalid status');
    const pricingMode = str('pricingMode');
    if (pricingMode && !['FREE', 'PER_EPISODE'].includes(pricingMode)) throw new BadRequestException('Invalid pricing mode');
    const updatedFrom = str('updatedFrom'); const updatedTo = str('updatedTo');
    const from = updatedFrom ? new Date(updatedFrom) : undefined; const to = updatedTo ? new Date(updatedTo) : undefined;
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime())) || (from && to && from > to)) throw new BadRequestException('Invalid date range');
    const where: Prisma.DramaWhereInput = {
      ...(status && { status }),
      ...(from || to ? { updatedAt: { ...(from && { gte: from }), ...(to && { lte: to }) } } : {}),
      draft: { is: {
        ...(categoryId && { categoryId }),
        ...(tagIds.length && { tags: { some: { tagId: { in: tagIds } } } }),
        ...(pricingMode && { pricingMode }),
        ...(keyword && { OR: [ ...(uuid.test(keyword) ? [{ dramaId: keyword }] : []), { translations: { some: { title: { contains: keyword, mode: 'insensitive' as const } } } } ] }),
      } },
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.drama.count({ where }),
      this.prisma.drama.findMany({ where, include: { draft: { include: draftInclude }, _count: { select: { episodes: { where: { uploads: { some: { uploadedAt: { not: null } } } } } } } }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    const localized = (rows: { locale: string; name: string }[]) => rows.find((row) => row.locale.toLowerCase() === locale.toLowerCase())?.name ?? null;
    const publishedCounts = await this.prisma.episode.groupBy({ by: ['dramaId'], where: { dramaId: { in: items.map((item) => item.id) }, status: 'PUBLISHED' }, _count: { _all: true } });
    const published = new Map(publishedCounts.map((row) => [row.dramaId, row._count._all]));
    return { items: items.map((item) => {
      const draft = item.draft;
      const titles = draft?.translations ?? [];
      const title = titles.find((row) => row.locale.toLowerCase() === locale.toLowerCase() && row.title)?.title
        ?? titles.find((row) => row.locale.toLowerCase() === 'en' && row.title)?.title
        ?? titles.find((row) => row.title)?.title ?? null;
      return { id: item.id, status: item.status, updatedAt: item.updatedAt, title,
        categoryName: draft?.category ? localized(draft.category.translations) : null,
        categoryId: draft?.categoryId ?? null, coverKey: draft?.coverKey ?? null,
        tags: draft?.tags.map(({ tag }) => ({ id: tag.id, name: localized(tag.translations) })) ?? [],
        publishedEpisodes: published.get(item.id) ?? 0, uploadedEpisodes: item._count.episodes, totalEpisodes: draft?.totalEpisodes ?? null, sortOrder: draft?.sortOrder ?? 0, pricingMode: draft?.pricingMode ?? null };
    }), total, page, pageSize };
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    if (!uuid.test(id)) throw new NotFoundException();
    const drama = await this.prisma.drama.findUnique({ where: { id }, include: { draft: { include: draftInclude } } });
    if (!drama || !drama.draft) throw new NotFoundException();
    return drama;
  }

  @Post()
  async create(@Body() body: unknown) { return this.save(undefined, body); }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: unknown) {
    if (!uuid.test(id)) throw new NotFoundException();
    return this.save(id, body);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    if (!uuid.test(id)) throw new NotFoundException();
    const deleted = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM dramas WHERE id = ${id}::uuid FOR UPDATE`;
      const drama = await tx.drama.findUnique({ where: { id }, select: { id: true, status: true } });
      if (!drama) throw new NotFoundException();
      if (!['DRAFT', 'OFFLINE'].includes(drama.status)) throw new ConflictException('Take the drama offline before deletion');

      const episodes = await tx.episode.findMany({ where: { dramaId: id }, select: { id: true } });
      const episodeIds = episodes.map((episode) => episode.id);
      const activeUpload = episodeIds.length ? await tx.mediaUpload.findFirst({
        where: { episodeId: { in: episodeIds }, status: { in: [...activeMediaStatuses] } },
        select: { id: true },
      }) : null;
      if (activeUpload) throw new ConflictException('Wait for active media tasks to finish before deletion');

      const uploads = episodeIds.length ? await tx.mediaUpload.findMany({ where: { episodeId: { in: episodeIds } }, select: { id: true } }) : [];
      await tx.episodePublication.deleteMany({ where: { episodeId: { in: episodeIds } } });
      await tx.dramaPublication.deleteMany({ where: { dramaId: id } });
      await tx.reviewItem.deleteMany({ where: { dramaId: id } });
      await tx.publicationRevision.deleteMany({ where: { dramaId: id } });
      await tx.visibilityEvent.deleteMany({ where: { dramaId: id } });
      if (episodeIds.length) await tx.mediaUpload.deleteMany({ where: { episodeId: { in: episodeIds } } });
      await tx.mediaBatch.deleteMany({ where: { dramaId: id } });

      const home = await tx.homeConfiguration.findUnique({ where: { id: 'default' } });
      if (home) {
        const removeReference = (value: Prisma.JsonValue): Prisma.InputJsonValue => Array.isArray(value)
          ? value.filter((entry) => entry !== id) as Prisma.InputJsonArray
          : value as Prisma.InputJsonValue;
        await tx.homeConfiguration.update({
          where: { id: 'default' },
          data: { featured: removeReference(home.featured), popular: removeReference(home.popular), ranking: removeReference(home.ranking) },
        });
      }

      await tx.drama.delete({ where: { id } });
      return uploads.map((upload) => upload.id);
    });

    await cleanupDeletedDramaFiles(id, deleted);
    return { deleted: true };
  }

  private async save(id: string | undefined, body: unknown) {
    const data = parseDraft(body);
    return this.prisma.$transaction(async (tx) => {
      let dramaId = id;
      let previousCategory: string | null = null; let previousTags: string[] = [];
      if (!dramaId) dramaId = (await tx.drama.create({ data: {} })).id;
      else {
        const updated = await tx.drama.updateMany({ where: { id: dramaId, status: { in: ['DRAFT', 'PUBLISHED', 'OFFLINE'] } }, data: { updatedAt: new Date() } });
        if (!updated.count) throw new NotFoundException();
        const previous = await tx.dramaDraft.findUnique({ where: { dramaId }, include: { tags: true } });
        previousCategory = previous?.categoryId ?? null; previousTags = previous?.tags.map((tag) => tag.tagId) ?? [];
        const maximum = await tx.episode.aggregate({ where: { dramaId }, _max: { number: true } });
        if (maximum._max.number !== null && (data.totalEpisodes === null || data.totalEpisodes < maximum._max.number)) {
          throw new BadRequestException('Total episodes cannot be below the highest existing episode number');
        }
      }
      // Lock referenced taxonomy rows against concurrent disable/delete until this save commits.
      if (data.categoryId) {
        const rows = await tx.$queryRaw<{ active: boolean }[]>`SELECT active FROM categories WHERE id = ${data.categoryId}::uuid FOR SHARE`;
        if (!rows.length) throw new BadRequestException('Category not found');
        if (!rows[0].active && previousCategory !== data.categoryId) throw new BadRequestException('Category is inactive');
      }
      for (const tagId of [...data.tagIds].sort()) {
        const rows = await tx.$queryRaw<{ active: boolean }[]>`SELECT active FROM tags WHERE id = ${tagId}::uuid FOR SHARE`;
        if (!rows.length) throw new BadRequestException('Tag not found');
        if (!rows[0].active && !previousTags.includes(tagId)) throw new BadRequestException('Tag is inactive');
      }
      const fields = { categoryId: data.categoryId, totalEpisodes: data.totalEpisodes, sortOrder: data.sortOrder, pricingMode: data.pricingMode, freeEpisodes: data.freeEpisodes, priceCredits: data.priceCredits, previewSeconds: data.previewSeconds };
      await tx.dramaDraft.upsert({ where: { dramaId }, create: { dramaId, ...fields }, update: fields });
      await tx.dramaTranslation.deleteMany({ where: { dramaId } });
      await tx.dramaActor.deleteMany({ where: { dramaId } });
      await tx.dramaTag.deleteMany({ where: { dramaId } });
      await tx.dramaTranslation.createMany({ data: data.translations.map((item) => ({ dramaId, ...item })) });
      if (data.actors.length) await tx.dramaActor.createMany({ data: data.actors.map((item) => ({ dramaId, ...item })) });
      if (data.tagIds.length) await tx.dramaTag.createMany({ data: data.tagIds.map((tagId) => ({ dramaId, tagId })) });
      return tx.drama.findUniqueOrThrow({ where: { id: dramaId }, include: { draft: { include: draftInclude } } });
    });
  }
}
