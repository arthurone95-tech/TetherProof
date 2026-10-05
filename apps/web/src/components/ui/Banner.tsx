import type { ReactNode } from 'react';

type Tone = 'info' | 'success' | 'warning' | 'problem';

const tones: Record<Tone, { box: string; mark: string; label: string }> = {
  info: { box: 'bg-brand-50 text-ink-900', mark: 'i', label: 'Note' },
  success: { box: 'bg-brand-50 text-ink-900', mark: '✓', label: 'Done' },
  warning: { box: 'bg-amber-50 text-ink-900', mark: '!', label: 'Needs attention' },
  problem: { box: 'bg-red-50 text-ink-900', mark: '!', label: 'Problem' },
};

interface BannerProps {
  tone?: Tone;
  title?: string;
  children: ReactNode;
}

/**
 * A status or explanatory message.
 *
 * `role="status"` on informational and success messages and `role="alert"` on
 * problems, so assistive technology announces the change when it arrives rather than
 * leaving the user to notice a block of new text. The visible label is a real word
 * rather than an icon alone, because a coloured circle with a tick is not
 * comprehensible to a screen reader and does not survive a greyscale print.
 */
export function Banner({ tone = 'info', title, children }: BannerProps) {
  const { box, mark, label } = tones[tone];

  return (
    <div
      role={tone === 'problem' ? 'alert' : 'status'}
      className={`flex gap-3 rounded-xl p-4 text-sm ${box}`}
    >
      <span
        aria-hidden="true"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/70 font-bold text-brand-700"
      >
        {mark}
      </span>
      <div className="space-y-1">
        <p className="font-semibold">{title ?? label}</p>
        <div className="text-ink-600">{children}</div>
      </div>
    </div>
  );
}