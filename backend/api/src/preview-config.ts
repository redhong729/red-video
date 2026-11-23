import { createHash } from 'node:crypto';
type DramaPrice = { pricingMode: string | null; freeEpisodes: number | null; priceCredits: number | null; previewSeconds: number };
type EpisodePrice = { number: number; priceMode: string | null; previewSeconds: number | null };
export function previewConfig(draft: DramaPrice, episode: EpisodePrice) {
  let paid: boolean | null = null;
  if (episode.priceMode === 'FREE') paid = false;
  else if (episode.priceMode === 'CREDITS') paid = true;
  else if (draft.pricingMode === 'FREE') paid = false;
  else if (draft.pricingMode === 'PER_EPISODE' && draft.freeEpisodes !== null) paid = episode.number > draft.freeEpisodes ? draft.priceCredits !== null ? true : null : false;
  const seconds = episode.previewSeconds ?? draft.previewSeconds;
  const kind: 'NOT_CONFIGURED' | 'NOT_REQUIRED' | 'REQUIRED' = paid === null ? 'NOT_CONFIGURED' : !paid || seconds === 0 ? 'NOT_REQUIRED' : 'REQUIRED';
  const signature = createHash('sha256').update(JSON.stringify([kind, kind === 'REQUIRED' ? seconds : 0])).digest('hex');
  return { paid, seconds, kind, signature };
}
