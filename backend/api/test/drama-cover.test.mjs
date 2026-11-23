import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { hashPassword } from '../dist/password.js';

const base = process.env.TEST_API_URL, origin = process.env.ADMIN_ORIGIN ?? 'http://127.0.0.1:3001';
test('drama cover upload, replacement and validation', { skip: !base, timeout: 60000 }, async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const username = `cover_test_${randomBytes(8).toString('hex')}`, password = randomBytes(24).toString('base64url');
  const tmp = await mkdtemp(join(tmpdir(), 'red-video-cover-test-')); let user, dramaId;
  try {
    for (const extension of ['png', 'jpg']) execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=80x120', '-frames:v', '1', '-y', join(tmp, `sample.${extension}`)]);
    await writeFile(join(tmp, 'sample.webp'), Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/vuUAAA=', 'base64'));
    user = await prisma.adminUser.create({ data: { username, passwordHash: await hashPassword(password) } });
    const call = (path, options = {}) => fetch(`${base}${path}`, { ...options, headers: { origin, ...options.headers } });
    const login = await call('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
    assert.equal(login.status, 200); const cookie = login.headers.get('set-cookie').split(';')[0];
    const draft = { translations: [{ locale: 'en', title: username, description: '' }], categoryId: null, tagIds: [], actors: [], totalEpisodes: null, sortOrder: 0, pricingMode: null, freeEpisodes: null, priceCredits: null, previewSeconds: 30 };
    const response = await call('/api/dramas', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(draft) });
    assert.equal(response.status, 201); dramaId = (await response.json()).id;
    const path = `/api/dramas/${dramaId}/cover`;
    const send = (data, type = 'image/png', requestOrigin = origin) => call(path, { method: 'PUT', headers: { cookie, origin: requestOrigin, 'content-type': type }, body: data });
    assert.equal((await call(path)).status, 401);
    assert.equal((await call(path, { headers: { cookie } })).status, 404);
    assert.equal((await send(Buffer.from('not image'))).status, 400);
    assert.equal((await send(Buffer.alloc(10 * 1024 * 1024 + 1))).status, 400);
    const png = await readFile(join(tmp, 'sample.png'));
    assert.equal((await send(png, 'image/png', 'http://invalid.example')).status, 403);
    const first = await send(png); assert.equal(first.status, 200, await first.text());
    const firstKey = (await prisma.dramaDraft.findUnique({ where: { dramaId } })).coverKey;
    let get = await call(path, { headers: { cookie } }); assert.equal(get.headers.get('content-type'), 'image/png'); assert.deepEqual(Buffer.from(await get.arrayBuffer()), png);
    const listing = await (await call(`/api/dramas?keyword=${username}`, { headers: { cookie } })).json(); assert.equal(listing.items[0].coverKey, firstKey);
    assert.equal((await send(Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]))).status, 400);
    assert.equal((await prisma.dramaDraft.findUnique({ where: { dramaId } })).coverKey, firstKey);
    for (const [ext, type] of [['jpg', 'image/jpeg'], ['webp', 'image/webp']]) {
      const bytes = await readFile(join(tmp, `sample.${ext}`)); const r = await send(bytes, type); assert.equal(r.status, 200, await r.text());
      get = await call(path, { headers: { cookie } }); assert.equal(get.headers.get('content-type'), type); assert.deepEqual(Buffer.from(await get.arrayBuffer()), bytes);
    }
    const finalKey = (await prisma.dramaDraft.findUnique({ where: { dramaId } })).coverKey; assert.notEqual(finalKey, firstKey);
    assert.equal((await call(`/api/dramas/${dramaId}`, { method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(draft) })).status, 200);
    assert.equal((await prisma.dramaDraft.findUnique({ where: { dramaId } })).coverKey, finalKey, 'saving details preserves cover');
    await prisma.drama.update({ where: { id: dramaId }, data: { status: 'IN_REVIEW' } });
    assert.equal((await send(png)).status, 409);
    assert.equal((await prisma.dramaDraft.findUnique({ where: { dramaId } })).coverKey, finalKey);
  } finally {
    if (dramaId) await prisma.drama.delete({ where: { id: dramaId } });
    if (user) await prisma.adminUser.delete({ where: { id: user.id } });
    await prisma.$disconnect();
    if (dramaId) await rm(join(resolve('../../storage'), 'drama-covers', dramaId), { recursive: true, force: true });
    await rm(tmp, { recursive: true, force: true });
  }
});
