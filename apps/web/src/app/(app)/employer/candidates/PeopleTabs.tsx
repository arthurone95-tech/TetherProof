'use client';

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

type TabId = 'accepted' | 'awaiting';

/**
 * The two-way switch between accepted candidates and invitations still waiting.
 *
 * The panels are handed in already rendered, so switching a tab moves no data:
 * both lists arrive together with the page and neither is refetched or reset when
 * the employer flips between them. Only the selected panel is visible; the other
 * stays in the document hidden, which keeps each tab's `aria-controls` pointing at
 * a real element.
 *
 * Follows the house tab pattern from the sign-in screen — a raised pill on a
 * tinted track — so the two switches in the product feel like the same control.
 */
export function PeopleTabs({
  accepted,
  awaiting,
  acceptedCount,
  awaitingCount,
}: {
  accepted: ReactNode;
  awaiting: ReactNode;
  acceptedCount: number;
  awaitingCount: number;
}) {
  const defaultTab: TabId = acceptedCount > 0 || awaitingCount === 0 ? 'accepted' : 'awaiting';
  const [active, setActive] = useState<TabId>(defaultTab);
  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({ accepted: null, awaiting: null });

  const tabs: ReadonlyArray<{ id: TabId; label: string; count: number }> = [
    { id: 'accepted', label: 'Accepted', count: acceptedCount },
    { id: 'awaiting', label: 'Awaiting reply', count: awaitingCount },
  ];

  function select(id: TabId) {
    setActive(id);
    tabRefs.current[id]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const index = tabs.findIndex((tab) => tab.id === active);
    const step = event.key === 'ArrowRight' ? 1 : -1;
    const next = tabs[(index + step + tabs.length) % tabs.length];
    if (next) select(next.id);
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="Candidates"
        onKeyDown={onKeyDown}
        className="relative grid grid-cols-2 rounded-2xl bg-brand-50 p-1"
      >
        <span
          aria-hidden="true"
          className={`absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-xl bg-white shadow-sm ring-1 ring-brand-100 transition-transform duration-200 ease-out motion-reduce:transition-none ${
            active === 'awaiting' ? 'translate-x-full' : 'translate-x-0'
          }`}
        />
        {tabs.map((tab) => (
          <button
            key={tab.id}
            ref={(node) => {
              tabRefs.current[tab.id] = node;
            }}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={active === tab.id}
            aria-controls={`panel-${tab.id}`}
            tabIndex={active === tab.id ? 0 : -1}
            onClick={() => setActive(tab.id)}
            className={`relative z-10 flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-2 text-sm font-semibold transition-colors ${
              active === tab.id ? 'text-ink-900' : 'text-ink-600 hover:text-ink-900'
            }`}
          >
            <span className="truncate">{tab.label}</span>
            {tab.count > 0 ? (
              <span
                className={`rounded-full px-1.5 text-xs font-semibold tabular-nums ${
                  active === tab.id ? 'bg-brand-100 text-brand-700' : 'bg-white text-ink-600'
                }`}
              >
                {tab.count > 99 ? '99+' : tab.count}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id="panel-accepted"
        aria-labelledby="tab-accepted"
        hidden={active !== 'accepted'}
      >
        {accepted}
      </div>
      <div
        role="tabpanel"
        id="panel-awaiting"
        aria-labelledby="tab-awaiting"
        hidden={active !== 'awaiting'}
      >
        {awaiting}
      </div>
    </div>
  );
}
