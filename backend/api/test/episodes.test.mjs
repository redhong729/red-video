import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { hashPassword } from '../dist/password.js';

const base = process.env.TEST_API_URL;
const origin = process.env.ADMIN_ORIGIN ?? 'http://127.0.0.1:3001';
test('episode numbers, pricing, previews, ordering and total constraints', { skip: !base }, async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const username = `ep_test_${randomBytes(8).toString('hex')}`;
  const password = randomBytes(24).toString('base64url');
  let user; let dramaId;
  try {
    user = await prisma.adminUser.create({ data: { username, passwordHash: await hashPassword(password) } });
    const call = (path, options = {}) => fetch(`${base}${path}`, { ...options, headers: { origin, ...options.headers } });
    const login = await call('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const write = (path, body, method = 'POST') => call(path, { method, headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const read = async (path) => { const response = await call(path, { headers: { cookie } }); assert.equal(response.status, 200); return response.json(); };
    const draft = { translations: [{ locale: 'en', title: 'Episode test', description: '' }], categoryId: null, tagIds: [], actors: [], totalEpisodes: 25, sortOrder: 0, pricingMode: 'PER_EPISODE', freeEpisodes: 2, priceCredits: 5, previewSeconds: 30 };
    const created = await write('/api/dramas', draft); assert.equal(created.status, 201); dramaId = (await created.json()).id;
    const path = `/api/dramas/${dramaId}/episodes`;
    assert.equal((await call(path)).status, 401);
    const blank = (number) => ({ number, translations: [], priceMode: null, priceCredits: null, previewSeconds: null });
    assert.equal((await write(path, blank(26))).status, 400);
    assert.equal((await write(path, blank(0))).status, 400);
    for (const n of [2, 1]) assert.equal((await write(path, blank(n))).status, 201);
    const thirdResponse = await write(path, { ...blank(3), translations: [{ locale: 'en', title: 'Special' }], priceMode: 'CREDITS', priceCredits: 7, previewSeconds: 0 });
    assert.equal(thirdResponse.status, 201); const thirdId = (await thirdResponse.json()).id;
    assert.equal((await write(path, blank(1))).status, 409);
    let list = await read(`${path}?locale=zh-CN`);
    assert.deepEqual(list.items.map((item) => item.number), [1, 2, 3]);
    assert.equal(list.items[0].title, '第 1 集');
    assert.equal(list.items[2].title, 'Special');
    assert.deepEqual(list.items.map((item) => item.effectivePrice.mode), ['FREE', 'FREE', 'CREDITS']);
    assert.equal(list.items[2].effectivePrice.credits, 7); assert.equal(list.items[2].effectivePreviewSeconds, 0);
    // 旧版本曾保存手动排序，读取时仍应按集号排列。
    await prisma.dramaDraft.update({ where: { dramaId }, data: { episodeOrderCustomized: true } });
    for (const item of list.items) await prisma.episode.update({ where: { id: item.id }, data: { position: 100 - item.number } });
    assert.equal((await write(`${path}/order`, { page: 1, pageSize: 20, expectedIds: list.items.map((item) => item.id), ids: list.items.map((item) => item.id).reverse() }, 'PUT')).status, 404);
    list = await read(`${path}?locale=en`); assert.deepEqual(list.items.map((item) => item.number), [1, 2, 3]);
    assert.deepEqual(list.items.map((item) => item.effectivePrice.mode), ['FREE', 'FREE', 'CREDITS']);
    assert.equal((await write(`/api/dramas/${dramaId}`, { ...draft, totalEpisodes: 2 }, 'PUT')).status, 400);
    assert.equal((await write(`/api/dramas/${dramaId}`, { ...draft, totalEpisodes: null }, 'PUT')).status, 400);
    assert.equal((await write(`${path}/${thirdId}`, blank(7), 'PUT')).status, 400);
    const updated = await write(`${path}/${thirdId}`, { ...blank(3), previewSeconds: null }, 'PUT'); assert.equal(updated.status, 200);
    list = await read(`${path}?locale=en`); assert.equal(list.items[2].title, 'Episode 3'); assert.equal(list.items[2].effectivePrice.credits, 5); assert.equal(list.items[2].effectivePreviewSeconds, 30);
    const concurrent = await Promise.all([write(path, blank(4)), write(path, blank(4))]);
    assert.deepEqual(concurrent.map((r) => r.status).sort(), [201, 409]);
    for (let number = 5; number <= 22; number++) assert.equal((await write(path, blank(number))).status, 201);
    const firstPage = await read(`${path}?page=1`); const secondPage = await read(`${path}?page=2`);
    assert.equal(firstPage.items.length, 20); assert.deepEqual(secondPage.items.map((item) => item.number), [21, 22]);
    assert.deepEqual(firstPage.items.map((item) => item.number), Array.from({ length: 20 }, (_, index) => index + 1));
  } finally {
    if (dramaId) await prisma.drama.delete({ where: { id: dramaId } });
    if (user) await prisma.adminUser.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
});
