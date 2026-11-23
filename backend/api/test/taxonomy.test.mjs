import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { hashPassword } from '../dist/password.js';

const base = process.env.TEST_API_URL, origin = process.env.ADMIN_ORIGIN ?? 'http://127.0.0.1:3001';
test('taxonomy names, lifecycle and historical drama associations', { skip: !base }, async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const suffix = randomBytes(8).toString('hex'), username = `taxonomy_${suffix}`, password = randomBytes(24).toString('base64url');
  const created = { categories: [], tags: [], dramas: [] }; let user;
  try {
    user = await prisma.adminUser.create({ data: { username, passwordHash: await hashPassword(password) } });
    const call = (path, options = {}) => fetch(`${base}${path}`, { ...options, headers: { origin, ...options.headers } });
    assert.equal((await call('/api/taxonomy/categories')).status, 401);
    const login = await call('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
    assert.equal(login.status, 200); const cookie = login.headers.get('set-cookie').split(';')[0];
    const send = (path, body, method = 'POST') => call(path, { method, headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const read = async (path) => { const r = await call(path, { headers: { cookie } }); assert.equal(r.status, 200); return r.json(); };
    assert.equal((await call('/api/taxonomy/categories', { method: 'POST', headers: { cookie, origin: 'http://invalid.example', 'content-type': 'application/json' }, body: '{}' })).status, 403);
    for (const kind of ['categories', 'tags']) {
      const endpoint = `/api/taxonomy/${kind}`, label = `TEST ${suffix} ${kind}`;
      assert.equal((await send(endpoint, { translations: [] })).status, 400);
      assert.equal((await send(endpoint, { translations: [{ locale: 'en', name: '   ' }] })).status, 400);
      assert.equal((await send(endpoint, { translations: [{ locale: 'en', name: label }, { locale: 'EN', name: label + ' 2' }] })).status, 400);
      const response = await send(endpoint, { translations: [{ locale: 'en', name: ` ${label} ` }, { locale: 'zh-CN', name: `测试 ${suffix} ${kind}` }] });
      assert.equal(response.status, 201); const item = await response.json(); created[kind].push(item.id);
      const duplicate = await send(endpoint, { translations: [{ locale: 'EN', name: ` ${label.toUpperCase()} ` }] });
      assert.equal(duplicate.status, 409, `duplicate ${kind}: ${await duplicate.text()}`);
      const update = await send(`${endpoint}/${item.id}`, { translations: [{ locale: 'en', name: `${label} revised` }] }, 'PUT');
      assert.equal(update.status, 200);
      const otherResponse = await send(endpoint, { translations: [{ locale: 'en', name: `${label} other` }] });
      assert.equal(otherResponse.status, 201); const other = await otherResponse.json(); created[kind].push(other.id);
      assert.equal((await send(`${endpoint}/${other.id}`, { translations: [{ locale: 'EN', name: ` ${label.toUpperCase()} REVISED ` }] }, 'PUT')).status, 409);
      assert.equal((await read(endpoint)).find((row) => row.id === other.id).translations[0].name, `${label} other`, 'failed rename preserves existing translations');
      const entries = await read(endpoint); assert.equal(entries.find((row) => row.id === item.id).usageCount, 0);
      assert.equal((await send(`${endpoint}/${item.id}/status`, { active: false }, 'PUT')).status, 200);
      assert.equal((await send(`${endpoint}/${item.id}/status`, { active: true }, 'PUT')).status, 200);
    }
    const [category] = created.categories, [tag] = created.tags;
    const draft = { translations: [{ locale: 'en', title: `TEST ${suffix}`, description: '' }], categoryId: category, tagIds: [tag], actors: [], totalEpisodes: 3, sortOrder: 0, pricingMode: 'FREE', freeEpisodes: null, priceCredits: null, previewSeconds: 0 };
    const response = await send('/api/dramas', draft); assert.equal(response.status, 201); const drama = await response.json(); created.dramas.push(drama.id);
    for (const [kind, id] of [['categories', category], ['tags', tag]]) {
      const endpoint = `/api/taxonomy/${kind}/${id}`;
      assert.equal((await send(`${endpoint}/status`, { active: false }, 'PUT')).status, 200);
      assert.equal((await call(endpoint, { method: 'DELETE', headers: { cookie } })).status, 409);
      assert.equal((await read(`/api/taxonomy/${kind}`)).find((row) => row.id === id).usageCount, 1);
    }
    const options = await read('/api/dramas/options?locale=en');
    assert.equal(options.categories.find((item) => item.id === category).active, false);
    assert.equal(options.tags.find((item) => item.id === tag).active, false);
    assert.equal((await send(`/api/dramas/${drama.id}`, draft, 'PUT')).status, 200, 'existing inactive associations remain editable');
    assert.equal((await send('/api/dramas', draft)).status, 400, 'cannot add inactive associations');
    assert.equal((await read(`/api/dramas?categoryId=${category}&tagIds=${tag}`)).items.some((item) => item.id === drama.id), true);
    assert.equal((await send(`/api/dramas/${drama.id}`, { ...draft, categoryId: null, tagIds: [] }, 'PUT')).status, 200);
    assert.equal((await send(`/api/dramas/${drama.id}`, draft, 'PUT')).status, 400, 'removed inactive associations cannot be re-added');
    for (const [kind, id] of [['categories', category], ['tags', tag]]) assert.equal((await call(`/api/taxonomy/${kind}/${id}`, { method: 'DELETE', headers: { cookie } })).status, 200);
    // Concurrent association and disable must serialize: either association commits first or it is rejected.
    const raceCategory = created.categories[1];
    const [createdDrama, disabled] = await Promise.all([
      send('/api/dramas', { ...draft, categoryId: raceCategory, tagIds: [] }),
      send(`/api/taxonomy/categories/${raceCategory}/status`, { active: false }, 'PUT'),
    ]);
    assert.equal(disabled.status, 200); assert.ok([201, 400].includes(createdDrama.status));
    if (createdDrama.status === 201) {
      const raceDrama = await createdDrama.json(); created.dramas.push(raceDrama.id);
      assert.equal((await send(`/api/dramas/${raceDrama.id}`, { ...draft, categoryId: raceCategory, tagIds: [] }, 'PUT')).status, 200);
    }
  } finally {
    if (created.dramas.length) await prisma.drama.deleteMany({ where: { id: { in: created.dramas } } });
    if (created.categories.length) await prisma.category.deleteMany({ where: { id: { in: created.categories } } });
    if (created.tags.length) await prisma.tag.deleteMany({ where: { id: { in: created.tags } } });
    if (user) await prisma.adminUser.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
});
