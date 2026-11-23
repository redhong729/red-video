'use client';

import type { DramaDetail, PublishedEpisode } from '@/lib/catalog';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseEpisode(value: unknown): PublishedEpisode | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.number !== 'number' || !Number.isSafeInteger(value.number) || typeof value.title !== 'string') return null;
  return {
    id: value.id,
    number: value.number,
    title: value.title,
    isFree: value.isFree === true,
    priceCredits: typeof value.priceCredits === 'number' && Number.isSafeInteger(value.priceCredits) ? value.priceCredits : null,
  };
}

function parseDramaDetail(value: unknown): DramaDetail {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.title !== 'string' || !Array.isArray(value.episodes)) {
    throw new Error('Invalid drama detail response');
  }
  const episodes = value.episodes.flatMap((item) => {
    const episode = parseEpisode(item);
    return episode ? [episode] : [];
  });
  return {
    id: value.id,
    title: value.title,
    description: typeof value.description === 'string' ? value.description : null,
    categoryName: typeof value.categoryName === 'string' ? value.categoryName : null,
    tags: Array.isArray(value.tags) ? value.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    actors: Array.isArray(value.actors) ? value.actors.flatMap((actor) => {
      if (typeof actor !== 'object' || actor === null || Array.isArray(actor) || !('name' in actor) || typeof actor.name !== 'string' || !actor.name.trim()) return [];
      const roleName = 'roleName' in actor && typeof actor.roleName === 'string' && actor.roleName.trim() ? actor.roleName.trim() : null;
      return [{ name: actor.name.trim(), roleName }];
    }) : [],
    episodeCount: typeof value.episodeCount === 'number' ? value.episodeCount : episodes.length,
    totalEpisodeCount: typeof value.totalEpisodeCount === 'number' ? value.totalEpisodeCount : null,
    coverUrl: typeof value.coverUrl === 'string' ? value.coverUrl : null,
    sortOrder: 0,
    episodes,
  };
}

const pendingRequests = new Map<string, Promise<DramaDetail>>();

export function requestDramaDetail(id: string, locale: string): Promise<DramaDetail> {
  const key = id + ':' + locale;
  const pending = pendingRequests.get(key);
  if (pending) return pending;

  const request = fetch('/api/public/dramas/' + encodeURIComponent(id) + '?locale=' + encodeURIComponent(locale), { cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) throw new Error('Drama detail unavailable');
      return parseDramaDetail(await response.json());
    });
  pendingRequests.set(key, request);
  const clearRequest = () => {
    if (pendingRequests.get(key) === request) pendingRequests.delete(key);
  };
  void request.then(clearRequest, clearRequest);
  return request;
}
