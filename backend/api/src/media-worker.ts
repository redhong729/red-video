import 'dotenv/config';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rename, stat } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';
import { chunkPath, mediaDir, mediaWorkerLockKey } from './media-common.js';
import { previewConfig } from './preview-config.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const dbUrl = new URL(connectionString); dbUrl.searchParams.delete('schema');
const lock = new pg.Client({ connectionString: dbUrl.toString() });
process.umask(0o077);
let stopping = false;
let running: ChildProcess | null = null;
class Cancelled extends Error {}
class Permanent extends Error {}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function check(id: string) {
  const item = await prisma.mediaUpload.findUnique({ where: { id }, select: { status: true } });
  if (item?.status === 'CANCEL_REQUESTED' || item?.status === 'CANCELLED') throw new Cancelled();
  if (!item || item.status !== 'PROCESSING' || stopping) throw new Error('Worker stopped');
}

async function command(id: string, bin: string, args: string[]): Promise<string> {
  await check(id);
  return new Promise((resolve, reject) => {
    let out = '', err = '', cancelled = false, checking = false;
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    running = child;
    child.stdout?.on('data', (data: Buffer) => { out = (out + data.toString()).slice(-1024 * 1024); });
    child.stderr?.on('data', (data: Buffer) => { err = (err + data.toString()).slice(-8192); });
    const poll = setInterval(() => {
      if (checking) return;
      checking = true;
      void check(id).catch((error: unknown) => { cancelled = error instanceof Cancelled; child.kill('SIGTERM'); }).finally(() => { checking = false; });
    }, 300);
    child.on('error', (error) => { clearInterval(poll); running = null; reject(error); });
    child.on('close', (code) => {
      clearInterval(poll); running = null;
      if (cancelled) reject(new Cancelled());
      else if (stopping) reject(new Error('Worker stopped'));
      else if (code !== 0) {
        const detail = `${bin} failed: ${err.trim().slice(-500)}`;
        if (/temporarily unavailable|resource busy|timed out|input\/output error|no space left/i.test(err)) reject(new Error(detail));
        else reject(new Permanent(detail));
      }
      else resolve(out);
    });
  });
}

type Phase = 'DETECT' | 'TRANSCODE' | 'COVER' | 'PREVIEW';
const field: Record<Phase, 'detectStatus' | 'transcodeStatus' | 'coverStatus' | 'previewStatus'> = { DETECT: 'detectStatus', TRANSCODE: 'transcodeStatus', COVER: 'coverStatus', PREVIEW: 'previewStatus' };
async function phase(id: string, name: Phase, action: () => Promise<void | 'NOT_REQUIRED' | 'NOT_CONFIGURED'>) {
  const current = await prisma.mediaUpload.findUniqueOrThrow({ where: { id } });
  if (current[field[name]] === 'SUCCEEDED' || current[field[name]] === 'NOT_REQUIRED' || current[field[name]] === 'NOT_CONFIGURED') return;
  for (let attempt = 0; attempt < 3; attempt++) {
    await check(id);
    await prisma.mediaUpload.updateMany({ where: { id, status: 'PROCESSING' }, data: { phase: name, [field[name]]: 'RUNNING', error: null } });
    try {
      const outcome = await action(); await check(id);
      await prisma.mediaUpload.updateMany({ where: { id, status: 'PROCESSING' }, data: { [field[name]]: outcome ?? 'SUCCEEDED' } });
      return;
    } catch (error) {
      if (error instanceof Cancelled || stopping) throw error;
      if (error instanceof Permanent || attempt === 2) {
        const message = error instanceof Error ? error.message.slice(0, 500) : 'Processing failed';
        await prisma.mediaUpload.updateMany({ where: { id, status: 'PROCESSING' }, data: { status: 'FAILED', phase: name, [field[name]]: 'FAILED', error: message } });
        throw error;
      }
      await sleep(500 * (attempt + 1));
    }
  }
}

async function assemble(id: string) {
  const item = await prisma.mediaUpload.findUniqueOrThrow({ where: { id }, include: { chunks: { orderBy: { number: 'asc' } } } });
  const dir = mediaDir(id); await mkdir(dir, { recursive: true, mode: 0o700 });
  try { if ((await stat(join(dir, 'source.mp4'))).size === item.size) return; } catch { /* assemble */ }
  if (item.chunks.length !== item.chunkCount) throw new Permanent('Upload chunks are missing');
  const handle = await open(join(dir, 'source.tmp'), 'w', 0o600);
  try {
    for (const chunk of item.chunks) {
      await check(id);
      const digest = createHash('sha256'); let size = 0;
      for await (const data of createReadStream(chunkPath(id, chunk.number, chunk.sha256))) {
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
        digest.update(buffer); size += buffer.length;
        let offset = 0;
        while (offset < buffer.length) { const { bytesWritten } = await handle.write(buffer, offset, buffer.length - offset); if (!bytesWritten) throw new Error('Short write'); offset += bytesWritten; }
      }
      if (size !== chunk.size || digest.digest('hex') !== chunk.sha256) throw new Permanent('Upload chunk integrity check failed');
    }
  } finally { await handle.close(); }
  await rename(join(dir, 'source.tmp'), join(dir, 'source.mp4'));
}

async function processItem(id: string) {
  const dir = mediaDir(id);
  try {
    await phase(id, 'DETECT', async () => {
      await assemble(id);
      const output = await command(id, 'ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_streams', '-show_format', '-of', 'json', join(dir, 'source.mp4')]);
      let info: { streams?: { codec_type?: string; width?: number; height?: number }[]; format?: { format_name?: string; duration?: string } };
      try { info = JSON.parse(output); } catch { throw new Permanent('Media metadata is invalid'); }
      const video = info.streams?.find((stream) => stream.codec_type === 'video');
      const duration = Number(info.format?.duration);
      if (!info.format?.format_name?.split(',').includes('mp4') || !video?.width || !video.height || !Number.isFinite(duration) || duration <= 0) throw new Permanent('Unsupported or damaged MP4');
      await prisma.mediaUpload.update({ where: { id }, data: { duration, hasAudio: !!info.streams?.some((stream) => stream.codec_type === 'audio') } });
    });
    await phase(id, 'TRANSCODE', async () => {
      await command(id, 'ffmpeg', ['-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-i', join(dir, 'source.mp4'), '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-vf', "scale=w='if(gte(iw,ih),min(1920,iw),min(1080,iw))':h='if(gte(iw,ih),min(1080,ih),min(1920,ih))':force_original_aspect_ratio=decrease:force_divisible_by=2", '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-y', join(dir, 'output.tmp.mp4')]);
      await rename(join(dir, 'output.tmp.mp4'), join(dir, 'output.mp4'));
    });
    await phase(id, 'COVER', async () => {
      const item = await prisma.mediaUpload.findUniqueOrThrow({ where: { id } });
      if (!item.duration) throw new Permanent('Duration is missing');
      for (const [index, fraction] of [0.1, 0.5, 0.9].entries()) {
        await command(id, 'ffmpeg', ['-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-ss', String(Math.max(0, Math.min(item.duration - 0.05, item.duration * fraction))), '-i', join(dir, 'output.mp4'), '-frames:v', '1', '-y', join(dir, `candidate-${index}.jpg`)]);
        if (!(await stat(join(dir, `candidate-${index}.jpg`))).size) throw new Permanent('Cover extraction failed');
      }
    });
    await phase(id, 'PREVIEW', async () => {
      const item = await prisma.mediaUpload.findUniqueOrThrow({ where: { id }, include: { episode: { include: { drama: { include: { draft: true } } } } } });
      const episode = item.episode, draft = episode.drama.draft;
      if (!draft || !item.duration) throw new Permanent('Drama configuration is missing');
      const config = previewConfig(draft, episode);
      if (config.kind !== 'REQUIRED') { await prisma.mediaUpload.update({ where: { id }, data: { previewSeconds: config.paid === null ? null : 0, previewSignature: config.signature } }); return config.kind; }
      const seconds = config.seconds;
      if (seconds >= item.duration) throw new Permanent('Preview must be shorter than the video');
      await command(id, 'ffmpeg', ['-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-i', join(dir, 'output.mp4'), '-t', String(seconds), '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '25', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-y', join(dir, 'preview.tmp.mp4')]);
      await rename(join(dir, 'preview.tmp.mp4'), join(dir, `preview-${config.signature}.mp4`));
      await prisma.mediaUpload.update({ where: { id }, data: { previewSeconds: seconds, previewSignature: config.signature } });
    });
    await check(id);
    const target = await prisma.mediaUpload.findUniqueOrThrow({ where: { id }, include: { episode: true } });
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM dramas WHERE id = ${target.episode.dramaId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM media_uploads WHERE id = ${id}::uuid FOR UPDATE`;
      const item = await tx.mediaUpload.findUniqueOrThrow({ where: { id }, include: { episode: { include: { drama: { include: { draft: true } } } } } });
      if (item.status !== 'PROCESSING' || item.episode.pendingMediaId !== id || !['OFFLINE', 'PUBLISHED'].includes(item.episode.status) || !['DRAFT', 'IN_REVIEW', 'PUBLISHED', 'OFFLINE'].includes(item.episode.drama.status) || !item.episode.drama.draft) throw new Cancelled();
      if (item.previewSignature !== previewConfig(item.episode.drama.draft, item.episode).signature) {
        await tx.mediaUpload.update({ where: { id }, data: { status: 'QUEUED', phase: 'PREVIEW', previewStatus: 'PENDING', error: null } });
        return;
      }
      await tx.episode.update({ where: { id: item.episodeId }, data: { draftMediaId: id, pendingMediaId: null } });
      await tx.mediaUpload.update({ where: { id }, data: { status: 'READY', phase: 'DONE', error: null } });
      await tx.drama.update({ where: { id: item.episode.dramaId }, data: { updatedAt: new Date() } });
    });
  } catch (error) {
    if (error instanceof Cancelled) {
      await prisma.$transaction(async (tx) => {
        const item = await tx.mediaUpload.findUnique({ where: { id } });
        if (!item) return;
        const episode = await tx.episode.findUnique({ where: { id: item.episodeId } });
        const keepSelected = episode?.draftMediaId === id;
        await tx.mediaUpload.updateMany({ where: { id, status: { in: ['CANCEL_REQUESTED', 'PROCESSING'] } }, data: keepSelected ? { status: 'READY', phase: 'DONE', previewStatus: 'FAILED', error: 'Preview regeneration cancelled' } : { status: 'CANCELLED', error: null } });
        await tx.episode.updateMany({ where: { id: item.episodeId, pendingMediaId: id }, data: { pendingMediaId: null } });
      });
    } else if (stopping) {
      await prisma.mediaUpload.updateMany({ where: { id, status: 'PROCESSING' }, data: { status: 'QUEUED' } });
    } else {
      console.error('Media task failed', id, error instanceof Error ? error.message : error);
      await prisma.mediaUpload.updateMany({ where: { id, status: 'PROCESSING' }, data: { status: 'FAILED', error: 'Processing failed' } });
      await prisma.$transaction(async (tx) => {
        const item = await tx.mediaUpload.findUnique({ where: { id }, include: { episode: true } });
        if (item && item.status === 'FAILED' && item.phase === 'PREVIEW' && item.episode.draftMediaId === id) {
          await tx.mediaUpload.update({ where: { id }, data: { status: 'READY' } });
          await tx.episode.updateMany({ where: { id: item.episodeId, pendingMediaId: id }, data: { pendingMediaId: null } });
        }
      });
    }
  }
}

async function main() {
  await lock.connect();
  const acquired = await lock.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [mediaWorkerLockKey]);
  if (!acquired.rows[0]?.locked) throw new Error('Another media worker is already running');
  await prisma.mediaUpload.updateMany({ where: { status: 'PROCESSING' }, data: { status: 'QUEUED' } });
  const cancellations = await prisma.mediaUpload.findMany({ where: { status: 'CANCEL_REQUESTED' } });
  for (const item of cancellations) await prisma.$transaction(async (tx) => { const episode = await tx.episode.findUnique({ where: { id: item.episodeId } }); const data = episode?.draftMediaId === item.id ? { status: 'READY', phase: 'DONE', previewStatus: 'FAILED', error: 'Preview regeneration cancelled' } : { status: 'CANCELLED' }; await tx.mediaUpload.updateMany({ where: { id: item.id, status: 'CANCEL_REQUESTED' }, data }); await tx.episode.updateMany({ where: { id: item.episodeId, pendingMediaId: item.id }, data: { pendingMediaId: null } }); });
  console.log('Media worker ready');
  while (!stopping) {
    const next = await prisma.mediaUpload.findFirst({ where: { status: 'QUEUED' }, orderBy: { createdAt: 'asc' } });
    if (!next) { await sleep(1000); continue; }
    const claim = await prisma.mediaUpload.updateMany({ where: { id: next.id, status: 'QUEUED' }, data: { status: 'PROCESSING' } });
    if (claim.count) await processItem(next.id);
  }
}
process.on('SIGINT', () => { stopping = true; running?.kill('SIGTERM'); });
process.on('SIGTERM', () => { stopping = true; running?.kill('SIGTERM'); });
main().catch((error: unknown) => { console.error('Media worker failed:', error); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); await lock.end().catch(() => undefined); });
