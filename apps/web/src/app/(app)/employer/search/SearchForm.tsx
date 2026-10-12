'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { Bookmark, Search, SlidersHorizontal, X } from 'lucide-react';
import { Field } from '@/components/ui/Field';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';

interface SearchFormProps {
  defaultSkill: string;
  defaultMinProofs: string;
  defaultRadiusKm: string;
  /** Whether a location is saved; distance is ignored when it is not. */
  locationSet: boolean;
  /** How many searches are saved; the count on the Saved button. */
  savedCount: number;
  /** The saved-searches content, rendered by the server and shown in the sheet. */
  savedSearches: ReactNode;
}

const DEFAULT_MIN_PROOFS = '1';
const DEFAULT_RADIUS_KM = '25';

/**
 * The employer's search bar, and the two things that hang off it.
 *
 * The bar is a `GET` form, so a result is a shareable, reloadable address and
 * the search works before any JavaScript arrives — the client state here only
 * controls the two panels, never the query. The search button lives inside the
 * field, at its right edge, so there is no second row of controls under it.
 *
 * Two small buttons sit beside the bar. Filters opens a compact popover under
 * the bar, kept to a fixed width so it never takes over a phone's screen, and
 * stays in the DOM while closed (`hidden`) so its two values still post on
 * submit: collapsing it must not silently reset a search already narrowed.
 * Saved searches opens a sheet over the page, so the list is one tap away
 * without ever being pushed down by results, and without pushing them down in
 * turn.
 *
 * The sheet is rendered outside the `<form>`: its content has forms of its own
 * (pause, delete, save a search), and a form inside a form is invalid markup.
 * Its content arrives as `savedSearches`, already rendered on the server.
 */
export function SearchForm({
  defaultSkill,
  defaultMinProofs,
  defaultRadiusKm,
  locationSet,
  savedCount,
  savedSearches,
}: SearchFormProps) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const savedTriggerRef = useRef<HTMLButtonElement>(null);

  const filtersChanged =
    defaultMinProofs !== DEFAULT_MIN_PROOFS || defaultRadiusKm !== DEFAULT_RADIUS_KM;

  // A new address (running a saved search, a fresh query) means both panels have done their job.
  const pathname = usePathname();
  const queryKey = useSearchParams().toString();
  useEffect(() => {
    setFiltersOpen(false);
    setSavedOpen(false);
  }, [pathname, queryKey]);

  // Tapped outside the bar: close the filter popover.
  useEffect(() => {
    if (!filtersOpen) return undefined;
    const dismiss = (event: MouseEvent | TouchEvent) => {
      if (barRef.current && !barRef.current.contains(event.target as Node)) setFiltersOpen(false);
    };
    document.addEventListener('mousedown', dismiss, true);
    document.addEventListener('touchstart', dismiss, true);
    return () => {
      document.removeEventListener('mousedown', dismiss, true);
      document.removeEventListener('touchstart', dismiss, true);
    };
  }, [filtersOpen]);

  // Escape closes whichever panel is open.
  useEffect(() => {
    if (!filtersOpen && !savedOpen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setFiltersOpen(false);
      if (savedOpen) {
        setSavedOpen(false);
        savedTriggerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [filtersOpen, savedOpen]);

  return (
    <>
      <form method="get" action="/employer/search">
        <div ref={barRef} className="relative">
          <div className="flex items-center gap-2">
            {/* The search box: the green block at its right edge is the submit button. */}
            <div className="relative min-w-0 flex-1">
              <label htmlFor="skill" className="sr-only">
                Skill
              </label>
              <input
                id="skill"
                name="skill"
                type="search"
                required
                defaultValue={defaultSkill}
                placeholder="Search by proven skill"
                autoComplete="off"
                enterKeyHint="search"
                className="h-12 w-full rounded-xl border border-brand-100 bg-white pr-14 pl-4 text-base text-ink-900 transition-colors placeholder:text-ink-600/60 focus:border-brand-500"
              />
              <button
                type="submit"
                aria-label="Search"
                className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-xl bg-brand-600 text-white transition-colors hover:bg-brand-700 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-800"
              >
                <Search aria-hidden="true" className="h-5 w-5" strokeWidth={ICON_STROKE_WIDTH} />
              </button>
            </div>

            <BarButton
              label="Filters"
              pressed={filtersOpen}
              controls="search-filters"
              onClick={() => {
                setFiltersOpen((open) => !open);
                setSavedOpen(false);
              }}
            >
              <SlidersHorizontal aria-hidden="true" className="h-5 w-5" strokeWidth={ICON_STROKE_WIDTH} />
              {filtersChanged ? (
                <span
                  aria-hidden="true"
                  className="absolute top-2 right-2 h-2 w-2 rounded-full bg-brand-600 ring-2 ring-white"
                />
              ) : null}
            </BarButton>

            <BarButton
              ref={savedTriggerRef}
              label={savedCount > 0 ? `Saved searches, ${savedCount}` : 'Saved searches'}
              pressed={savedOpen}
              controls="saved-searches"
              onClick={() => {
                setSavedOpen(true);
                setFiltersOpen(false);
              }}
            >
              <Bookmark aria-hidden="true" className="h-5 w-5" strokeWidth={ICON_STROKE_WIDTH} />
              {savedCount > 0 ? (
                <span
                  aria-hidden="true"
                  className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1 text-[11px] font-semibold text-white tabular-nums ring-2 ring-white"
                >
                  {savedCount > 99 ? '99+' : savedCount}
                </span>
              ) : null}
            </BarButton>
          </div>

          <div
            id="search-filters"
            hidden={!filtersOpen}
            className="absolute top-full right-0 z-30 mt-2 w-72 max-w-full rounded-2xl border border-brand-100 bg-white p-4 shadow-lg shadow-brand-950/5"
          >
            <div className="grid grid-cols-2 gap-3">
              <Field
                name="minProofs"
                label="Min. proofs"
                type="number"
                inputMode="numeric"
                min={1}
                max={500}
                step={1}
                defaultValue={defaultMinProofs}
              />
              <Field
                name="radiusKm"
                label="Distance (km)"
                type="number"
                inputMode="numeric"
                min={1}
                max={20000}
                step={1}
                defaultValue={defaultRadiusKm}
              />
            </div>
            {!locationSet ? (
              <p className="mt-3 text-xs text-ink-500">
                Distance is ignored until you set a location in Organization.
              </p>
            ) : null}
          </div>
        </div>
      </form>

      {savedOpen ? (
        <SavedSheet onClose={() => {
          setSavedOpen(false);
          savedTriggerRef.current?.focus();
        }}>
          {savedSearches}
        </SavedSheet>
      ) : null}
    </>
  );
}

interface BarButtonProps {
  label: string;
  pressed: boolean;
  controls: string;
  onClick: () => void;
  children: ReactNode;
  ref?: React.Ref<HTMLButtonElement>;
}

/** One of the small square controls beside the search box. */
function BarButton({ label, pressed, controls, onClick, children, ref }: BarButtonProps) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-expanded={pressed}
      aria-controls={controls}
      aria-label={label}
      title={label}
      className={`relative flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border transition-colors ${
        pressed
          ? 'border-brand-600 bg-brand-50 text-brand-700'
          : 'border-brand-100 bg-white text-ink-700 hover:border-brand-300'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * The saved-searches sheet: up from the bottom on a phone, a centred panel on a
 * wide screen. It covers the page rather than moving it, so opening or closing
 * it never shifts the results behind, and the page underneath does not scroll
 * while it is open.
 */
function SavedSheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-start md:pt-24">
      <button
        type="button"
        aria-label="Close saved searches"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-ink-900/40"
      />
      <div
        id="saved-searches"
        role="dialog"
        aria-modal="true"
        aria-labelledby="saved-searches-title"
        className="relative flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-3xl bg-white shadow-xl md:rounded-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-brand-100 py-2 pr-2 pl-5">
          <h2 id="saved-searches-title" className="text-base font-semibold text-ink-900">
            Saved searches
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 items-center justify-center rounded-full text-ink-700 transition-colors hover:bg-brand-50"
          >
            <X aria-hidden="true" className="h-5 w-5" strokeWidth={ICON_STROKE_WIDTH} />
          </button>
        </div>
        <div className="overflow-y-auto overscroll-contain px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {children}
        </div>
      </div>
    </div>
  );
}