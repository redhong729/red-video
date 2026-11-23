import { hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { HomePage } from '@/components/HomePage';
import { locales } from '@/i18n/routing';

export default async function LocalizedHomePage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(locales, locale)) notFound();

  setRequestLocale(locale);
  return <HomePage />;
}
