'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { BottomTabBar } from '@/components/BottomTabBar';
import { SearchForm } from '@/components/SearchForm';
import { StoryCard } from '@/components/StoryCard';
import { useHomeSections } from '@/lib/home-data';

type IconName = 'search' | 'home' | 'grid' | 'user' | 'play' | 'arrow' | 'clock' | 'close' | 'heart' | 'fire' | 'chevron';
type Panel = 'ranking' | null;

const iconPaths: Record<IconName, ReactNode> = {
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  home: <><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9M9 20v-6h6v6" /></>,
  grid: <><rect x="4" y="4" width="6" height="6" rx="1.5" /><rect x="14" y="4" width="6" height="6" rx="1.5" /><rect x="4" y="14" width="6" height="6" rx="1.5" /><rect x="14" y="14" width="6" height="6" rx="1.5" /></>,
  user: <><circle cx="12" cy="8" r="3.5" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" /></>,
  play: <><path d="m9 6 10 6-10 6V6Z" fill="currentColor" stroke="none" /></>,
  arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.3 2" /></>,
  close: <><path d="m6 6 12 12M18 6 6 18" /></>,
  heart: <><path d="M20.4 8.7c0 4.1-8.4 9.3-8.4 9.3S3.6 12.8 3.6 8.7A4.2 4.2 0 0 1 12 6.8a4.2 4.2 0 0 1 8.4 1.9Z" /></>,
  fire: <><path d="M12 22c4 0 7-3 7-7 0-3.3-2.3-5.4-4.6-7.4.1 2.3-1 3.4-2 3.8C12.8 7.4 10.5 4.1 8.4 2 8.8 6.9 5 9.4 5 15c0 4 3 7 7 7Z" /><path d="M12 22c-1.8 0-3-1.4-3-3.2 0-1.6 1.2-2.6 2.3-3.6.3 1.2 1.1 1.9 1.7 2.1.5-1 1-1.6 1.6-2 .4 3.5-.6 6.7-2.6 6.7Z" /></>,
  chevron: <><path d="m9 18 6-6-6-6" /></>
};

function Icon({ name, size = 20, className = '' }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {iconPaths[name]}
    </svg>
  );
}

export function HomePage() {
  const t = useTranslations('home');
  const locale = useLocale();
  const { home, loading: storiesLoading, failed: storiesFailed, retry: retryStories } = useHomeSections(locale);
  const homeStories = home.popular;
  const featuredSlides = home.featured;
  const [panel, setPanel] = useState<Panel>(null);
  const [activeFeatureIndex, setActiveFeatureIndex] = useState(0);
  const featurePointerStart = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const suppressFeatureClick = useRef(false);

  const language = locale === 'en' ? 'EN' : '中文';
  const otherLocale = locale === 'en' ? 'zh-CN' : 'en';

  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const selectedFeatureIndex = featuredSlides.length ? activeFeatureIndex % featuredSlides.length : 0;
  const featured = featuredSlides[selectedFeatureIndex] ?? null;
  const featuredImage = featured?.coverUrl ?? null;
  const heroBackground = featuredImage
    ? 'linear-gradient(90deg, rgba(15, 12, 16, .98) 0%, rgba(15, 12, 16, .83) 32%, rgba(15, 12, 16, .12) 69%, rgba(15, 12, 16, .02) 100%), linear-gradient(0deg, rgba(15,12,16,.72), transparent 40%), url(\"' + featuredImage + '\")'
    : 'linear-gradient(90deg, rgba(15, 12, 16, .98) 0%, rgba(15, 12, 16, .82) 42%, rgba(15, 12, 16, .25) 100%), radial-gradient(ellipse at 78% 38%, rgba(177, 87, 109, .55), transparent 44%), #32242c';

  function selectFeatured(index: number) {
    if (!featuredSlides.length) return;
    setActiveFeatureIndex((index + featuredSlides.length) % featuredSlides.length);
  }

  function handleFeaturePointerDown(event: PointerEvent<HTMLDivElement>) {
    featurePointerStart.current = null;
    const target = event.target;
    if (target instanceof Element && target.closest('a, button, input, select, textarea, [role="button"]')) return;
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    featurePointerStart.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleFeaturePointerUp(event: PointerEvent<HTMLDivElement>) {
    const start = featurePointerStart.current;
    featurePointerStart.current = null;
    if (!start || start.pointerId !== event.pointerId || featuredSlides.length < 2) return;

    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.abs(deltaX) < 44 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;

    suppressFeatureClick.current = true;
    window.setTimeout(() => { suppressFeatureClick.current = false; }, 500);
    selectFeatured(selectedFeatureIndex + (deltaX < 0 ? 1 : -1));
  }

  return (
    <div className="site-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <button className="brand" aria-label="RED Stories home" onClick={() => scrollTo('home')}>
            <span className="brand-mark"><Icon name="play" size={17} /></span>
            <span className="brand-word"><strong>RED</strong><span>STORIES</span></span>
          </button>
          <span className="brand-tagline">{t('tagline')}</span>
          <SearchForm />
          <div className="topbar-actions">
            <button className="rank-button" onClick={() => setPanel('ranking')}>
              <Icon name="fire" size={17} />
              <span>{t('rank')}</span>
            </button>
            <Link href={'/' + otherLocale} className="language-toggle" aria-label="Change language">
              {language}
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="hero-wrap page-width" id="home" aria-label={t('featuredLabel')}>
          <div
            className="hero-card"
            role="region"
            tabIndex={0}
            aria-roledescription="carousel"
            aria-label={t('featuredLabel')}
            style={{ backgroundImage: heroBackground }}
            onPointerDown={handleFeaturePointerDown}
            onPointerUp={handleFeaturePointerUp}
            onPointerCancel={() => { featurePointerStart.current = null; }}
            onClickCapture={(event) => {
              if (!suppressFeatureClick.current) return;
              event.preventDefault();
              event.stopPropagation();
              suppressFeatureClick.current = false;
            }}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === 'ArrowLeft') {
                event.preventDefault();
                selectFeatured(selectedFeatureIndex - 1);
              } else if (event.key === 'ArrowRight') {
                event.preventDefault();
                selectFeatured(selectedFeatureIndex + 1);
              }
            }}
          >
            <div className="hero-grain" aria-hidden="true" />
            <div className="hero-copy">
              <div className="eyebrow hero-eyebrow">
                <span className="eyebrow-dot" />
                {t('featuredLabel')}
              </div>
              {featured ? (
                <>
                  <div className="hero-meta">
                    <span>{t('featuredEpisodes', { count: featured.episodeCount })}</span>
                    {featured.categoryName && <><span className="meta-divider" /><span>{featured.categoryName}</span></>}
                  </div>
                  <h1>{featured.title}</h1>
                  {featured.description && <p className="hero-description">{featured.description}</p>}
                </>
              ) : (
                <>
                  <h1>{t('featuredEmptyTitle')}</h1>
                  <p className="hero-description">{t('featuredEmptyBody')}</p>
                </>
              )}
              <div className="hero-actions">
                {featured && <Link className="primary-button" href={'/' + locale + '/dramas/' + encodeURIComponent(featured.id)}><Icon name="play" size={17} />{t('watchNow')}</Link>}
                <button className="secondary-button" onClick={() => scrollTo('series')}>
                  {t('exploreSeries')}
                  <Icon name="arrow" size={17} />
                </button>
              </div>
            </div>
            {featuredSlides.length > 0 && <div className="hero-side-note"><span className="hero-side-line" /><span>{String(selectedFeatureIndex + 1).padStart(2, '0')} <i>/</i> {String(featuredSlides.length).padStart(2, '0')}</span></div>}
            <div className="hero-bottom">
              {featuredSlides.length > 0
                ? <div className="hero-pagination" aria-label={t('slideLabel', { current: selectedFeatureIndex + 1, total: featuredSlides.length })}>
                    {featuredSlides.map((slide, index) => <button key={slide.id} type="button" className={'page-dot' + (index === selectedFeatureIndex ? ' active' : '')} aria-label={t('slideLabel', { current: index + 1, total: featuredSlides.length })} aria-pressed={index === selectedFeatureIndex} onClick={() => selectFeatured(index)} />)}
                  </div>
                : <span />}
              <div className="hero-scroll"><span>{t('scrollHint')}</span><span className="scroll-line" /></div>
            </div>
            <span className="hero-corner hero-corner-top" aria-hidden="true" />
            <span className="hero-corner hero-corner-bottom" aria-hidden="true" />
          </div>
        </section>

        <div className="content-wrap page-width">
          <section className="series-section" id="series">
            <div className="series-heading">
              <div className="series-heading-copy">
                <p className="eyebrow"><Icon name="fire" size={15} />{t('popularEyebrow')}</p>
                <h2>{t('popularTitle')}</h2>
              </div>
              <Link className="see-all-button" href={'/' + locale + '/categories'}>{t('popularAction')}<Icon name="arrow" size={16} /></Link>
            </div>
            {storiesLoading ? <div className="story-empty-state">{t('storiesLoading')}</div>
              : storiesFailed ? <div className="story-empty-state"><p>{t('storiesFailed')}</p><button className="text-button" type="button" onClick={retryStories}>{t('retry')}</button></div>
                : homeStories.length > 0 ? <div className="drama-rail">{homeStories.map((story, index) => <StoryCard key={story.id} story={story} index={index} />)}</div>
                : <div className="story-empty-state"><h3>{t('storiesEmptyTitle')}</h3><p>{t('storiesEmptyBody')}</p></div>}
          </section>

          <section className="editorial-note" aria-label={t('madeForYou')}>
            <div className="editorial-mark"><span>R</span></div>
            <div>
              <p className="eyebrow">RED STORIES <span>•</span> 2026</p>
              <p className="editorial-copy">{t('madeForYou')}</p>
            </div>
            <span className="editorial-note-right">{t('seriesCount')}</span>
          </section>
        </div>
      </main>

      <BottomTabBar active="home" />

      {panel === 'ranking' && (
        <div className="panel-backdrop" role="presentation" onClick={() => setPanel(null)}>
          <aside className="side-panel" role="dialog" aria-modal="true" aria-labelledby="ranking-title" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header">
              <div>
                <p className="eyebrow"><Icon name="fire" size={15} />{t('rankingBadge')}</p>
                <h2 id="ranking-title">{t('rankingTitle')}</h2>
                <p>{t('rankingSub')}</p>
              </div>
              <button className="icon-button" onClick={() => setPanel(null)} aria-label={t('close')}><Icon name="close" /></button>
            </div>
            <div className="ranking-list">
              {home.ranking.length > 0 ? home.ranking.map((drama, index) => (
                <Link className="ranking-row" key={drama.id} href={'/' + locale + '/dramas/' + encodeURIComponent(drama.id)}>
                  <span className={'ranking-number rank-' + (drama.rank || index + 1)}>{String(drama.rank || index + 1).padStart(2, '0')}</span>
                  <span className="ranking-thumb" style={drama.coverUrl ? { backgroundImage: 'url("' + drama.coverUrl + '")' } : undefined} />
                  <span className="ranking-copy"><strong>{drama.title}</strong><small>{drama.categoryName ?? t('rankingDrama')} <i>·</i> {t('episodes', { count: drama.episodeCount })}</small></span>
                  <span className="ranking-trend"><Icon name="chevron" size={16} /></span>
                </Link>
              )) : <div className="ranking-empty">{t('rankingEmpty')}</div>}
            </div>
            <div className="panel-footer"><span className="footer-pulse" /> {t('rankingManualHint')}{home.rankingUpdatedAt && <> <span>•</span> {t('rankingUpdatedAt', { date: new Date(home.rankingUpdatedAt).toLocaleString(locale) })}</>}</div>
          </aside>
        </div>
      )}

    </div>
  );
}
