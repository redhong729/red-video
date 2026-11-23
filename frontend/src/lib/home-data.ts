'use client';

import { useEffect, useState } from 'react';
import type { FocusSlide, HomeStory, PublicTaxonomy, TaxonomyItem } from '@/lib/catalog';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readItems<T>(payload: unknown, mapItem: (value: unknown) => T | null): T[] {
  if (!isRecord(payload) || !Array.isArray(payload.items)) throw new Error('Invalid homepage response');
  return payload.items.flatMap((value) => {
    const item = mapItem(value);
    return item === null ? [] : [item];
  });
}

function readFocusSlide(value: unknown): FocusSlide | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.title !== 'string' || typeof value.episodeCount !== 'number') return null;
  return {
    id: value.id,
    title: value.title,
    description: typeof value.description === 'string' ? value.description : null,
    categoryName: typeof value.categoryName === 'string' ? value.categoryName : null,
    episodeCount: value.episodeCount,
    coverUrl: typeof value.coverUrl === 'string' ? value.coverUrl : null,
    sortOrder: typeof value.sortOrder === 'number' ? value.sortOrder : 0,
    ...(typeof value.publishedAt === 'string' ? { publishedAt: value.publishedAt } : {})
  };
}

function readHomeStory(value: unknown): HomeStory | null {
  const slide = readFocusSlide(value);
  if (!slide || !isRecord(value)) return null;
  return {
    ...slide,
    categoryId: typeof value.categoryId === 'string' ? value.categoryId : null,
    tags: Array.isArray(value.tags) ? value.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    tagIds: Array.isArray(value.tagIds) ? value.tagIds.filter((id): id is string => typeof id === 'string') : [],
  };
}

function readTaxonomyItem(value: unknown): TaxonomyItem | null {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string'
    ? { id: value.id, name: value.name }
    : null;
}

const pendingRequests = new Map<string, Promise<unknown>>();

function requestItems<T>(path: string, locale: string, parseItem: (value: unknown) => T | null): Promise<T[]> {
  const key = path + ':' + locale;
  const pending = pendingRequests.get(key) as Promise<T[]> | undefined;
  if (pending) return pending;

  const request = fetch(path + '?locale=' + encodeURIComponent(locale), { cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) throw new Error('Homepage data unavailable');
      return readItems(await response.json(), parseItem);
    });
  pendingRequests.set(key, request);
  const clearRequest = () => {
    if (pendingRequests.get(key) === request) pendingRequests.delete(key);
  };
  void request.then(clearRequest, clearRequest);
  return request;
}

export function requestFocusSlides(locale: string): Promise<FocusSlide[]> {
  return requestItems('/api/public/home/featured', locale, readFocusSlide);
}

export function requestHomeStories(locale: string): Promise<HomeStory[]> {
  return requestItems('/api/public/home/stories', locale, readHomeStory);
}

export function requestSearchStories(locale: string, query: string): Promise<HomeStory[]> {
  const params = new URLSearchParams({ locale, q: query });
  const path = '/api/public/search?' + params.toString();
  const pending = pendingRequests.get(path) as Promise<HomeStory[]> | undefined;
  if (pending) return pending;

  const request = fetch(path, { cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) throw new Error('Search data unavailable');
      return readItems(await response.json(), readHomeStory);
    });
  pendingRequests.set(path, request);
  const clearRequest = () => {
    if (pendingRequests.get(path) === request) pendingRequests.delete(path);
  };
  void request.then(clearRequest, clearRequest);
  return request;
}

export type HomeSections = {
  featured: FocusSlide[];
  popular: HomeStory[];
  ranking: (HomeStory & { rank: number })[];
  rankingUpdatedAt: string | null;
};

export function requestHomeSections(locale: string): Promise<HomeSections> {
  const path = '/api/public/home';
  const key = path + ':' + locale;
  const pending = pendingRequests.get(key) as Promise<HomeSections> | undefined;
  if (pending) return pending;

  const request = fetch(path + '?locale=' + encodeURIComponent(locale), { cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) throw new Error('Homepage data unavailable');
      const payload: unknown = await response.json();
      if (!isRecord(payload) || !isRecord(payload.featured) || !isRecord(payload.popular) || !isRecord(payload.ranking)) {
        throw new Error('Invalid homepage response');
      }
      const featured = readItems({ items: payload.featured.items }, readFocusSlide);
      const popular = readItems({ items: payload.popular.items }, readHomeStory);
      const ranking = readItems({ items: payload.ranking.items }, (value) => {
        const story = readHomeStory(value);
        return story && isRecord(value) && typeof value.rank === 'number'
          ? { ...story, rank: value.rank }
          : null;
      });
      return {
        featured,
        popular,
        ranking,
        rankingUpdatedAt: typeof payload.ranking.updatedAt === 'string' ? payload.ranking.updatedAt : null,
      };
    });
  pendingRequests.set(key, request);
  const clearRequest = () => {
    if (pendingRequests.get(key) === request) pendingRequests.delete(key);
  };
  void request.then(clearRequest, clearRequest);
  return request;
}

export function requestPublicTaxonomy(locale: string): Promise<PublicTaxonomy> {
  const key = '/api/public/taxonomy:' + locale;
  const pending = pendingRequests.get(key) as Promise<PublicTaxonomy> | undefined;
  if (pending) return pending;

  const request = fetch('/api/public/taxonomy?locale=' + encodeURIComponent(locale), { cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) throw new Error('Public taxonomy unavailable');
      const payload: unknown = await response.json();
      if (!isRecord(payload) || !Array.isArray(payload.categories) || !Array.isArray(payload.tags)) {
        throw new Error('Invalid public taxonomy response');
      }
      return {
        categories: payload.categories.flatMap((value) => {
          const item = readTaxonomyItem(value);
          return item ? [item] : [];
        }),
        tags: payload.tags.flatMap((value) => {
          const item = readTaxonomyItem(value);
          return item ? [item] : [];
        }),
      };
    });
  pendingRequests.set(key, request);
  const clearRequest = () => {
    if (pendingRequests.get(key) === request) pendingRequests.delete(key);
  };
  void request.then(clearRequest, clearRequest);
  return request;
}

export function useHomeStories(locale: string) {
  const [stories, setStories] = useState<HomeStory[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);
    requestHomeStories(locale)
      .then((items) => {
        if (!active) return;
        setStories(items);
      })
      .catch(() => {
        if (!active) return;
        setStories([]);
        setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [locale, reload]);

  return { stories, loading, failed, retry: () => setReload((value) => value + 1) };
}

export function useHomeSections(locale: string) {
  const [home, setHome] = useState<HomeSections>({ featured: [], popular: [], ranking: [], rankingUpdatedAt: null });
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);
    requestHomeSections(locale)
      .then((data) => { if (active) setHome(data); })
      .catch(() => {
        if (!active) return;
        setHome({ featured: [], popular: [], ranking: [], rankingUpdatedAt: null });
        setFailed(true);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [locale, reload]);

  return { home, loading, failed, retry: () => setReload((value) => value + 1) };
}

export function useCategoriesDirectory(locale: string) {
  const [stories, setStories] = useState<HomeStory[]>([]);
  const [taxonomy, setTaxonomy] = useState<PublicTaxonomy>({ categories: [], tags: [] });
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);
    Promise.all([requestHomeStories(locale), requestPublicTaxonomy(locale)])
      .then(([nextStories, nextTaxonomy]) => {
        if (!active) return;
        setStories(nextStories);
        setTaxonomy(nextTaxonomy);
      })
      .catch(() => {
        if (!active) return;
        setStories([]);
        setTaxonomy({ categories: [], tags: [] });
        setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [locale, reload]);

  return { stories, taxonomy, loading, failed, retry: () => setReload((value) => value + 1) };
}
