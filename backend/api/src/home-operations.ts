import { BadRequestException, Body, Controller, Get, Put, Query } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { Prisma } from './generated/prisma/client.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const localePattern = /^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/;
const coverKeyPattern = /^[0-9a-f-]{36}\.(?:jpg|png|webp)$/;
type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonRecord : null;
}

function localized(rows: unknown, locale: string, field: string): string | null {
  if (!Array.isArray(rows)) return null;
  const translations = rows.map(record).filter((row): row is JsonRecord => row !== null);
  const value = translations.find((row) => typeof row.locale === 'string' && row.locale.toLowerCase() === locale.toLowerCase())?.[field]
    ?? translations.find((row) => typeof row.locale === 'string' && row.locale.toLowerCase() === 'en')?.[field]
    ?? translations.find((row) => typeof row[field] === 'string')?.[field];
  return typeof value === 'string' && value.trim() ? value : null;
}

function parseIds(value: unknown, section: string, maximum: number): string[] {
  if (!Array.isArray(value) || value.length > maximum || value.some((id) => typeof id !== 'string' || !uuidPattern.test(id))) {
    throw new BadRequestException(`Invalid ${section} list`);
  }
  const ids = value as string[];
  if (new Set(ids).size !== ids.length) throw new BadRequestException(`Duplicate ${section} drama`);
  return ids;
}

@Controller('api/home-operations')
export class HomeOperationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async get(@Query('locale') requestedLocale?: string) {
    const locale = requestedLocale || 'zh-CN';
    if (!localePattern.test(locale)) throw new BadRequestException('Invalid locale');

    const [configuration, dramas] = await Promise.all([
      this.prisma.homeConfiguration.findUnique({ where: { id: 'default' } }),
      this.prisma.drama.findMany({
        where: { status: 'PUBLISHED', publication: { isNot: null }, episodes: { some: { status: 'PUBLISHED' } } },
        select: {
          id: true,
          publication: { select: { snapshot: true, publishedAt: true } },
          episodes: { where: { status: 'PUBLISHED' }, select: { id: true } },
        },
      }),
    ]);

    const candidates = dramas.flatMap((drama) => {
      const snapshot = record(drama.publication?.snapshot);
      if (!snapshot) return [];
      const title = localized(snapshot.translations, locale, 'title');
      if (!title) return [];
      const coverKey = typeof snapshot.coverKey === 'string' && coverKeyPattern.test(snapshot.coverKey) ? snapshot.coverKey : null;
      const requestedOrder = snapshot.sortOrder;
      const sortOrder = typeof requestedOrder === 'number' && Number.isSafeInteger(requestedOrder) && requestedOrder >= 0 ? requestedOrder : 0;
      return [{
        id: drama.id,
        title,
        categoryName: localized(snapshot.categoryNames, locale, 'name'),
        episodeCount: drama.episodes.length,
        coverUrl: coverKey ? `/api/public/dramas/${drama.id}/cover` : null,
        sortOrder,
        publishedAt: drama.publication!.publishedAt.toISOString(),
      }];
    }).sort((a, b) => a.sortOrder - b.sortOrder
      || Date.parse(b.publishedAt) - Date.parse(a.publishedAt)
      || a.id.localeCompare(b.id));
    const saved = (value: unknown): string[] => Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string' && uuidPattern.test(item))
      : [];
    const featured = configuration?.configured ? saved(configuration.featured) : [];
    const popular = configuration?.configured
      ? saved(configuration.popular)
      : candidates.slice(0, 100).map((item) => item.id);
    const ranking = configuration?.configured ? saved(configuration.ranking) : [];

    return {
      configured: configuration?.configured ?? false,
      sections: { featured, popular, ranking },
      candidates,
      updatedAt: configuration?.configured ? configuration.updatedAt.toISOString() : null,
    };
  }

  @Put()
  async save(@Body() body: unknown) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Invalid request');
    const payload = body as Record<string, unknown>;
    const featured = parseIds(payload.featured, 'featured', 10);
    const popular = parseIds(payload.popular, 'popular', 12);
    const ranking = parseIds(payload.ranking, 'ranking', 10);
    const ids = [...new Set([...featured, ...popular, ...ranking])];

    if (ids.length) {
      const eligible = await this.prisma.drama.findMany({
        where: {
          id: { in: ids },
          status: 'PUBLISHED',
          publication: { isNot: null },
          episodes: { some: { status: 'PUBLISHED' } },
        },
        select: { id: true },
      });
      if (eligible.length !== ids.length) throw new BadRequestException('Only published dramas with published episodes can be placed on the homepage');
    }

    const config = await this.prisma.homeConfiguration.upsert({
      where: { id: 'default' },
      create: {
        id: 'default', featured: featured as Prisma.InputJsonValue, popular: popular as Prisma.InputJsonValue,
        ranking: ranking as Prisma.InputJsonValue, configured: true,
      },
      update: {
        featured: featured as Prisma.InputJsonValue, popular: popular as Prisma.InputJsonValue,
        ranking: ranking as Prisma.InputJsonValue, configured: true,
      },
    });
    return { ok: true, updatedAt: config.updatedAt.toISOString() };
  }
}
