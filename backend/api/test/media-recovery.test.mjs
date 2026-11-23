import 'dotenv/config';
import { randomBytes, createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { chunksDir, chunkPath, mediaDir } from '../dist/media-common.js';

const hash = (data) => createHash('sha256').update(data).digest('hex');
test('worker restart resumes interrupted tasks and preserves selected media on cancellation', { skip: process.env.TEST_WORKER_RECOVERY !== '1', timeout: 90000 }, async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const tmp = await mkdtemp(join(tmpdir(), 'red-video-recovery-'));
  let dramaId, batchId, worker; const uploadIds = [];
  try {
    const source = join(tmp, 'sample.mp4');
    execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=24', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', source]);
    const bytes = await readFile(source), digest = hash(bytes), fingerprint = hash(Buffer.from(digest, 'hex'));
    const drama = await prisma.drama.create({ data: { draft: { create: { totalEpisodes: 2, translations: { create: [{ locale: 'en', title: `recovery ${randomBytes(6).toString('hex')}` }] } } } } }); dramaId = drama.id;
    const first = await prisma.episode.create({ data: { dramaId, number: 1, position: 1 } });
    const second = await prisma.episode.create({ data: { dramaId, number: 2, position: 2 } });
    const batch = await prisma.mediaBatch.create({ data: { dramaId, createdBy: 'test', expiresAt: new Date(Date.now() + 86400000) } }); batchId = batch.id;
    const interrupted = await prisma.mediaUpload.create({ data: { batchId, episodeId: first.id, filename: '01.mp4', size: bytes.length, fingerprint, chunkSize: 5 * 1024 * 1024, chunkCount: 1, status: 'PROCESSING', phase: 'DETECT', detectStatus: 'RUNNING', uploadedAt: new Date(), chunks: { create: { number: 0, size: bytes.length, sha256: digest } } } }); uploadIds.push(interrupted.id);
    const cancelling = await prisma.mediaUpload.create({ data: { batchId, episodeId: second.id, filename: '02.mp4', size: bytes.length, fingerprint, chunkSize: 5 * 1024 * 1024, chunkCount: 1, status: 'CANCEL_REQUESTED', phase: 'PREVIEW', previewStatus: 'RUNNING', uploadedAt: new Date() } }); uploadIds.push(cancelling.id);
    await prisma.episode.update({ where: { id: first.id }, data: { pendingMediaId: interrupted.id } });
    await prisma.episode.update({ where: { id: second.id }, data: { draftMediaId: cancelling.id, pendingMediaId: cancelling.id } });
    await mkdir(chunksDir(interrupted.id), { recursive: true }); await writeFile(chunkPath(interrupted.id, 0, digest), bytes);
    worker = spawn(process.execPath, ['dist/media-worker.js'], { cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let logs = ''; worker.stdout.on('data', (data) => { logs += data; }); worker.stderr.on('data', (data) => { logs += data; });
    let item;
    for (let i = 0; i < 600; i++) { item = await prisma.mediaUpload.findUnique({ where: { id: interrupted.id } }); if (item?.status === 'READY' || item?.status === 'FAILED' || worker.exitCode !== null) break; await new Promise((resolve) => setTimeout(resolve, 100)); }
    assert.equal(item?.status, 'READY', `${item?.error ?? ''} ${logs}`);
    assert.equal((await prisma.episode.findUnique({ where: { id: first.id } })).draftMediaId, interrupted.id);
    const restored = await prisma.mediaUpload.findUnique({ where: { id: cancelling.id } });
    assert.equal(restored.status, 'READY'); assert.equal(restored.previewStatus, 'FAILED');
    const secondResult = await prisma.episode.findUnique({ where: { id: second.id } });
    assert.equal(secondResult.draftMediaId, cancelling.id); assert.equal(secondResult.pendingMediaId, null);
  } finally {
    if (worker && worker.exitCode === null) { worker.kill('SIGINT'); await once(worker, 'close'); }
    if (batchId) await prisma.mediaBatch.delete({ where: { id: batchId } });
    if (dramaId) await prisma.drama.delete({ where: { id: dramaId } });
    await prisma.$disconnect();
    for (const id of uploadIds) await rm(mediaDir(id), { recursive: true, force: true });
    await rm(tmp, { recursive: true, force: true });
  }
});
