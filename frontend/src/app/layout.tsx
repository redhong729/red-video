import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'RED Stories',
  description: 'Short stories. Big feelings.',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'RED Stories'
  }
};

export const viewport: Viewport = {
  themeColor: '#110f13',
  width: 'device-width',
  initialScale: 1
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
