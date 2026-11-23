import { resolve, join } from 'node:path';

function setting(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}`);
  return value;
}

export const mediaConfig = {
  storageDir: resolve(process.env.MEDIA_STORAGE_DIR ?? '../../storage'),
  maxFiles: setting('MEDIA_MAX_FILES', 50, 1, 500),
  maxBytes: setting('MEDIA_MAX_BYTES', 1024 * 1024 * 1024, 1, 2147483647),
  chunkSize: setting('MEDIA_CHUNK_BYTES', 5 * 1024 * 1024, 1024 * 1024, 16 * 1024 * 1024),
  uploadDays: setting('MEDIA_UPLOAD_DAYS', 7, 1, 365),
};
export const mediaWorkerLockKey = 1847427061;
export const mediaDir = (id: string) => join(mediaConfig.storageDir, 'media', id);
export const chunksDir = (id: string) => join(mediaDir(id), 'chunks');
export const chunkPath = (id: string, number: number, hash: string) => join(chunksDir(id), `${number}-${hash}.part`);
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const hashPattern = /^[0-9a-f]{64}$/;
export const safeCoverPattern = /^(?:candidate-[0-2]|manual-[0-9a-f-]{36})\.jpg$/;
