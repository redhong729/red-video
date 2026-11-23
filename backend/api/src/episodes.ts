import { BadRequestException, Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import type { Prisma } from './generated/prisma/client.js';
import { previewConfig } from './preview-config.js';
import { editableDramaStatus } from './drama-status.js';
import { activeMediaStatuses, cleanupDeletedMediaUploads } from './deleted-media-cleanup.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const localePattern = /^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/;
const obj = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('Invalid request');
  return value as Record<string, unknown>;
};
const integer = (value: unknown, minimum: number, field: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > 2147483647) throw new BadRequestException(`Invalid ${field}`);
  return value;
};

function parseEpisode(body: unknown) {
  const input = obj(body);
  if (!Array.isArray(input.translations) || input.translations.length > 50) throw new BadRequestException('Invalid translations');
  const translations = input.translations.map((entry) => {
    const item = obj(entry);
    if (typeof item.locale !== 'string' || !localePattern.test(item.locale) || typeof item.title !== 'string' || item.title.length > 500) throw new BadRequestException('Invalid translation');
    return { locale: item.locale, title: item.title.trim() };
  });
  if (new Set(translations.map((item) => item.locale.toLowerCase())).size !== translations.length) throw new BadRequestException('Duplicate locale');
  const priceMode = input.priceMode == null || input.priceMode === '' ? null : input.priceMode;
  if (priceMode !== null && priceMode !== 'FREE' && priceMode !== 'CREDITS') throw new BadRequestException('Invalid price mode');
  const priceCredits = input.priceCredits == null ? null : integer(input.priceCredits, 1, 'price credits');
  if ((priceMode === 'CREDITS' && priceCredits === null) || (priceMode !== 'CREDITS' && priceCredits !== null)) throw new BadRequestException('Invalid price credits');
  const previewSeconds = input.previewSeconds == null ? null : integer(input.previewSeconds, 0, 'preview seconds');
  return { translations: translations.filter((item) => item.title), priceMode: priceMode as string | null, priceCredits, previewSeconds };
}

async function lockDrama(tx: Prisma.TransactionClient, dramaId: string) {
  if (!uuid.test(dramaId)) throw new NotFoundException();
  await tx.$queryRaw`SELECT id FROM dramas WHERE id = ${dramaId}::uuid FOR UPDATE`;
  const drama = await tx.drama.findUnique({ where: { id: dramaId }, include: { draft: true } });
  if (!drama || !drama.draft) throw new NotFoundException();
  if (!editableDramaStatus(drama.status)) throw new ConflictException('Editing episodes for this drama status is not supported');
  return { ...drama, draft: drama.draft };
}

type PricingDraft = { pricingMode: string | null; freeEpisodes: number | null; priceCredits: number | null; previewSeconds: number };
type EpisodeInfo = { number: number; priceMode: string | null; priceCredits: number | null; previewSeconds: number | null; translations: { locale: string; title: string }[] };
function display(item: EpisodeInfo, draft: PricingDraft, locale: string) {
  const title = item.translations.find((row) => row.locale.toLowerCase() === locale.toLowerCase())?.title
    ?? item.translations.find((row) => row.locale.toLowerCase() === 'en')?.title
    ?? (locale.toLowerCase().startsWith('zh') ? `第 ${item.number} 集` : `Episode ${item.number}`);
  let effectivePrice: { mode: 'FREE' | 'CREDITS' | 'UNCONFIGURED'; credits: number | null } = { mode: 'UNCONFIGURED', credits: null };
  if (item.priceMode === 'FREE') effectivePrice = { mode: 'FREE', credits: null };
  else if (item.priceMode === 'CREDITS') effectivePrice = { mode: 'CREDITS', credits: item.priceCredits };
  else if (draft.pricingMode === 'FREE') effectivePrice = { mode: 'FREE', credits: null };
  else if (draft.pricingMode === 'PER_EPISODE' && draft.freeEpisodes !== null) {
    if (item.number <= draft.freeEpisodes) effectivePrice = { mode: 'FREE', credits: null };
    else if (draft.priceCredits !== null) effectivePrice = { mode: 'CREDITS', credits: draft.priceCredits };
  }
  return { title, effectivePrice, effectivePreviewSeconds: item.previewSeconds ?? draft.previewSeconds };
}

@Controller('api/dramas/:dramaId/episodes')
export class EpisodeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('identifiers')
  async identifiers(@Param('dramaId') dramaId: string, @Query('locale') requested?: string) {
    if (!uuid.test(dramaId)) throw new NotFoundException();
    const locale = requested || 'en';
    if (!localePattern.test(locale)) throw new BadRequestException('Invalid locale');
    const drama = await this.prisma.drama.findUnique({ where: { id: dramaId }, include: { draft: { include: { translations: true } } } });
    if (!drama?.draft) throw new NotFoundException();
    const titles = drama.draft.translations;
    const title = titles.find((row) => row.locale.toLowerCase() === locale.toLowerCase() && row.title)?.title ?? titles.find((row) => row.locale.toLowerCase() === 'en' && row.title)?.title ?? titles.find((row) => row.title)?.title ?? null;
    const episodes = await this.prisma.episode.findMany({ where: { dramaId }, select: { number: true, status: true, draftMediaId: true, pendingMediaId: true }, orderBy: { number: 'asc' } });
    const pending = await this.prisma.mediaUpload.findMany({ where: { id: { in: episodes.flatMap((row) => row.pendingMediaId ? [row.pendingMediaId] : []) } }, select: { id: true, status: true } });
    return { title, totalEpisodes: drama.draft.totalEpisodes, status: drama.status, episodes: episodes.map((row) => ({ ...row, pendingStatus: pending.find((item) => item.id === row.pendingMediaId)?.status ?? null })) };
  }

  @Get()
  async list(@Param('dramaId') dramaId: string, @Query('page') pageValue?: string, @Query('pageSize') sizeValue?: string, @Query('locale') requested?: string) {
    if (!uuid.test(dramaId)) throw new NotFoundException();
    const page = Number(pageValue || 1), pageSize = Number(sizeValue || 20), locale = requested || 'en';
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || ![20, 50, 100].includes(pageSize) || !localePattern.test(locale)) throw new BadRequestException('Invalid query');
    const drama = await this.prisma.drama.findUnique({ where: { id: dramaId }, include: { draft: { include: { translations: true } } } });
    if (!drama || !drama.draft) throw new NotFoundException();
    const draft = drama.draft;
    const [total, items] = await this.prisma.$transaction([
      this.prisma.episode.count({ where: { dramaId } }),
      this.prisma.episode.findMany({ where: { dramaId }, include: { translations: true, draftMedia: { select: { id: true, status: true, selectedCover: true, duration: true, previewStatus: true, previewSeconds: true, previewSignature: true, uploadedAt: true, detectStatus: true, transcodeStatus: true } }, pendingMedia: { select: { id: true, status: true, uploadedAt: true, detectStatus: true, transcodeStatus: true } } }, orderBy: { number: 'asc' }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    const dramaTitle = draft.translations.find((row) => row.locale.toLowerCase() === locale.toLowerCase() && row.title)?.title
      ?? draft.translations.find((row) => row.locale.toLowerCase() === 'en' && row.title)?.title
      ?? draft.translations.find((row) => row.title)?.title ?? null;
    return { drama: { id: drama.id, title: dramaTitle, status: drama.status, totalEpisodes: draft.totalEpisodes }, total, page, pageSize,
      items: items.map((item, index) => ({ ...item, displayOrder: (page - 1) * pageSize + index + 1, previewCurrent: item.draftMedia ? item.draftMedia.previewSignature === previewConfig(draft, item).signature : null, ...display(item, draft, locale) })) };
  }

  @Post()
  async create(@Param('dramaId') dramaId: string, @Body() body: unknown) {
    const number = integer(obj(body).number, 1, 'episode number');
    const data = parseEpisode(body);
    return this.prisma.$transaction(async (tx) => {
      const drama = await lockDrama(tx, dramaId);
      if (drama.draft.totalEpisodes === null || number > drama.draft.totalEpisodes) throw new BadRequestException('Set a sufficient planned episode count first');
      if (await tx.episode.findUnique({ where: { dramaId_number: { dramaId, number } } })) throw new ConflictException('Episode number already exists');
      // 保留历史排序字段的数据，但不再使用自定义排序。
      const position = number;
      const episode = await tx.episode.create({ data: { dramaId, number, position, priceMode: data.priceMode, priceCredits: data.priceCredits, previewSeconds: data.previewSeconds, translations: { create: data.translations } }, include: { translations: true } });
      await tx.drama.update({ where: { id: dramaId }, data: { updatedAt: new Date() } });
      return episode;
    });
  }

  @Put(':episodeId')
  async update(@Param('dramaId') dramaId: string, @Param('episodeId') episodeId: string, @Body() body: unknown) {
    if (!uuid.test(episodeId)) throw new NotFoundException();
    const data = parseEpisode(body);
    return this.prisma.$transaction(async (tx) => {
      await lockDrama(tx, dramaId);
      const existing = await tx.episode.findFirst({ where: { id: episodeId, dramaId } });
      if (!existing) throw new NotFoundException();
      if (obj(body).number !== undefined && obj(body).number !== existing.number) throw new BadRequestException('Episode number cannot be changed');
      await tx.episodeTranslation.deleteMany({ where: { episodeId } });
      const episode = await tx.episode.update({ where: { id: episodeId }, data: { priceMode: data.priceMode, priceCredits: data.priceCredits, previewSeconds: data.previewSeconds, translations: { create: data.translations } }, include: { translations: true } });
      await tx.drama.update({ where: { id: dramaId }, data: { updatedAt: new Date() } });
      return episode;
    });
  }

  @Delete(':episodeId')
  async remove(@Param('dramaId') dramaId: string, @Param('episodeId') episodeId: string) {
    if (!uuid.test(episodeId)) throw new NotFoundException();
    const mediaIds = await this.prisma.$transaction(async (tx) => {
      await lockDrama(tx, dramaId);
      const episode = await tx.episode.findFirst({ where: { id: episodeId, dramaId }, select: { id: true, status: true } });
      if (!episode) throw new NotFoundException();
      if (episode.status === 'PUBLISHED') throw new ConflictException('Take the episode offline before deletion');

      const uploads = await tx.mediaUpload.findMany({ where: { episodeId }, select: { id: true, batchId: true, status: true } });
      if (uploads.some((upload) => activeMediaStatuses.includes(upload.status as typeof activeMediaStatuses[number]))) {
        throw new ConflictException('Wait for active media tasks to finish before deletion');
      }

      await tx.episodePublication.deleteMany({ where: { episodeId } });
      await tx.publicationRevision.deleteMany({ where: { episodeId } });
      await tx.visibilityEvent.deleteMany({ where: { episodeId } });
      await tx.reviewItem.deleteMany({ where: { episodeId } });
      await tx.mediaUpload.deleteMany({ where: { episodeId } });
      const batchIds = [...new Set(uploads.map((upload) => upload.batchId))];
      if (batchIds.length) await tx.mediaBatch.deleteMany({ where: { id: { in: batchIds }, items: { none: {} } } });
      await tx.episode.delete({ where: { id: episodeId } });
      await tx.drama.update({ where: { id: dramaId }, data: { updatedAt: new Date() } });
      return uploads.map((upload) => upload.id);
    });

    await cleanupDeletedMediaUploads(mediaIds);
    return { deleted: true };
  }
}
