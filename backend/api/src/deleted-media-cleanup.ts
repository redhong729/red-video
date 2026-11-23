import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { mediaConfig, mediaDir } from './media-common.js';

export const activeMediaStatuses = ['UPLOADING', 'QUEUED', 'PROCESSING', 'CANCEL_REQUESTED'] as const;

async function removeDirectory(path: string, label: string) {
  try {
    await rm(path, { recursive: true, force: true });
  } catch (error) {
    console.error(`Could not remove ${label}`, error);
  }
}

export async function cleanupDeletedMediaUploads(ids: string[]) {
  await Promise.all(ids.map((id) => removeDirectory(mediaDir(id), `media files for ${id}`)));
}

export async function cleanupDeletedDramaFiles(dramaId: string, mediaIds: string[]) {
  await Promise.all([
    cleanupDeletedMediaUploads(mediaIds),
    removeDirectory(join(mediaConfig.storageDir, 'drama-covers', dramaId), `cover files for ${dramaId}`),
  ]);
}
