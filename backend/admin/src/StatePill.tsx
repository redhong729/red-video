import type { ReactNode } from 'react';

export type StateTone = 'success' | 'info' | 'warning' | 'danger' | 'neutral';

export function StatePill({ children, tone = 'neutral' }: { children: ReactNode; tone?: StateTone }) {
  return <span className={`state-pill state-pill-${tone}`}>{children}</span>;
}
