'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import type { DramaDetail } from '@/lib/catalog';
import { requestDramaDetail } from '@/lib/drama-detail-data';

function LockIcon() {
  return <svg aria-hidden="true" viewBox="0 0 16 18"><rect x="3" y="7" width="10" height="9" rx="2" fill="currentColor" /><path d="M5.25 7V5a2.75 2.75 0 0 1 5.5 0v2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
}

export function DramaDetailPage({ dramaId }: { dramaId: string }) {
  const t = useTranslations('home');
  const locale = useLocale();
  const [detail, setDetail] = useState<DramaDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [rangeStart, setRangeStart] = useState(1);

  useEffect(() => {
    let active = true;
    setExpanded(false);
    setRangeStart(1);
    setDetail(null);
    setLoading(true);
    setFailed(false);
    requestDramaDetail(dramaId, locale)
      .then((value) => {
        if (active) setDetail(value);
      })
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [dramaId, locale]);

  const totalEpisodeCount = detail
    ? Math.max(detail.totalEpisodeCount ?? 0, ...detail.episodes.map((episode) => episode.number), detail.episodeCount)
    : 0;
  const ranges = useMemo(() => {
    const result: { start: number; end: number }[] = [];
    for (let start = 1; start <= totalEpisodeCount; start += 30) result.push({ start, end: Math.min(start + 29, totalEpisodeCount) });
    return result;
  }, [totalEpisodeCount]);
  const currentRange = ranges.find((range) => range.start === rangeStart) ?? ranges[0] ?? null;
  const rangeEpisodes = currentRange && detail
    ? detail.episodes.filter((episode) => episode.number >= currentRange.start && episode.number <= currentRange.end)
    : [];

  return (
    <div className="site-shell drama-detail-shell">
      <main className="drama-detail-page">
        <Link className="drama-detail-back" href={'/' + locale}>
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" /></svg>
          {t('detailBack')}
        </Link>

        {loading && <div className="story-empty-state detail-state">{t('storiesLoading')}</div>}
        {!loading && failed && <div className="story-empty-state detail-state"><p>{t('detailLoadFailed')}</p><Link className="see-all-button" href={'/' + locale}>{t('detailBack')}</Link></div>}
        {!loading && !failed && detail && (
          <>
            <section className="drama-detail-overview" aria-labelledby="drama-detail-title">
              <div className="drama-detail-poster">
                {detail.coverUrl
                  ? <img src={detail.coverUrl} alt={detail.title} />
                  : <div className="drama-detail-poster-placeholder" aria-hidden="true" />}
              </div>
              <div className="drama-detail-heading">
                <h1 id="drama-detail-title">{detail.title}</h1>
                <p className="drama-detail-stats">{t('publishedEpisodeSummary', { published: detail.episodeCount, total: totalEpisodeCount })}</p>
                <div className="drama-detail-tags" aria-label={t('dramaTags')}>
                  {detail.categoryName && <span className="drama-detail-badge drama-detail-category">{detail.categoryName}</span>}
                  {detail.tags.map((tag) => <span className="drama-detail-badge" key={tag}>{tag}</span>)}
                </div>
              </div>
            </section>

            <section className="drama-basic-info" aria-labelledby="basic-info-title">
              <h2 id="basic-info-title">{t('basicInfo')}</h2>
              <p className={!expanded ? 'drama-description-clamped' : ''}>{detail.description || t('descriptionUnavailable')}</p>
              {detail.description && detail.description.length > 80 && (
                <button className="drama-description-toggle" type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
                  {expanded ? t('collapse') : t('expand')}
                </button>
              )}
            </section>

            {detail.actors.length > 0 && (
              <section className="drama-cast-section" aria-labelledby="drama-cast-title">
                <h2 id="drama-cast-title">{t('castTitle')}</h2>
                <div className="drama-cast-list">
                  {detail.actors.map((actor, index) => (
                    <article className="drama-cast-member" key={`${actor.name}-${index}`}>
                      <strong>{actor.name}</strong>
                      {actor.roleName && <span>{actor.roleName}</span>}
                    </article>
                  ))}
                </div>
              </section>
            )}

            <section className="drama-episodes-section" aria-labelledby="drama-episodes-title">
              <div className="drama-episodes-heading">
                <h2 id="drama-episodes-title">{t('episodesHeading')}</h2>
                <span>{t('detailEpisodeCount', { count: totalEpisodeCount })}<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" /></svg></span>
              </div>
              {ranges.length > 0 && (
                <div className="episode-range-list" role="tablist" aria-label={t('episodeRanges')}>
                  {ranges.map((range) => (
                    <button key={range.start} type="button" role="tab" aria-selected={range.start === rangeStart} className={range.start === rangeStart ? 'active' : ''} onClick={() => setRangeStart(range.start)}>
                      {range.start}–{range.end}
                    </button>
                  ))}
                </div>
              )}
              {rangeEpisodes.length > 0
                ? <div className="episode-grid" role="list">
                    {rangeEpisodes.map((episode) => (
                      <Link className={'episode-tile' + (episode.isFree ? '' : ' is-locked')} key={episode.id} href={'/' + locale + '/dramas/' + encodeURIComponent(detail.id) + '/play/' + encodeURIComponent(episode.id)} role="listitem" aria-label={t('episodeNumber', { number: episode.number })}>
                        {!episode.isFree && <span className="episode-lock"><LockIcon /></span>}
                        <span>{episode.number}</span>
                      </Link>
                    ))}
                  </div>
                : <p className="episode-empty-state">{t('episodeGroupEmpty')}</p>}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
