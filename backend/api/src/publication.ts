import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { join } from 'node:path';
import { BadRequestException, Body, ConflictException, Controller, Get, Headers, HttpException, NotFoundException, Param, Post, Query, Req, Res, StreamableFile } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import type { Prisma } from './generated/prisma/client.js';
import { mediaConfig, mediaDir, uuidPattern } from './media-common.js';
import { previewConfig } from './preview-config.js';

type Request = { admin?: { id: string; username: string } };
type Response = { setHeader(name: string, value: string | number): void; status(code: number): void };
const include = {
  draft: { include: { translations: true, actors: true, category: { include: { translations: true } }, tags: { include: { tag: { include: { translations: true } } } } } },
  episodes: { orderBy: { number: 'asc' as const }, include: { translations: true, draftMedia: true, publication: true } },
  publication: true,
};
type FullDrama = Prisma.DramaGetPayload<{ include: typeof include }>;
type FullEpisode = FullDrama['episodes'][number];
const sortLocale = <T extends { locale: string }>(rows: T[]) => [...rows].sort((a, b) => a.locale.localeCompare(b.locale, 'en'));
const hash = (obj: unknown) => createHash('sha256').update(JSON.stringify(obj)).digest('hex');
const hashPattern = /^[0-9a-f]{64}$/;
const validId = (id: string) => { if (!uuidPattern.test(id)) throw new NotFoundException(); };
const isFile = async (path: string) => { try { return (await stat(path)).isFile(); } catch { return false; } };
function version(input: unknown): 'draft' | 'live' {
  if (input === undefined || input === 'draft') return 'draft';
  if (input === 'live') return 'live';
  throw new BadRequestException('Invalid version');
}
function confirmation(body: unknown) {
  if (!body || typeof body !== 'object' || !('episodeIds' in body) || !Array.isArray(body.episodeIds) || !body.episodeIds.length || body.episodeIds.length > 100 || body.episodeIds.some((id: unknown) => typeof id !== 'string' || !uuidPattern.test(id)) || new Set(body.episodeIds).size !== body.episodeIds.length || !('dramaFingerprint' in body) || typeof body.dramaFingerprint !== 'string' || !hashPattern.test(body.dramaFingerprint) || !('dramaStatus' in body) || typeof body.dramaStatus !== 'string' || !('episodeStatuses' in body) || !body.episodeStatuses || typeof body.episodeStatuses !== 'object' || Array.isArray(body.episodeStatuses) || !('episodeFingerprints' in body) || !body.episodeFingerprints || typeof body.episodeFingerprints !== 'object' || Array.isArray(body.episodeFingerprints)) throw new BadRequestException('Invalid publication confirmation');
  const ids = body.episodeIds as string[], fingerprints = body.episodeFingerprints as Record<string, unknown>;
  const statuses = body.episodeStatuses as Record<string, unknown>;
  if (Object.keys(fingerprints).length !== ids.length || Object.keys(statuses).length !== ids.length || ids.some((id) => typeof fingerprints[id] !== 'string' || !hashPattern.test(fingerprints[id] as string) || !['OFFLINE', 'PUBLISHED'].includes(String(statuses[id])))) throw new BadRequestException('Invalid publication confirmation');
  const scope = !('scope' in body) ? 'drama' : body.scope;
  if (scope !== 'drama' && scope !== 'episodes') throw new BadRequestException('Invalid publication scope');
  return { ids, dramaFingerprint: body.dramaFingerprint, dramaStatus: body.dramaStatus, fingerprints: fingerprints as Record<string, string>, statuses: statuses as Record<string, string>, mode: version('version' in body ? body.version : undefined), scope };
}
function dramaSnapshot(drama: FullDrama) {
  const draft = drama.draft!;
  return {
    dramaId: drama.id, translations: sortLocale(draft.translations).map(({ locale, title, description }) => ({ locale, title, description })),
    coverKey: draft.coverKey, categoryId: draft.categoryId,
    categoryNames: sortLocale(draft.category?.translations ?? []).map(({ locale, name }) => ({ locale, name })),
    tags: [...draft.tags].sort((a, b) => a.tagId.localeCompare(b.tagId)).map(({ tag }) => ({ id: tag.id, names: sortLocale(tag.translations).map(({ locale, name }) => ({ locale, name })) })),
    actors: [...draft.actors].sort((a, b) => a.position - b.position).map(({ name, roleName }) => ({ name, roleName })),
    totalEpisodes: draft.totalEpisodes, sortOrder: draft.sortOrder, pricingMode: draft.pricingMode, freeEpisodes: draft.freeEpisodes, priceCredits: draft.priceCredits, previewSeconds: draft.previewSeconds,
  };
}
function episodeSnapshot(item: FullEpisode, drama: ReturnType<typeof dramaSnapshot>) {
  const config = previewConfig(drama, item);
  const credits = item.priceMode === 'CREDITS' ? item.priceCredits : config.paid ? drama.priceCredits : null;
  return { episodeId: item.id, number: item.number, translations: sortLocale(item.translations).map(({ locale, title }) => ({ locale, title })), priceMode: item.priceMode, priceCredits: item.priceCredits, previewSeconds: item.previewSeconds, effectivePrice: { mode: config.paid === null ? 'UNCONFIGURED' : config.paid ? 'CREDITS' : 'FREE', credits }, effectivePreviewKind: config.kind, effectivePreviewSeconds: config.seconds, mediaId: item.draftMediaId, mediaFingerprint: item.draftMedia?.fingerprint ?? null, previewSignature: item.draftMedia?.previewSignature ?? null, selectedCover: item.draftMedia?.selectedCover ?? null };
}
async function report(drama: FullDrama, mode: 'draft' | 'live', client: Pick<Prisma.TransactionClient, 'mediaUpload' | 'tag'>) {
  if (mode === 'live' && !drama.publication) throw new ConflictException('No published version exists');
  const dramaData = mode === 'live' ? drama.publication!.snapshot as unknown as ReturnType<typeof dramaSnapshot> : dramaSnapshot(drama);
  const dramaFingerprint = mode === 'live' ? drama.publication!.fingerprint : hash(dramaData);
  const blockers: string[] = [], warnings: string[] = [];
  const english = dramaData.translations.find((row) => row.locale.toLowerCase() === 'en');
  if (!english?.title?.trim() || !english.description?.trim()) blockers.push('ENGLISH_REQUIRED');
  if (!dramaData.categoryId) blockers.push('CATEGORY_REQUIRED');
  if (!dramaData.totalEpisodes) blockers.push('TOTAL_REQUIRED');
  if (!dramaData.coverKey || !/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(dramaData.coverKey) || !(await isFile(join(mediaConfig.storageDir, 'drama-covers', drama.id, dramaData.coverKey)))) blockers.push('COVER_REQUIRED');
  if (dramaData.pricingMode !== 'FREE' && (dramaData.pricingMode !== 'PER_EPISODE' || dramaData.freeEpisodes === null || dramaData.priceCredits === null)) blockers.push('PRICING_REQUIRED');
  if (!dramaData.actors.length) warnings.push('NO_ACTORS');
  if (!dramaData.tags.length) warnings.push('NO_TAGS');
  const episodes = await Promise.all(drama.episodes.map(async (item) => {
    const useSaved = mode === 'live' && !!item.publication && (drama.status === 'OFFLINE' || item.status === 'PUBLISHED');
    const snapshot = useSaved ? item.publication!.snapshot as unknown as ReturnType<typeof episodeSnapshot> : episodeSnapshot(item, dramaData);
    const fingerprint = useSaved ? item.publication!.fingerprint : hash(snapshot);
    const problems: string[] = [], itemWarnings: string[] = [];
    const media = useSaved && snapshot.mediaId ? await client.mediaUpload.findUnique({ where: { id: snapshot.mediaId } }) : item.draftMedia;
    const config = previewConfig(dramaData, snapshot);
    if (dramaData.totalEpisodes && snapshot.number > dramaData.totalEpisodes) problems.push('EPISODE_EXCEEDS_TOTAL');
    if (!media || (!useSaved && media.status !== 'READY') || media.detectStatus !== 'SUCCEEDED' || media.transcodeStatus !== 'SUCCEEDED' || media.fingerprint !== snapshot.mediaFingerprint || !(await isFile(join(mediaDir(media.id), 'output.mp4')))) problems.push('MEDIA_REQUIRED');
    if (config.kind === 'NOT_CONFIGURED') problems.push('EPISODE_PRICE_REQUIRED');
    if (config.kind === 'REQUIRED' && (!media?.duration || config.seconds >= media.duration || (!useSaved && media.previewStatus !== 'SUCCEEDED') || snapshot.previewSignature !== config.signature || !(await isFile(join(mediaDir(media.id), `preview-${config.signature}.mp4`))))) problems.push('PREVIEW_REQUIRED');
    if (!snapshot.selectedCover) itemWarnings.push('EPISODE_COVER_MISSING');
    const titles = snapshot.translations, title = titles.find((row) => row.locale.toLowerCase() === 'zh-cn')?.title ?? titles.find((row) => row.locale.toLowerCase() === 'en')?.title ?? `第 ${item.number} 集`;
    return { id: item.id, number: item.number, title, status: item.status, hasPublishedVersion: !!item.publication, mediaId: snapshot.mediaId, useSaved, fingerprint, blockers: problems, warnings: itemWarnings, snapshot };
  }));
  if (dramaData.totalEpisodes && episodes.filter((item) => item.number <= dramaData.totalEpisodes! && !item.blockers.includes('MEDIA_REQUIRED')).length < dramaData.totalEpisodes) warnings.push('EPISODES_INCOMPLETE');
  let sharedChanged = false;
  if (mode === 'draft' && drama.publication) {
    const knownTagIds = new Set((await client.tag.findMany({ select: { id: true } })).map((tag) => tag.id));
    const publishedDrama = drama.publication.snapshot as ReturnType<typeof dramaSnapshot>;
    const comparablePublished = { ...publishedDrama, tags: publishedDrama.tags.filter((tag) => knownTagIds.has(tag.id)) };
    sharedChanged = !isDeepStrictEqual(dramaData, comparablePublished);
  }
  return { drama: { id: drama.id, status: drama.status, hasPublished: !!drama.publication, title: dramaData.translations.find((row) => row.locale.toLowerCase() === 'zh-cn')?.title ?? english?.title ?? drama.id, fingerprint: dramaFingerprint }, sharedChanged, blockers, warnings, episodes };
}
async function locked(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM dramas WHERE id = ${id}::uuid FOR UPDATE`;
  const head = await tx.drama.findUnique({ where: { id }, include: { draft: { include: { tags: true } } } });
  if (!head?.draft) throw new NotFoundException();
  if (head.draft.categoryId) await tx.$queryRaw`SELECT id FROM categories WHERE id = ${head.draft.categoryId}::uuid FOR SHARE`;
  for (const tagId of head.draft.tags.map((tag) => tag.tagId).sort()) await tx.$queryRaw`SELECT id FROM tags WHERE id = ${tagId}::uuid FOR SHARE`;
  return tx.drama.findUniqueOrThrow({ where: { id }, include });
}

@Controller('api/publication')
export class PublicationController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('dramas/:id')
  async check(@Param('id') id: string, @Query('version') requested?: string) {
    validId(id); const drama = await this.prisma.drama.findUnique({ where: { id }, include });
    if (!drama?.draft) throw new NotFoundException();
    return report(drama, version(requested), this.prisma);
  }

  // 历史审核记录只读保留，不再提供送审或审核操作。
  @Get('dramas/:id/reviews')
  async reviews(@Param('id') id: string) {
    validId(id); if (!(await this.prisma.drama.findUnique({ where: { id } }))) throw new NotFoundException();
    const rows = await this.prisma.reviewItem.findMany({ where: { dramaId: id }, orderBy: { sequence: 'desc' }, take: 200 });
    return rows.map(({ sequence: _sequence, ...row }) => row);
  }

  @Get('dramas/:id/episodes/:episodeId/video')
  async publishedVideo(@Param('id') id: string, @Param('episodeId') episodeId: string, @Headers('range') range: string | undefined, @Res({ passthrough: true }) res: Response) {
    validId(id); validId(episodeId);
    const episode = await this.prisma.episode.findFirst({ where: { id: episodeId, dramaId: id }, include: { publication: true } });
    const snapshot = episode?.publication?.snapshot as { mediaId?: unknown; mediaFingerprint?: unknown } | undefined;
    if (!episode || typeof snapshot?.mediaId !== 'string' || !uuidPattern.test(snapshot.mediaId)) throw new NotFoundException();
    const media = await this.prisma.mediaUpload.findUnique({ where: { id: snapshot.mediaId } });
    if (!media || media.episodeId !== episode.id || media.fingerprint !== snapshot.mediaFingerprint || media.transcodeStatus !== 'SUCCEEDED') throw new NotFoundException();
    const path = join(mediaDir(media.id), 'output.mp4'); let size: number;
    try { size = (await stat(path)).size; } catch { throw new NotFoundException(); }
    res.setHeader('Content-Type', 'video/mp4'); res.setHeader('Accept-Ranges', 'bytes');
    if (!range) { res.setHeader('Content-Length', size); return new StreamableFile(createReadStream(path)); }
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) { res.setHeader('Content-Range', `bytes */${size}`); throw new HttpException('Invalid range', 416); }
    const suffix = !match[1] ? Number(match[2]) : null;
    const start = suffix === null ? Number(match[1]) : Math.max(0, size - suffix), end = suffix === null && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) { res.setHeader('Content-Range', `bytes */${size}`); throw new HttpException('Invalid range', 416); }
    res.status(206); res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`); res.setHeader('Content-Length', end - start + 1);
    return new StreamableFile(createReadStream(path, { start, end }));
  }

  @Post('dramas/:id/publish')
  async publish(@Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    validId(id); const { ids, dramaFingerprint, dramaStatus, fingerprints, statuses, mode, scope } = confirmation(body), actor = req.admin!.username;
    return this.prisma.$transaction(async (tx) => {
      const drama = await locked(tx, id);
      if (!['DRAFT', 'PUBLISHED', 'OFFLINE'].includes(drama.status)) throw new ConflictException('Drama is not ready for publishing');
      if (await tx.mediaUpload.count({ where: { episode: { dramaId: id, id: { in: ids } }, status: { in: ['UPLOADING', 'QUEUED', 'PROCESSING', 'CANCEL_REQUESTED'] } } })) throw new ConflictException('Wait for media tasks to finish');
      const current = await report(drama, mode, tx);
      const chosen = current.episodes.filter((item) => ids.includes(item.id));
      if (chosen.length !== ids.length) throw new BadRequestException('Episode not found');
      if (dramaFingerprint !== current.drama.fingerprint || dramaStatus !== current.drama.status || chosen.some((item) => fingerprints[item.id] !== item.fingerprint || statuses[item.id] !== item.status)) throw new ConflictException('Content changed; review confirmation again');
      if ((scope === 'drama' && current.blockers.length) || chosen.some((item) => item.blockers.length)) throw new ConflictException({ message: 'Publication checks failed', blockers: scope === 'drama' ? current.blockers : [], episodes: chosen.filter((item) => item.blockers.length).map(({ id: episodeId, blockers }) => ({ id: episodeId, blockers })) });
      if (scope === 'drama' && drama.status === 'OFFLINE' && current.episodes.some((item) => item.status === 'PUBLISHED' && !ids.includes(item.id))) throw new ConflictException('Select all episodes whose published status will become visible on restoration');
      if (scope === 'drama' && current.sharedChanged && current.episodes.some((item) => item.status === 'PUBLISHED' && !ids.includes(item.id))) throw new ConflictException('Select all episodes affected by shared changes');
      const dramaData = mode === 'live' ? drama.publication!.snapshot as Prisma.InputJsonValue : dramaSnapshot(drama);
      if (scope === 'drama' && mode === 'draft' && drama.publication?.fingerprint !== current.drama.fingerprint) {
        const revision = await tx.publicationRevision.create({ data: { dramaId: id, kind: 'DRAMA', fingerprint: current.drama.fingerprint, snapshot: dramaData, createdBy: actor } });
        await tx.dramaPublication.upsert({ where: { dramaId: id }, create: { dramaId: id, revisionId: revision.id, fingerprint: current.drama.fingerprint, snapshot: dramaData, publishedBy: actor }, update: { reviewId: null, revisionId: revision.id, fingerprint: current.drama.fingerprint, snapshot: dramaData, publishedBy: actor, publishedAt: new Date() } });
        if (drama.status === 'PUBLISHED') await tx.visibilityEvent.create({ data: { dramaId: id, actor, action: 'DRAMA_UPDATED', fromStatus: 'PUBLISHED', toStatus: 'PUBLISHED' } });
      }
      for (const episode of chosen) {
        const existing = drama.episodes.find((item) => item.id === episode.id);
        if (existing?.publication?.fingerprint !== episode.fingerprint) {
          const revision = await tx.publicationRevision.create({ data: { dramaId: id, episodeId: episode.id, kind: 'EPISODE', fingerprint: episode.fingerprint, snapshot: episode.snapshot, createdBy: actor } });
          await tx.episodePublication.upsert({ where: { episodeId: episode.id }, create: { episodeId: episode.id, revisionId: revision.id, fingerprint: episode.fingerprint, snapshot: episode.snapshot, publishedBy: actor }, update: { reviewId: null, revisionId: revision.id, fingerprint: episode.fingerprint, snapshot: episode.snapshot, publishedBy: actor, publishedAt: new Date() } });
          if (episode.status === 'PUBLISHED') await tx.visibilityEvent.create({ data: { dramaId: id, episodeId: episode.id, actor, action: 'EPISODE_UPDATED', fromStatus: 'PUBLISHED', toStatus: 'PUBLISHED' } });
        }
        if (episode.status !== 'PUBLISHED') {
          await tx.episode.update({ where: { id: episode.id }, data: { status: 'PUBLISHED' } });
          await tx.visibilityEvent.create({ data: { dramaId: id, episodeId: episode.id, actor, action: 'EPISODE_PUBLISHED', fromStatus: episode.status, toStatus: 'PUBLISHED' } });
        }
      }
      if (scope === 'drama' && drama.status !== 'PUBLISHED') {
        await tx.drama.update({ where: { id }, data: { status: 'PUBLISHED' } });
        await tx.visibilityEvent.create({ data: { dramaId: id, actor, action: 'DRAMA_PUBLISHED', fromStatus: drama.status, toStatus: 'PUBLISHED' } });
      }
      return { published: chosen.map((item) => item.id), status: scope === 'drama' ? 'PUBLISHED' : drama.status };
    }, { timeout: 30000 });
  }
}
