import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const options = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const dummyHash = `scrypt$${'00'.repeat(16)}$${'00'.repeat(64)}`;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, options, (error, result) => error ? reject(error) : resolve(result as Buffer));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${(await derive(password, salt)).toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string | undefined): Promise<boolean> {
  const parts = (stored ?? dummyHash).split('$');
  const validFormat = parts.length === 3 && parts[0] === 'scrypt' && /^[0-9a-f]{32}$/.test(parts[1]) && /^[0-9a-f]{128}$/.test(parts[2]);
  const [, salt, digest] = validFormat ? parts : dummyHash.split('$');
  const actual = await derive(password, Buffer.from(salt, 'hex'));
  return timingSafeEqual(actual, Buffer.from(digest, 'hex')) && validFormat && stored !== undefined;
}
