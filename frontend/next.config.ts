import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

export default withNextIntl({
  async rewrites() {
    const apiTarget = (process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:4000').replace(/\/+$/, '');
    return [{ source: '/api/:path*', destination: apiTarget + '/api/:path*' }];
  }
});
