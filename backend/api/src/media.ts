import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readdir, rename, stat, unlink } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BadRequestException, Body, ConflictException, Controller, Get, Headers, HttpException, NotFoundException, Param, Post, Put, Query, Req, Res, StreamableFile } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { chunkPath, chunksDir, hashPattern, mediaConfig, mediaDir, mediaWorkerLockKey, safeCoverPattern, uuidPattern } from './media-common.js';
import { editableDramaStatus } from './drama-status.js';

const runFile = promisify(execFile);
type Request = IncomingMessage & { admin?: { id: string; username: string } };
type Response = { setHeader(name: string, value: string | number): void; status(code: number): void };
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('Invalid request');
  return value as Record<string, unknown>;
};
const requireId = (id: string) => { if (!uuidPattern.test(id)) throw new NotFoundException(); };
const include = { episode: { select: { number: true, draftMediaId: true } }, chunks: { orderBy: { number: 'asc' as const }, select: { number: true, size: true, sha256: true } } };

@Controller('api/media')
export class MediaController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('config')
  async config() {
    const rows = await this.prisma.$queryRaw<{ online: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_locks
        WHERE locktype = 'advisory'
          AND mode = 'ExclusiveLock'
          AND granted
          AND classid = 0::oid
          AND objid = ${mediaWorkerLockKey}::oid
          AND objsubid = 1
      ) AS online`;
    return {
      maxFiles: mediaConfig.maxFiles,
      maxBytes: mediaConfig.maxBytes,
      chunkSize: mediaConfig.chunkSize,
      uploadDays: mediaConfig.uploadDays,
      workerOnline: rows[0]?.online ?? false,
    };
  }

  @Get('batches')
  async batches(@Query('dramaId') dramaId?: string, @Query('locale') locale = 'en') {
    if (dramaId && !uuidPattern.test(dramaId)) throw new BadRequestException('Invalid drama');
    if (!/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(locale)) throw new BadRequestException('Invalid locale');
    const batches = await this.prisma.mediaBatch.findMany({ where: dramaId ? { dramaId } : {}, orderBy: { createdAt: 'desc' }, include: { drama: { include: { draft: { include: { translations: true } } } }, items: { include, orderBy: { createdAt: 'asc' } } } });
    return batches.map(({ drama, ...batch }) => {
      const rows = drama.draft?.translations ?? [];
      const dramaTitle = rows.find((row) => row.locale.toLowerCase() === locale.toLowerCase() && row.title)?.title ?? rows.find((row) => row.locale.toLowerCase() === 'en' && row.title)?.title ?? rows.find((row) => row.title)?.title ?? null;
      return { ...batch, dramaTitle };
    });
  }

  @Post('batches')
  async createBatch(@Body() body: unknown, @Req() req: Request) {
    const input = object(body);
    const dramaId = input.dramaId;
    if (typeof dramaId !== 'string' || !uuidPattern.test(dramaId) || !Array.isArray(input.items) || !input.items.length || input.items.length > mediaConfig.maxFiles) throw new BadRequestException('Invalid batch');
    const rejected: { index: number; filename: string; reason: string }[] = [];
    const items: { index: number; filename: string; size: number; number: number; fingerprint: string; replace: boolean }[] = [];
    for (const [index, value] of input.items.entries()) {
      try {
        const item = object(value);
        if (typeof item.filename !== 'string' || !item.filename.trim() || item.filename.length > 255 || !/\.mp4$/i.test(item.filename) || /[\x00-\x1f/\\]/.test(item.filename) || typeof item.size !== 'number' || !Number.isSafeInteger(item.size) || item.size < 1 || item.size > mediaConfig.maxBytes || typeof item.number !== 'number' || !Number.isSafeInteger(item.number) || item.number < 1 || item.number > 2147483647 || typeof item.fingerprint !== 'string' || !hashPattern.test(item.fingerprint) || typeof item.replace !== 'boolean') throw new Error('INVALID_FILE');
        items.push({ index, filename: item.filename, size: item.size, number: item.number, fingerprint: item.fingerprint, replace: item.replace });
      } catch { rejected.push({ index, filename: typeof (value as { filename?: unknown })?.filename === 'string' ? String((value as { filename: string }).filename).slice(0, 255) : '', reason: 'INVALID_FILE' }); }
    }
    const numbers = new Map<number, number>();
    for (const item of items) numbers.set(item.number, (numbers.get(item.number) ?? 0) + 1);
    const distinct = items.filter((item) => { if (numbers.get(item.number)! > 1) { rejected.push({ index: item.index, filename: item.filename, reason: 'DUPLICATE_NUMBER' }); return false; } return true; });
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM dramas WHERE id = ${dramaId}::uuid FOR UPDATE`;
      const drama = await tx.drama.findUnique({ where: { id: dramaId }, include: { draft: true } });
      if (!drama || !drama.draft) throw new NotFoundException();
      if (!editableDramaStatus(drama.status)) throw new ConflictException('Media editing for this drama status is not supported');
      const batch = await tx.mediaBatch.create({ data: { dramaId, createdBy: req.admin!.username, expiresAt: new Date(Date.now() + mediaConfig.uploadDays * 86400000) } });
      let accepted = 0;
      for (const item of distinct) {
        if (drama.draft.totalEpisodes === null || item.number > drama.draft.totalEpisodes) { rejected.push({ index: item.index, filename: item.filename, reason: 'EXCEEDS_TOTAL' }); continue; }
        let episode = await tx.episode.findUnique({ where: { dramaId_number: { dramaId, number: item.number } } });
        if (episode && !item.replace) { rejected.push({ index: item.index, filename: item.filename, reason: 'CONFIRM_REPLACE' }); continue; }
        if (episode && !['OFFLINE', 'PUBLISHED'].includes(episode.status)) { rejected.push({ index: item.index, filename: item.filename, reason: 'EPISODE_NOT_EDITABLE' }); continue; }
        if (!episode) episode = await tx.episode.create({ data: { dramaId, number: item.number, position: item.number } });
        const active = await tx.mediaUpload.findFirst({ where: { episodeId: episode.id, status: { in: ['UPLOADING', 'QUEUED', 'PROCESSING', 'CANCEL_REQUESTED'] } } });
        if (active) { rejected.push({ index: item.index, filename: item.filename, reason: 'ACTIVE_TASK' }); continue; }
        const upload = await tx.mediaUpload.create({ data: { batchId: batch.id, episodeId: episode.id, filename: item.filename, size: item.size, fingerprint: item.fingerprint, chunkSize: mediaConfig.chunkSize, chunkCount: Math.ceil(item.size / mediaConfig.chunkSize) } });
        await tx.episode.update({ where: { id: episode.id }, data: { pendingMediaId: upload.id } });
        accepted++;
      }
      if (!accepted) throw new ConflictException({ message: 'No valid files', rejected });
      await tx.drama.update({ where: { id: dramaId }, data: { updatedAt: new Date() } });
      const result = await tx.mediaBatch.findUniqueOrThrow({ where: { id: batch.id }, include: { items: { include } } });
      return { ...result, rejected };
    });
  }

  @Put('items/:id/chunks/:number')
  async chunk(@Param('id') id: string, @Param('number') indexValue: string, @Headers('x-chunk-sha256') sha: string | undefined, @Req() req: Request) {
    requireId(id);
    const number = Number(indexValue);
    const item = await this.prisma.mediaUpload.findUnique({ where: { id }, include: { batch: true } });
    if (!item) throw new NotFoundException();
    if (item.status !== 'UPLOADING' || item.batch.expiresAt <= new Date()) throw new ConflictException('Upload is not available');
    if (!Number.isSafeInteger(number) || number < 0 || number >= item.chunkCount || !sha || !hashPattern.test(sha)) throw new BadRequestException('Invalid chunk');
    const expected = Math.min(item.chunkSize, item.size - number * item.chunkSize);
    const dir = chunksDir(id); await mkdir(dir, { recursive: true, mode: 0o700 });
    const temporary = join(dir, `.${randomUUID()}.tmp`);
    const handle = await open(temporary, 'wx', 0o600);
    const hash = createHash('sha256'); let size = 0;
    try {
      for await (const raw of req) {
        const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
        size += chunk.length;
        if (size > expected) throw new BadRequestException('Chunk too large');
        hash.update(chunk);
        let offset = 0;
        while (offset < chunk.length) { const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset); if (!bytesWritten) throw new Error('Short write'); offset += bytesWritten; }
      }
      await handle.close();
      if (size !== expected || hash.digest('hex') !== sha) throw new BadRequestException('Chunk integrity mismatch');
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM media_uploads WHERE id = ${id}::uuid FOR UPDATE`;
        const latest = await tx.mediaUpload.findUnique({ where: { id }, include: { batch: true } });
        if (!latest || latest.status !== 'UPLOADING' || latest.batch.expiresAt <= new Date()) throw new ConflictException('Upload is not available');
        const old = await tx.mediaChunk.findUnique({ where: { uploadId_number: { uploadId: id, number } } });
        if (old && (old.sha256 !== sha || old.size !== size)) throw new ConflictException('Chunk differs from previous upload');
        await rename(temporary, chunkPath(id, number, sha));
        if (!old) await tx.mediaChunk.create({ data: { uploadId: id, number, size, sha256: sha } });
        return { number, size };
      });
    } finally {
      await handle.close().catch(() => undefined);
      await unlink(temporary).catch(() => undefined);
    }
  }

  @Post('items/:id/complete')
  async complete(@Param('id') id: string) {
    requireId(id);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM media_uploads WHERE id = ${id}::uuid FOR UPDATE`;
      const item = await tx.mediaUpload.findUnique({ where: { id }, include: { batch: true, chunks: { orderBy: { number: 'asc' } }, episode: true } });
      if (!item) throw new NotFoundException();
      if (item.status === 'QUEUED' || item.status === 'PROCESSING' || item.status === 'READY') return { status: item.status };
      if (item.status !== 'UPLOADING' || item.batch.expiresAt <= new Date() || item.episode.pendingMediaId !== id) throw new ConflictException('Upload is not available');
      if (item.chunks.length !== item.chunkCount || item.chunks.some((chunk, index) => chunk.number !== index || chunk.size !== Math.min(item.chunkSize, item.size - index * item.chunkSize))) throw new BadRequestException('Upload is incomplete');
      const root = createHash('sha256').update(Buffer.concat(item.chunks.map((chunk) => Buffer.from(chunk.sha256, 'hex')))).digest('hex');
      if (root !== item.fingerprint) throw new BadRequestException('File fingerprint mismatch');
      await tx.mediaUpload.update({ where: { id }, data: { status: 'QUEUED', phase: 'DETECT', uploadedAt: new Date() } });
      return { status: 'QUEUED' };
    });
  }

  @Post('batches/:id/cancel')
  async cancel(@Param('id') id: string) {
    requireId(id);
    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.mediaBatch.findUnique({ where: { id }, include: { items: { include: { episode: true } } } });
      if (!batch) throw new NotFoundException();
      for (const item of batch.items) {
        if (['UPLOADING', 'QUEUED', 'FAILED'].includes(item.status)) {
          const keepSelected = item.episode.draftMediaId === item.id;
          const updated = await tx.mediaUpload.updateMany({ where: { id: item.id, status: { in: ['UPLOADING', 'QUEUED', 'FAILED'] } }, data: keepSelected ? { status: 'READY', phase: 'DONE', previewStatus: 'FAILED', error: 'Preview regeneration cancelled' } : { status: 'CANCELLED', error: null } });
          if (updated.count) await tx.episode.updateMany({ where: { id: item.episodeId, pendingMediaId: item.id }, data: { pendingMediaId: null } });
          else await tx.mediaUpload.updateMany({ where: { id: item.id, status: 'PROCESSING' }, data: { status: 'CANCEL_REQUESTED' } });
        } else if (item.status === 'PROCESSING') await tx.mediaUpload.updateMany({ where: { id: item.id, status: 'PROCESSING' }, data: { status: 'CANCEL_REQUESTED' } });
      }
      return { ok: true };
    });
  }

  @Post('batches/:id/retry')
  async retry(@Param('id') id: string) {
    requireId(id);
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.mediaBatch.findUnique({ where: { id }, select: { dramaId: true } });
      if (!target) throw new NotFoundException();
      await tx.$queryRaw`SELECT id FROM dramas WHERE id = ${target.dramaId}::uuid FOR UPDATE`;
      const batch = await tx.mediaBatch.findUnique({ where: { id }, include: { items: { include: { episode: { include: { drama: true } } } } } });
      if (!batch) throw new NotFoundException();
      let queued = 0;
      for (const item of batch.items) {
        if (item.status !== 'FAILED' || item.episode.pendingMediaId !== item.id || !['OFFLINE', 'PUBLISHED'].includes(item.episode.status) || !editableDramaStatus(item.episode.drama.status)) continue;
        const reset = item.phase === 'DETECT' ? { detectStatus: 'PENDING' } : item.phase === 'TRANSCODE' ? { transcodeStatus: 'PENDING' } : item.phase === 'COVER' ? { coverStatus: 'PENDING' } : { previewStatus: 'PENDING' };
        const result = await tx.mediaUpload.updateMany({ where: { id: item.id, status: 'FAILED' }, data: { ...reset, status: 'QUEUED', error: null } });
        queued += result.count;
      }
      return { queued };
    });
  }

  @Post('items/:id/regenerate-preview')
  async regenerate(@Param('id') id: string) {
    requireId(id);
    const target = await this.prisma.mediaUpload.findUnique({ where: { id }, include: { episode: true } });
    if (!target) throw new NotFoundException();
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM dramas WHERE id = ${target.episode.dramaId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM media_uploads WHERE id = ${id}::uuid FOR UPDATE`;
      const item = await tx.mediaUpload.findUnique({ where: { id }, include: { episode: { include: { drama: true } } } });
      if (!item || item.status !== 'READY' || item.episode.draftMediaId !== id || item.episode.pendingMediaId || !['OFFLINE', 'PUBLISHED'].includes(item.episode.status) || !editableDramaStatus(item.episode.drama.status)) throw new ConflictException('Media is not available for regeneration');
      await tx.episode.update({ where: { id: item.episodeId }, data: { pendingMediaId: id } });
      await tx.mediaUpload.update({ where: { id }, data: { status: 'QUEUED', phase: 'PREVIEW', previewStatus: 'PENDING', error: null } });
      return { status: 'QUEUED' };
    });
  }

  @Get('items/:id/covers')
  async covers(@Param('id') id: string) {
    requireId(id);
    const item = await this.prisma.mediaUpload.findUnique({ where: { id } });
    if (!item || item.coverStatus !== 'SUCCEEDED') throw new NotFoundException();
    const names = (await readdir(mediaDir(id))).filter((name) => safeCoverPattern.test(name)).sort();
    return { names, selected: item.selectedCover };
  }

  @Get('items/:id/cover/:name')
  async cover(@Param('id') id: string, @Param('name') name: string, @Res({ passthrough: true }) res: Response) {
    requireId(id);
    if (!safeCoverPattern.test(name)) throw new NotFoundException();
    const item = await this.prisma.mediaUpload.findUnique({ where: { id } });
    if (!item || item.coverStatus !== 'SUCCEEDED') throw new NotFoundException();
    const path = join(mediaDir(id), name);
    try { await stat(path); } catch { throw new NotFoundException(); }
    res.setHeader('Content-Type', 'image/jpeg');
    return new StreamableFile(createReadStream(path));
  }

  @Get('items/:id/video')
  async video(@Param('id') id: string, @Headers('range') range: string | undefined, @Res({ passthrough: true }) res: Response) {
    requireId(id);
    const item = await this.prisma.mediaUpload.findUnique({ where: { id }, include: { episode: true } });
    if (!item || item.transcodeStatus !== 'SUCCEEDED' || item.episode.draftMediaId !== id) throw new NotFoundException();
    const path = join(mediaDir(id), 'output.mp4');
    let size: number;
    try { size = (await stat(path)).size; } catch { throw new NotFoundException(); }
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    if (!range) { res.setHeader('Content-Length', size); return new StreamableFile(createReadStream(path)); }
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) { res.setHeader('Content-Range', `bytes */${size}`); throw new HttpException('Invalid range', 416); }
    const suffix = !match[1] ? Number(match[2]) : null;
    const start = suffix === null ? Number(match[1]) : Math.max(0, size - suffix), end = suffix === null && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) { res.setHeader('Content-Range', `bytes */${size}`); throw new HttpException('Invalid range', 416); }
    res.status(206); res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`); res.setHeader('Content-Length', end - start + 1);
    return new StreamableFile(createReadStream(path, { start, end }));
  }

  @Post('items/:id/frames')
  async frame(@Param('id') id: string, @Body() body: unknown) {
    requireId(id);
    const time = object(body).seconds;
    const item = await this.prisma.mediaUpload.findUnique({ where: { id }, include: { episode: true } });
    if (!item || item.status !== 'READY' || item.episode.draftMediaId !== id || !item.duration) throw new NotFoundException();
    if (typeof time !== 'number' || !Number.isFinite(time) || time < 0 || time >= item.duration) throw new BadRequestException('Invalid timestamp');
    const name = `manual-${randomUUID()}.jpg`;
    await runFile('ffmpeg', ['-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-ss', String(time), '-i', join(mediaDir(id), 'output.mp4'), '-frames:v', '1', '-y', join(mediaDir(id), name)], { timeout: 60000, maxBuffer: 1024 * 1024 });
    try { if (!(await stat(join(mediaDir(id), name))).size) throw new Error('Empty frame'); } catch { throw new BadRequestException('Could not extract frame at this time'); }
    return { name };
  }

  @Put('items/:id/cover')
  async selectCover(@Param('id') id: string, @Body() body: unknown) {
    requireId(id); const name = object(body).name;
    if (typeof name !== 'string' || !safeCoverPattern.test(name)) throw new BadRequestException('Invalid cover');
    try { await stat(join(mediaDir(id), name)); } catch { throw new NotFoundException(); }
    const target = await this.prisma.mediaUpload.findUnique({ where: { id }, include: { episode: true } });
    if (!target) throw new NotFoundException();
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM dramas WHERE id = ${target.episode.dramaId}::uuid FOR UPDATE`;
      const item = await tx.mediaUpload.findUnique({ where: { id }, include: { episode: { include: { drama: true } } } });
      if (!item || item.status !== 'READY' || item.episode.draftMediaId !== id || !['OFFLINE', 'PUBLISHED'].includes(item.episode.status) || !editableDramaStatus(item.episode.drama.status)) throw new ConflictException('Media is not editable');
      await tx.mediaUpload.update({ where: { id }, data: { selectedCover: name } });
      return { name };
    });
  }
}
