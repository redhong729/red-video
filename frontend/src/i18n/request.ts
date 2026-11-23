import { getRequestConfig } from 'next-intl/server';
import { defaultLocale, locales } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  const requestedLocale = await requestLocale;
  const locale = locales.find((entry) => entry === requestedLocale) ?? defaultLocale;
  const messages = await import('../../messages/' + locale + '.json');

  return { locale, messages: messages.default };
});
