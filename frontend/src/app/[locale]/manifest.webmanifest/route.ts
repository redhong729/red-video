import type { MetadataRoute } from 'next';
import { hasLocale } from 'next-intl';
import { defaultLocale, locales } from '@/i18n/routing';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string }> }
) {
  const { locale: requestedLocale } = await params;
  const locale = hasLocale(locales, requestedLocale) ? requestedLocale : defaultLocale;
  const isEnglish = locale === 'en';

  const manifest: MetadataRoute.Manifest = {
    id: '/red-stories',
    name: 'RED Stories',
    short_name: isEnglish ? 'RED Stories' : 'RED 短剧',
    description: isEnglish ? 'Short stories. Big feelings.' : '一集接一集，故事停不下来。',
    lang: locale,
    start_url: `/${locale}`,
    scope: '/',
    display: 'standalone',
    background_color: '#110f13',
    theme_color: '#110f13',
    categories: ['entertainment'],
    icons: [
      { src: '/pwa-icon/192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/pwa-icon/192', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/pwa-icon/512', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/pwa-icon/512', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  };

  return Response.json(manifest, {
    headers: { 'Content-Type': 'application/manifest+json; charset=utf-8' }
  });
}
