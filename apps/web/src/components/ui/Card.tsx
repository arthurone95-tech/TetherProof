import type { ReactNode } from 'react';

interface CardProps {
  title?: string;
  children: ReactNode;
}

export function Card({ title, children }: CardProps) {
  return (
    <section className="w-full rounded-2xl border border-brand-100 bg-white p-6 shadow-sm">
      {title ? <h2 className="mb-3 text-lg font-semibold text-ink-900">{title}</h2> : null}
      {children}
    </section>
  );
}
