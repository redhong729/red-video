import { ImageResponse } from 'next/og';
import { PwaAppIcon } from '@/components/PwaAppIcon';

export function generateStaticParams() {
  return [{ size: '192' }, { size: '512' }];
}

export async function GET(_request: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size: sizeValue } = await params;
  const size = Number(sizeValue);
  if (size !== 192 && size !== 512) return new Response('Not found', { status: 404 });
  return new ImageResponse(<PwaAppIcon />, { width: size, height: size });
}
