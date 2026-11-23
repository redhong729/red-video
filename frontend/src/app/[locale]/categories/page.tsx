import { hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { CategoriesPage } from '@/components/CategoriesPage';
import { locales } from '@/i18n/routing';

export default async function LocalizedCategoriesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(locales, locale)) notFound();
  setRequestLocale(locale);
  return <CategoriesPage />;
}
