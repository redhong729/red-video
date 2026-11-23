import 'dotenv/config';
import { randomBytes, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, appendFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { hashPassword } from '../dist/password.js';

const base = process.env.TEST_API_URL;
const origin = process.env.ADMIN_ORIGIN ?? 'http://127.0.0.1:3001';
const hash = (data) => createHash('sha256').update(data).digest('hex');
test('resumable upload, transcoding, preview, cover and safe replacement', { skip: !base || process.env.TEST_MEDIA !== '1', timeout: 120000 }, async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const username = `media_test_${randomBytes(8).toString('hex')}`, password = randomBytes(24).toString('base64url');
  const tmp = await mkdtemp(join(tmpdir(), 'red-video-media-test-')); const uploads = []; const batches = [];
  let user, dramaId;
  try {
    const sample = join(tmp, 'sample.mp4');
    execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-y', sample]);
    await appendFile(sample, Buffer.alloc(5 * 1024 * 1024));
    const data = await readFile(sample);
    user = await prisma.adminUser.create({ data: { username, passwordHash: await hashPassword(password) } });
    const call = (path, options = {}) => fetch(`${base}${path}`, { ...options, headers: { origin, ...options.headers } });
    const login = await call('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
    assert.equal(login.status, 200); const cookie = login.headers.get('set-cookie').split(';')[0];
    const read = async (path) => { const r = await call(path, { headers: { cookie } }); assert.equal(r.status, 200); return r.json(); };
    const post = (path, body, method = 'POST') => call(path, { method, headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const drama = await post('/api/dramas', { translations: [{ locale: 'en', title: 'media test', description: '' }], categoryId: null, tagIds: [], actors: [], totalEpisodes: 3, sortOrder: 0, pricingMode: 'PER_EPISODE', freeEpisodes: 0, priceCredits: 5, previewSeconds: 1 });
    assert.equal(drama.status, 201); dramaId = (await drama.json()).id;
    const episode = await post(`/api/dramas/${dramaId}/episodes`, { number: 1, translations: [], priceMode: null, priceCredits: null, previewSeconds: null });
    assert.equal(episode.status, 201); const episodeId = (await episode.json()).id;
    const config = await read('/api/media/config');
    const pieces = []; for (let offset = 0; offset < data.length; offset += config.chunkSize) pieces.push(data.subarray(offset, Math.min(data.length, offset + config.chunkSize)));
    assert.ok(pieces.length >= 2);
    const digests = pieces.map(hash), fingerprint = hash(Buffer.concat(digests.map((v) => Buffer.from(v, 'hex'))));
    const file = { filename: '01.mp4', size: data.length, number: 1, fingerprint, replace: false };
    assert.equal((await post('/api/media/batches', { dramaId, items: [file] })).status, 409);
    const created = await post('/api/media/batches', { dramaId, items: [{ ...file, replace: true }] }); assert.equal(created.status, 201);
    const batch = await created.json(); batches.push(batch.id); const upload = batch.items[0]; uploads.push(upload.id);
    const send = (index, digest = digests[index]) => call(`/api/media/items/${upload.id}/chunks/${index}`, { method: 'PUT', headers: { cookie, 'content-type': 'application/octet-stream', 'x-chunk-sha256': digest }, body: pieces[index] });
    assert.equal((await send(1, '0'.repeat(64))).status, 400);
    assert.equal((await send(1)).status, 200);
    assert.equal((await post(`/api/media/items/${upload.id}/complete`, {})).status, 400);
    const resumed = (await read(`/api/media/batches?dramaId=${dramaId}`))[0].items[0]; assert.deepEqual(resumed.chunks.map((c) => c.number), [1]);
    assert.equal((await send(0)).status, 200); assert.equal((await send(0)).status, 200);
    assert.equal((await post(`/api/media/items/${upload.id}/complete`, {})).status, 201);
    let result;
    for (let i = 0; i < 600; i++) { result = (await read(`/api/media/batches?dramaId=${dramaId}`))[0].items[0]; if (['READY', 'FAILED', 'CANCELLED'].includes(result.status)) break; await new Promise((r) => setTimeout(r, 100)); }
    assert.equal(result.status, 'READY', result.error);
    assert.equal(result.detectStatus, 'SUCCEEDED'); assert.equal(result.transcodeStatus, 'SUCCEEDED'); assert.equal(result.coverStatus, 'SUCCEEDED'); assert.equal(result.previewStatus, 'SUCCEEDED'); assert.equal(result.previewSeconds, 1);
    const dir = join(resolve('../../storage'), 'media', upload.id);
    const metadata = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', join(dir, 'output.mp4')], { encoding: 'utf8' }));
    const videoStream = metadata.streams.find((s) => s.codec_type === 'video');
    assert.equal(videoStream.codec_name, 'h264'); assert.equal(videoStream.width, 320); assert.equal(videoStream.height, 240);
    assert.equal(metadata.streams.find((s) => s.codec_type === 'audio').codec_name, 'aac');
    const preview = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-of', 'json', join(dir, `preview-${result.previewSignature}.mp4`)], { encoding: 'utf8' }));
    assert.ok(Number(preview.format.duration) < Number(metadata.format.duration));
    assert.equal((await call(`/api/media/items/${upload.id}/cover/candidate-0.jpg`, { headers: { cookie } })).status, 200);
    const frame = await post(`/api/media/items/${upload.id}/frames`, { seconds: 0.5 }); assert.equal(frame.status, 201);
    const frameName = (await frame.json()).name;
    assert.equal((await post(`/api/media/items/${upload.id}/cover`, { name: frameName }, 'PUT')).status, 200);
    assert.equal((await prisma.episode.findUnique({ where: { id: episodeId } })).draftMediaId, upload.id);
    assert.equal((await post(`/api/dramas/${dramaId}/cover/from-frame`, { mediaId: upload.id, name: '../candidate-0.jpg' })).status, 400);
    assert.equal((await post(`/api/dramas/${dramaId}/cover/from-frame`, { mediaId: upload.id, name: frameName })).status, 201);
    const dramaCover = await call(`/api/dramas/${dramaId}/cover`, { headers: { cookie } });
    assert.equal(dramaCover.status, 200); assert.deepEqual(Buffer.from(await dramaCover.arrayBuffer()), await readFile(join(dir, frameName)));
    assert.equal((await prisma.mediaUpload.findUnique({ where: { id: upload.id } })).selectedCover, frameName);
    assert.equal((await call(`/api/media/items/${upload.id}/video`)).status, 401);
    const range = await call(`/api/media/items/${upload.id}/video`, { headers: { cookie, range: 'bytes=0-15' } });
    assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 16);
    const suffix = await call(`/api/media/items/${upload.id}/video`, { headers: { cookie, range: 'bytes=-16' } });
    assert.equal(suffix.status, 206); assert.equal((await suffix.arrayBuffer()).byteLength, 16);
    // 试看重新处理期间，已选用的视频仍可预览。
    await prisma.mediaUpload.update({ where: { id: upload.id }, data: { status: 'PROCESSING', phase: 'PREVIEW' } });
    const duringPreview = await call(`/api/media/items/${upload.id}/video`, { headers: { cookie, range: 'bytes=0-15' } });
    assert.equal(duringPreview.status, 206); await duringPreview.arrayBuffer();
    await prisma.mediaUpload.update({ where: { id: upload.id }, data: { status: 'READY' } });
    assert.equal((await read(`/api/dramas?keyword=${dramaId}`)).items[0].uploadedEpisodes, 1);
    const configChange = await post(`/api/dramas/${dramaId}/episodes/${episodeId}`, { number: 1, translations: [], priceMode: null, priceCredits: null, previewSeconds: 0 }, 'PUT');
    assert.equal(configChange.status, 200);
    assert.equal((await read(`/api/dramas/${dramaId}/episodes`)).items[0].previewCurrent, false);
    assert.equal((await post(`/api/media/items/${upload.id}/regenerate-preview`, {})).status, 201);
    for (let i = 0; i < 400; i++) { result = (await read(`/api/media/batches?dramaId=${dramaId}`)).find((entry) => entry.id === batch.id).items[0]; if (result.status === 'READY' || result.status === 'FAILED') break; await new Promise((r) => setTimeout(r, 100)); }
    assert.equal(result.status, 'READY', result.error); assert.equal(result.previewStatus, 'NOT_REQUIRED');
    assert.equal((await read(`/api/dramas/${dramaId}/episodes`)).items[0].previewCurrent, true);
    const partial = await post('/api/media/batches', { dramaId, items: [file, { ...file, filename: '02.mp4', number: 2 }] });
    assert.equal(partial.status, 201); const partialBatch = await partial.json(); batches.push(partialBatch.id); uploads.push(partialBatch.items[0].id);
    assert.equal(partialBatch.rejected[0].reason, 'CONFIRM_REPLACE'); assert.equal(partialBatch.items[0].episode.number, 2);
    assert.equal((await post(`/api/media/batches/${partialBatch.id}/cancel`, {})).status, 201);
    const replace = await post('/api/media/batches', { dramaId, items: [{ ...file, replace: true }] }); assert.equal(replace.status, 201);
    const replacement = await replace.json(); batches.push(replacement.id); uploads.push(replacement.items[0].id);
    assert.equal((await post(`/api/media/batches/${replacement.id}/cancel`, {})).status, 201);
    assert.equal((await prisma.episode.findUnique({ where: { id: episodeId } })).draftMediaId, upload.id);
    // 损坏的媒体只标记检测失败，可人工重试，再取消而不影响已完成版本。
    const corrupt = Buffer.from('not a valid video'); const corruptHash = hash(corrupt);
    const bad = await post('/api/media/batches', { dramaId, items: [{ filename: '03.mp4', size: corrupt.length, number: 3, fingerprint: hash(Buffer.from(corruptHash, 'hex')), replace: false }] });
    assert.equal(bad.status, 201); const badBatch = await bad.json(); batches.push(badBatch.id); const badId = badBatch.items[0].id; uploads.push(badId);
    assert.equal((await call(`/api/media/items/${badId}/chunks/0`, { method: 'PUT', headers: { cookie, 'content-type': 'application/octet-stream', 'x-chunk-sha256': corruptHash }, body: corrupt })).status, 200);
    assert.equal((await post(`/api/media/items/${badId}/complete`, {})).status, 201);
    let badState;
    for (let i = 0; i < 300; i++) { badState = await prisma.mediaUpload.findUnique({ where: { id: badId } }); if (badState.status === 'FAILED') break; await new Promise((r) => setTimeout(r, 100)); }
    assert.equal(badState.status, 'FAILED'); assert.equal(badState.detectStatus, 'FAILED');
    assert.equal((await post(`/api/media/batches/${badBatch.id}/retry`, {})).status, 201);
    for (let i = 0; i < 300; i++) { badState = await prisma.mediaUpload.findUnique({ where: { id: badId } }); if (badState.status === 'FAILED') break; await new Promise((r) => setTimeout(r, 100)); }
    assert.equal(badState.status, 'FAILED');
    assert.equal((await post(`/api/media/batches/${badBatch.id}/cancel`, {})).status, 201);
    assert.equal((await prisma.mediaUpload.findUnique({ where: { id: badId } })).status, 'CANCELLED');
    assert.equal((await prisma.episode.findUnique({ where: { id: episodeId } })).draftMediaId, upload.id);
    // 执行中的任务需在工作进程确认停止后才变为已取消。
    const live = await post('/api/media/batches', { dramaId, items: [{ ...file, filename: '02.mp4', number: 2, replace: true }] });
    assert.equal(live.status, 201); const liveBatch = await live.json(); batches.push(liveBatch.id); const liveId = liveBatch.items[0].id; uploads.push(liveId);
    for (let i = 0; i < pieces.length; i++) assert.equal((await call(`/api/media/items/${liveId}/chunks/${i}`, { method: 'PUT', headers: { cookie, 'content-type': 'application/octet-stream', 'x-chunk-sha256': digests[i] }, body: pieces[i] })).status, 200);
    assert.equal((await post(`/api/media/items/${liveId}/complete`, {})).status, 201);
    let liveState;
    for (let i = 0; i < 500; i++) { liveState = await prisma.mediaUpload.findUnique({ where: { id: liveId } }); if (liveState.status === 'PROCESSING' || liveState.status === 'READY') break; await new Promise((r) => setTimeout(r, 20)); }
    assert.equal(liveState.status, 'PROCESSING');
    assert.equal((await post(`/api/media/batches/${liveBatch.id}/cancel`, {})).status, 201);
    for (let i = 0; i < 300; i++) { liveState = await prisma.mediaUpload.findUnique({ where: { id: liveId } }); if (liveState.status === 'CANCELLED' || liveState.status === 'READY') break; await new Promise((r) => setTimeout(r, 100)); }
    assert.equal(liveState.status, 'CANCELLED');
    assert.equal((await prisma.episode.findUnique({ where: { id: episodeId } })).draftMediaId, upload.id);
    // 竖屏低分辨率无音轨输入保持比例、不放大，免费集不生成试看。
    const episodeTwo = partialBatch.items[0].episodeId;
    assert.equal((await post(`/api/dramas/${dramaId}/episodes/${episodeTwo}`, { number: 2, translations: [], priceMode: 'FREE', priceCredits: null, previewSeconds: null }, 'PUT')).status, 200);
    const portraitPath = join(tmp, 'portrait.mp4');
    execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=180x320:rate=24', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', portraitPath]);
    const portrait = await readFile(portraitPath), portraitHash = hash(portrait);
    const portraitResponse = await post('/api/media/batches', { dramaId, items: [{ filename: '02.mp4', size: portrait.length, number: 2, fingerprint: hash(Buffer.from(portraitHash, 'hex')), replace: true }] });
    assert.equal(portraitResponse.status, 201); const portraitBatch = await portraitResponse.json(); batches.push(portraitBatch.id); const portraitId = portraitBatch.items[0].id; uploads.push(portraitId);
    assert.equal((await call(`/api/media/items/${portraitId}/chunks/0`, { method: 'PUT', headers: { cookie, 'content-type': 'application/octet-stream', 'x-chunk-sha256': portraitHash }, body: portrait })).status, 200);
    assert.equal((await post(`/api/media/items/${portraitId}/complete`, {})).status, 201);
    let portraitState;
    for (let i = 0; i < 400; i++) { portraitState = await prisma.mediaUpload.findUnique({ where: { id: portraitId } }); if (portraitState.status === 'READY' || portraitState.status === 'FAILED') break; await new Promise((r) => setTimeout(r, 100)); }
    assert.equal(portraitState.status, 'READY', portraitState.error); assert.equal(portraitState.previewStatus, 'NOT_REQUIRED');
    const portraitMetadata = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', join(resolve('../../storage'), 'media', portraitId, 'output.mp4')], { encoding: 'utf8' }));
    const portraitStream = portraitMetadata.streams.find((stream) => stream.codec_type === 'video');
    assert.equal(portraitStream.width, 180); assert.equal(portraitStream.height, 320); assert.equal(portraitMetadata.streams.some((stream) => stream.codec_type === 'audio'), false);
  } finally {
    if (batches.length) await prisma.mediaBatch.deleteMany({ where: { id: { in: batches } } });
    if (dramaId) await prisma.drama.delete({ where: { id: dramaId } });
    if (user) await prisma.adminUser.delete({ where: { id: user.id } });
    await prisma.$disconnect();
    for (const id of uploads) await rm(join(resolve('../../storage'), 'media', id), { recursive: true, force: true });
    if (dramaId) await rm(join(resolve('../../storage'), 'drama-covers', dramaId), { recursive: true, force: true });
    await rm(tmp, { recursive: true, force: true });
  }
});
