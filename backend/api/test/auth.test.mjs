import 'dotenv/config';
import { createHash, randomBytes } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { hashPassword } from '../dist/password.js';
import { LoginLimiter } from '../dist/auth.js';

const base = process.env.TEST_API_URL;
const origin = process.env.ADMIN_ORIGIN ?? 'http://127.0.0.1:3001';

test('login limiter blocks repeated attempts and can reset', () => {
  const limiter = new LoginLimiter();
  for (let i = 0; i < 10; i++) limiter.check('test');
  assert.throws(() => limiter.check('test'), (error) => error.getStatus() === 429);
  limiter.clear('test');
  assert.doesNotThrow(() => limiter.check('test'));
});

test('authentication, origin, session expiry and logout', { skip: !base }, async () => {
  assert.ok(process.env.DATABASE_URL);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const username = `test_${randomBytes(12).toString('hex')}`;
  const password = randomBytes(24).toString('base64url');
  let user;
  try {
    user = await prisma.adminUser.create({ data: { username, passwordHash: await hashPassword(password) } });
    const call = (path, options = {}) => fetch(`${base}${path}`, { ...options, headers: { ...options.headers } });
    const login = (pw = password, reqOrigin = origin) => call('/api/auth/login', { method: 'POST', headers: { origin: reqOrigin, 'content-type': 'application/json' }, body: JSON.stringify({ username, password: pw }) });
    assert.equal((await call('/api/dramas/options?locale=zh-CN')).status, 401);
    assert.equal((await call('/api/auth/me')).status, 401);
    assert.equal((await login(password, 'http://untrusted.invalid')).status, 403);
    assert.equal((await login('incorrect')).status, 401);
    const response = await login();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { username });
    const setCookie = response.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);
    const cookie = setCookie.split(';')[0];
    const optionsResponse = await call('/api/dramas/options?locale=zh-CN', { headers: { cookie } });
    assert.equal(optionsResponse.status, 200);
    const options = await optionsResponse.json();
    assert.ok(Array.isArray(options.categories));
    assert.ok(Array.isArray(options.tags));
    assert.deepEqual(await (await call('/api/auth/me', { headers: { cookie } })).json(), { username });
    assert.equal((await call('/api/auth/logout', { method: 'POST', headers: { cookie, origin: 'http://untrusted.invalid' } })).status, 403);
    assert.equal((await call('/api/auth/me', { headers: { cookie } })).status, 200);
    const hash = createHash('sha256').update(cookie.slice('rv_session='.length)).digest('hex');
    await prisma.adminSession.update({ where: { tokenHash: hash }, data: { expiresAt: new Date(0) } });
    assert.equal((await call('/api/auth/me', { headers: { cookie } })).status, 401);
    const second = await login();
    const cookie2 = second.headers.get('set-cookie').split(';')[0];
    assert.equal((await call('/api/auth/logout', { method: 'POST', headers: { cookie: cookie2, origin } })).status, 204);
    assert.equal((await call('/api/dramas/options?locale=zh-CN', { headers: { cookie: cookie2 } })).status, 401);
    await prisma.adminUser.update({ where: { id: user.id }, data: { enabled: false } });
    assert.equal((await login()).status, 401);
  } finally {
    if (user) await prisma.adminUser.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
});
