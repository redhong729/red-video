import 'dotenv/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { hashPassword } from '../dist/password.js';

const base = process.env.TEST_API_URL;
const origin = process.env.ADMIN_ORIGIN ?? 'http://127.0.0.1:3001';
test('draft persistence, validation, localization and combined filters', { skip: !base }, async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const username = `draft_test_${randomBytes(8).toString('hex')}`;
  const password = randomBytes(24).toString('base64url');
  const name = `TEST_${randomBytes(8).toString('hex')}`;
  const createdIds = []; const categoryIds = []; const tagIds = [];
  let user;
  try {
    user = await prisma.adminUser.create({ data: { username, passwordHash: await hashPassword(password) } });
    for (const n of [1, 2]) {
      const category = await prisma.category.create({ data: { translations: { create: [{ locale: 'en', name: `${name} category ${n}` }, { locale: 'zh-CN', name: `${name} 分类 ${n}` }] } } });
      const tag = await prisma.tag.create({ data: { translations: { create: [{ locale: 'en', name: `${name} tag ${n}` }] } } });
      categoryIds.push(category.id); tagIds.push(tag.id);
    }
    const call = (path, options = {}) => fetch(`${base}${path}`, { ...options, headers: { origin, ...options.headers } });
    assert.equal((await call('/api/dramas')).status, 401);
    const login = await call('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const post = (path, body, method = 'POST') => call(path, { method, headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const draft = (title, categoryId, tags) => ({ translations: [{ locale: 'en', title, description: 'sample' }], categoryId, tagIds: tags, actors: [{ name: 'Actor', roleName: 'Role' }], totalEpisodes: 8, sortOrder: 0, pricingMode: 'PER_EPISODE', freeEpisodes: 2, priceCredits: 3, previewSeconds: 30 });
    assert.equal((await post('/api/dramas', draft('', null, []))).status, 400);
    assert.equal((await post('/api/dramas', { ...draft('invalid', null, []), totalEpisodes: 0 })).status, 400);
    assert.equal((await post('/api/dramas', { ...draft('invalid', null, []), freeEpisodes: 9 })).status, 400);
    assert.equal((await post('/api/dramas', draft('invalid', randomUUID(), []))).status, 400);
    const first = await post('/api/dramas', draft(`${name} Alpha`, categoryIds[0], [tagIds[0]]));
    assert.equal(first.status, 201);
    const firstBody = await first.json(); createdIds.push(firstBody.id);
    const second = await post('/api/dramas', draft(`${name} Beta`, categoryIds[0], [tagIds[1]]));
    assert.equal(second.status, 201); createdIds.push((await second.json()).id);
    const third = await post('/api/dramas', draft(`${name} Gamma`, categoryIds[1], [tagIds[0]]));
    assert.equal(third.status, 201); createdIds.push((await third.json()).id);
    const params = new URLSearchParams({ keyword: name.toLowerCase(), categoryId: categoryIds[0], tagIds: tagIds.join(','), locale: 'zh-CN' });
    const filtered = await (await call(`/api/dramas?${params}`, { headers: { cookie } })).json();
    assert.equal(filtered.total, 2);
    assert.ok(filtered.items.every((item) => createdIds.includes(item.id)));
    assert.equal(filtered.items.find((item) => item.id === firstBody.id).title, `${name} Alpha`);
    assert.equal(filtered.items.find((item) => item.id === firstBody.id).tags[0].name, null);
    assert.equal((await (await call(`/api/dramas?keyword=${firstBody.id}`, { headers: { cookie } })).json()).total, 1);
    const updated = await post(`/api/dramas/${firstBody.id}`, { ...draft(`${name} Edited`, categoryIds[0], [tagIds[1]]), previewSeconds: 0 }, 'PUT');
    assert.equal(updated.status, 200);
    const detail = await (await call(`/api/dramas/${firstBody.id}`, { headers: { cookie } })).json();
    assert.equal(detail.draft.translations[0].title, `${name} Edited`);
    assert.equal(detail.draft.previewSeconds, 0);
    assert.deepEqual(detail.draft.tags.map((row) => row.tagId), [tagIds[1]]);
    assert.equal((await call(`/api/dramas/${randomUUID()}`, { headers: { cookie } })).status, 404);
  } finally {
    if (createdIds.length) await prisma.drama.deleteMany({ where: { id: { in: createdIds } } });
    if (categoryIds.length) await prisma.category.deleteMany({ where: { id: { in: categoryIds } } });
    if (tagIds.length) await prisma.tag.deleteMany({ where: { id: { in: tagIds } } });
    if (user) await prisma.adminUser.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
});
