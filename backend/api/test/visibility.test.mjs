import 'dotenv/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { hashPassword } from '../dist/password.js';

const base = process.env.TEST_API_URL, origin = process.env.ADMIN_ORIGIN ?? 'http://127.0.0.1:3001';
test('manual and concurrent offline operations preserve status invariants', { skip: !base }, async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const username = `offline_test_${randomBytes(8).toString('hex')}`, password = randomBytes(24).toString('base64url');
  const dramas = []; let user;
  try {
    user = await prisma.adminUser.create({ data: { username, passwordHash: await hashPassword(password) } });
    async function makeDrama(status, episodes) {
      const drama = await prisma.drama.create({ data: { status, draft: { create: { translations: { create: { locale: 'en', title: `Visibility ${username}` } }, totalEpisodes: 4 } }, episodes: { create: episodes.map((value, i) => ({ number: i + 1, position: i + 1, status: value })) } }, include: { episodes: { orderBy: { number: 'asc' } } } });
      dramas.push(drama.id); return drama;
    }
    const drama = await makeDrama('PUBLISHED', ['PUBLISHED', 'PUBLISHED', 'OFFLINE']);
    const manuallyOffline = await makeDrama('PUBLISHED', ['PUBLISHED', 'OFFLINE']);
    const draft = await makeDrama('DRAFT', ['OFFLINE']);
    const call = (path, options = {}) => fetch(`${base}${path}`, { ...options, headers: { origin, ...options.headers } });
    const login = await call('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
    assert.equal(login.status, 200); const cookie = login.headers.get('set-cookie').split(';')[0];
    const post = (path, ids, extra = {}) => call(path, { method: 'POST', headers: { cookie, 'content-type': 'application/json', ...extra }, body: JSON.stringify({ ids }) });
    assert.equal((await call('/api/visibility/dramas/offline', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: [drama.id] }) })).status, 401);
    assert.equal((await post('/api/visibility/dramas/offline', [drama.id], { origin: 'http://invalid.example' })).status, 403);
    assert.equal((await post('/api/visibility/dramas/offline', [drama.id, drama.id])).status, 400);
    const result = await (await post('/api/visibility/dramas/offline', [manuallyOffline.id, draft.id, randomUUID()])).json();
    assert.deepEqual(result.results.map((row) => row.result), ['SUCCEEDED', 'SKIPPED', 'SKIPPED']);
    assert.equal((await prisma.drama.findUnique({ where: { id: manuallyOffline.id } })).status, 'OFFLINE');
    assert.equal((await prisma.episode.findUnique({ where: { id: manuallyOffline.episodes[0].id } })).status, 'PUBLISHED');
    const list = await (await call(`/api/dramas?keyword=${manuallyOffline.id}`, { headers: { cookie } })).json();
    assert.equal(list.items[0].publishedEpisodes, 1, 'manual drama takedown does not reset episode count');
    const path = `/api/visibility/dramas/${drama.id}/episodes/offline`;
    const missing = await (await post(path, [draft.episodes[0].id])).json(); assert.equal(missing.results[0].reason, 'NOT_FOUND');
    const [a, b] = await Promise.all([post(path, [drama.episodes[0].id]), post(path, [drama.episodes[1].id])]);
    const combined = [...(await a.json()).results, ...(await b.json()).results];
    assert.equal(combined.filter((item) => item.result === 'SUCCEEDED').length, 2);
    assert.equal(combined.filter((item) => item.dramaOffline).length, 1);
    assert.equal((await prisma.drama.findUnique({ where: { id: drama.id } })).status, 'OFFLINE');
    assert.equal((await prisma.drama.findUnique({ where: { id: draft.id } })).status, 'DRAFT');
    const history = await (await call(`/api/visibility/dramas/${drama.id}/history`, { headers: { cookie } })).json();
    assert.equal(history.filter((event) => event.action === 'EPISODE_OFFLINE').length, 2);
    assert.equal(history.filter((event) => event.action === 'LAST_EPISODE_OFFLINE').length, 1);
    assert.equal(history.every((event) => event.actor === username), true);
    assert.equal((await (await post(path, [drama.episodes[0].id])).json()).results[0].result, 'SKIPPED');
  } finally {
    if (dramas.length) await prisma.drama.deleteMany({ where: { id: { in: dramas } } });
    if (user) await prisma.adminUser.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
});
