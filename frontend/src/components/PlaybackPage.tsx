'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type TouchEvent, type TransitionEvent, type WheelEvent } from 'react';
import { requestDramaDetail } from '@/lib/drama-detail-data';
import type { DramaDetail } from '@/lib/catalog';

function LockIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="4" y="10" width="16" height="12" rx="3" fill="currentColor" /><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /></svg>;
}

function MediaToggleIcon({ playing }: { playing: boolean }) {
  return playing
    ? <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" /><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" /></svg>
    : <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m8 5 12 7-12 7V5Z" fill="currentColor" /></svg>;
}

export function PlaybackPage({ dramaId, episodeId }: { dramaId: string; episodeId: string }) {
  const t = useTranslations('home');
  const locale = useLocale();
  const [detail, setDetail] = useState<DramaDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [activeEpisodeId, setActiveEpisodeId] = useState(episodeId);
  const [videoFailed, setVideoFailed] = useState(false);
  const [videoRetry, setVideoRetry] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [slideTarget, setSlideTarget] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const shellRef = useRef<HTMLElement>(null);
  const touchStartY = useRef<number | null>(null);
  const lastTransitionAt = useRef(0);
  const pendingDirection = useRef<-1 | 1 | null>(null);

  useEffect(() => {
    let active = true;
    setActiveEpisodeId(episodeId);
    setVideoFailed(false);
    setVideoRetry(0);
    setIsPlaying(false);
    setIsTransitioning(false);
    setSlideTarget(0);
    pendingDirection.current = null;
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
  }, [dramaId, episodeId, locale]);

  const episodes = detail?.episodes ?? [];
  const activeEpisodeIndex = episodes.findIndex((episode) => episode.id === activeEpisodeId);
  const activeEpisode = activeEpisodeIndex >= 0 ? episodes[activeEpisodeIndex] : null;

  useEffect(() => {
    setVideoFailed(false);
    setVideoRetry(0);
    setIsPlaying(false);
  }, [activeEpisodeId]);

  const changeEpisode = useCallback((direction: -1 | 1) => {
    if (activeEpisodeIndex < 0 || pendingDirection.current || Date.now() - lastTransitionAt.current < 450) return;
    const nextEpisode = episodes[activeEpisodeIndex + direction];
    if (!nextEpisode) return;
    lastTransitionAt.current = Date.now();
    pendingDirection.current = direction;
    videoRef.current?.pause();
    setIsPlaying(false);
    setSlideTarget(direction > 0 ? -1 : 1);
    setIsTransitioning(true);
  }, [activeEpisodeIndex, episodes]);

  function finishEpisodeTransition(event: TransitionEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || event.propertyName !== 'transform') return;
    const direction = pendingDirection.current;
    if (!direction) return;
    const nextEpisode = episodes[activeEpisodeIndex + direction];
    if (nextEpisode) setActiveEpisodeId(nextEpisode.id);
    pendingDirection.current = null;
    setSlideTarget(0);
    setIsTransitioning(false);
  }

  function handleTouchStart(event: TouchEvent<HTMLElement>) {
    touchStartY.current = event.touches[0]?.clientY ?? null;
  }

  function handleTouchEnd(event: TouchEvent<HTMLElement>) {
    const start = touchStartY.current;
    touchStartY.current = null;
    const end = event.changedTouches[0]?.clientY;
    if (start === null || end === undefined || Math.abs(start - end) < 58) return;
    changeEpisode(start > end ? 1 : -1);
  }

  function handleWheel(event: WheelEvent<HTMLElement>) {
    if (Math.abs(event.deltaY) < 32) return;
    changeEpisode(event.deltaY > 0 ? 1 : -1);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'ArrowDown' || event.key === 'PageDown') {
      event.preventDefault();
      changeEpisode(1);
    } else if (event.key === 'ArrowUp' || event.key === 'PageUp') {
      event.preventDefault();
      changeEpisode(-1);
    }
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await shellRef.current?.requestFullscreen();
    } catch {
      // The player remains full-viewport even if browser fullscreen is unavailable.
    }
  }

  async function togglePlayback() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      try { await video.play(); } catch { setIsPlaying(false); }
    } else {
      video.pause();
    }
  }

  const videoUrl = detail && activeEpisode?.isFree
    ? `/api/public/dramas/${encodeURIComponent(dramaId)}/episodes/${encodeURIComponent(activeEpisode.id)}/video`
    : null;
  // Keep only a three-slot window mounted: previous, active, and next episode.
  const visibleSlides = activeEpisodeIndex >= 0
    ? [-1, 0, 1].map((position) => ({ position, episode: episodes[activeEpisodeIndex + position] ?? null }))
    : [];
  const trackTransform = slideTarget < 0 ? 'translate3d(0, -66.666667%, 0)'
    : slideTarget > 0 ? 'translate3d(0, 0, 0)'
      : 'translate3d(0, -33.333333%, 0)';

  return (
    <main
      className="playback-shell"
      ref={shellRef}
      tabIndex={0}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onWheel={handleWheel}
      onKeyDown={handleKeyDown}
    >
      {detail && activeEpisode && (
        <>
          <div className="playback-window">
            <div className={'playback-track' + (isTransitioning ? ' is-transitioning' : '')} style={{ transform: trackTransform }} onTransitionEnd={finishEpisodeTransition}>
              {visibleSlides.map(({ position, episode }) => (
                <section className="playback-slide" key={episode?.id ?? 'empty-' + position} aria-hidden={position !== 0}>
                  {position !== 0 && episode && (
                    <div className="playback-neighbor" style={detail.coverUrl ? { backgroundImage: `linear-gradient(0deg, rgba(0,0,0,.8), rgba(0,0,0,.2)), url("${detail.coverUrl}")` } : undefined}>
                      <span>{t('episodeNumber', { number: episode.number })}</span>
                      <strong>{detail.title}</strong>
                    </div>
                  )}
                  {position === 0 && episode && activeEpisode.isFree && videoUrl && !videoFailed && (
                    <video
                      ref={videoRef}
                      className="playback-video"
                      key={activeEpisode.id + ':' + videoRetry}
                      src={videoUrl}
                      poster={detail.coverUrl ?? undefined}
                      playsInline
                      autoPlay
                      preload="auto"
                      onClick={() => { void togglePlayback(); }}
                      onPlay={() => setIsPlaying(true)}
                      onPause={() => setIsPlaying(false)}
                      onError={() => setVideoFailed(true)}
                    />
                  )}
                  {position === 0 && episode && activeEpisode.isFree && videoFailed && (
                    <div className="playback-message">
                      <p>{t('playbackFailed')}</p>
                      <button type="button" onClick={() => { setVideoFailed(false); setVideoRetry((value) => value + 1); }}>{t('playbackRetry')}</button>
                    </div>
                  )}
                  {position === 0 && episode && !activeEpisode.isFree && (
                    <div className="playback-locked">
                      <span className="playback-lock-icon"><LockIcon /></span>
                      <h1>{t('episodeLockedTitle')}</h1>
                      <p>{t('episodeLockedBody')}</p>
                    </div>
                  )}
                  {position === 0 && episode && activeEpisode.isFree && videoUrl && !videoFailed && (
                    <button className="playback-toggle" type="button" onClick={() => { void togglePlayback(); }} aria-label={isPlaying ? t('playbackPause') : t('playbackPlay')} aria-pressed={isPlaying}>
                      <MediaToggleIcon playing={isPlaying} />
                    </button>
                  )}
                  <div className="playback-shade" aria-hidden="true" />
                </section>
              ))}
            </div>
          </div>

          <header className="playback-header">
            <Link className="playback-back" href={'/' + locale + '/dramas/' + encodeURIComponent(dramaId)} aria-label={t('playbackBack')}>
              <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" /></svg>
            </Link>
            <div className="playback-title">
              <strong>{detail.title}</strong>
              <span>{t('episodeNumber', { number: activeEpisode.number })}</span>
            </div>
            <button className="playback-fullscreen" type="button" onClick={toggleFullscreen} aria-label={t('playbackFullscreen')}>
              <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8 4H4v4M16 4h4v4M4 16v4h4M20 16v4h-4" /></svg>
            </button>
          </header>

          <div className="playback-episode-controls">
            <button type="button" aria-label={t('playbackPrevious')} disabled={activeEpisodeIndex <= 0 || isTransitioning} onClick={() => changeEpisode(-1)}>
              <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 15 6-6 6 6" /></svg>
            </button>
            <span>{activeEpisodeIndex + 1} / {episodes.length}</span>
            <button type="button" aria-label={t('playbackNext')} disabled={activeEpisodeIndex < 0 || activeEpisodeIndex >= episodes.length - 1 || isTransitioning} onClick={() => changeEpisode(1)}>
              <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg>
            </button>
          </div>
          <p className="playback-swipe-hint">{t('playbackSwipeHint')}</p>
        </>
      )}

      {(loading || failed || (!loading && detail && !activeEpisode)) && (
        <div className="playback-state">
          <p>{loading ? t('storiesLoading') : failed ? t('detailLoadFailed') : t('episodeUnavailable')}</p>
          <Link href={'/' + locale + '/dramas/' + encodeURIComponent(dramaId)}>{t('playbackBack')}</Link>
        </div>
      )}
    </main>
  );
}
