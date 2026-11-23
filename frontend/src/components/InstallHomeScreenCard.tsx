'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

type InstallOutcome = { outcome: 'accepted' | 'dismissed'; platform?: string };
type DeferredInstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<InstallOutcome>;
};
type InstallNavigator = Navigator & {
  install?: () => Promise<void>;
  standalone?: boolean;
};
type InstallMode = 'checking' | 'hidden' | 'installed' | 'installable' | 'ios-guide' | 'android-guide';
type InstallPlatform = 'ios' | 'android' | 'other';

export function InstallHomeScreenCard() {
  const t = useTranslations('home');
  const [mode, setMode] = useState<InstallMode>('checking');
  const [platform, setPlatform] = useState<InstallPlatform>('other');
  const [installPrompt, setInstallPrompt] = useState<DeferredInstallPrompt | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    const appNavigator = navigator as InstallNavigator;
    const userAgent = navigator.userAgent;
    const isIOS = /iPhone|iPad|iPod/i.test(userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/i.test(userAgent);
    setPlatform(isIOS ? 'ios' : isAndroid ? 'android' : 'other');
    const installed = appNavigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
    const hasNativeInstall = typeof appNavigator.install === 'function';

    if (installed) setMode('installed');
    else if (isIOS) setMode('ios-guide');
    else if (hasNativeInstall) setMode('installable');
    else if (isAndroid) setMode('android-guide');
    else setMode('hidden');

    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as DeferredInstallPrompt);
      setMode('installable');
    };
    const handleInstalled = () => {
      setInstallPrompt(null);
      setMode('installed');
    };
    window.addEventListener('beforeinstallprompt', handleInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  async function addToHomeScreen() {
    setFeedback('');
    if (mode === 'ios-guide' || mode === 'android-guide') {
      setShowGuide((current) => !current);
      return;
    }

    setBusy(true);
    try {
      const appNavigator = navigator as InstallNavigator;
      if (typeof appNavigator.install === 'function') {
        await appNavigator.install();
        setMode('installed');
        return;
      }

      if (!installPrompt) {
        setShowGuide(true);
        return;
      }

      const prompt = installPrompt;
      setInstallPrompt(null);
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === 'accepted') setMode('installed');
      else {
        setFeedback('installHomeDismissed');
        setShowGuide(true);
      }
    } catch (error) {
      setFeedback(error instanceof Error && error.name === 'AbortError' ? 'installHomeDismissed' : 'installHomeFailed');
      setShowGuide(true);
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'checking' || mode === 'hidden') return null;

  const guideKey = platform === 'ios' ? 'installHomeIOSGuide' : platform === 'android' ? 'installHomeAndroidGuide' : 'installHomeBrowserGuide';
  const isManualGuide = mode === 'ios-guide' || mode === 'android-guide';

  return (
    <section className="watchlist-card profile-watchlist install-home-card">
      <span className="watchlist-heart install-home-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><rect x="6.5" y="2.5" width="11" height="19" rx="2.3" /><path d="M10 18.5h4" /><path d="M12 6v7m-3-3 3 3 3-3" /></svg>
      </span>
      <div className="install-home-copy">
        <strong>{t('installHomeTitle')}</strong>
        <p>{mode === 'installed' ? t('installHomeInstalled') : t('installHomeBody')}</p>
        {showGuide && <div id="install-home-guide" className="install-home-guide"><strong>{t('installHomeInstructions')}</strong><p>{t(guideKey)}</p></div>}
        {feedback && <p className="install-home-feedback" role="status">{t(feedback)}</p>}
      </div>
      {mode !== 'installed' && <button className="install-home-button" type="button" onClick={() => void addToHomeScreen()} aria-expanded={isManualGuide ? showGuide : undefined} aria-controls="install-home-guide" disabled={busy}>
        {busy ? t('installHomeWorking') : isManualGuide ? t('installHomeShowSteps') : t('installHomeButton')}
      </button>}
    </section>
  );
}
