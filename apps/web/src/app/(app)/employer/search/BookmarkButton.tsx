'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Star } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';
import { saveSavedWorker, unsaveSavedWorker } from '@/lib/actions';

/**
 * Saves or unsaves one worker, from a search card or from the saved list.
 *
 * Backed by the server rather than by component state, because a star that
 * forgets on reload tells the employer they have saved someone when they have
 * not — which is worse than having no control at all. The employer is the only
 * one who ever sees a saved worker: the worker is not told, and the saved row is
 * not exposed to any other employer.
 *
 * The state is optimistic and then confirmed. A tap on a star is a small,
 * reversible thing and waiting on a round trip before it moves makes the control
 * feel broken; if the write fails the star goes back and the reason is shown
 * inline, because silently reverting would be its own kind of lie.
 *
 * `onChange` lets the parent refresh the server-rendered list, since the saved
 * list and the star on a search card are two views of the same rows.
 */
export function BookmarkButton({
  label,
  candidateHandle,
  skillTag,
  savedId,
  initiallySaved,
  onChange,
  className,
}: {
  /** Read aloud in the accessible name. */
  label: string;
  /** Needed to save. Absent on a card that is already saved, which unsaves by id. */
  candidateHandle?: string;
  /** The skill this worker is saved under. */
  skillTag: string;
  /** Present once saved, which is what unsaving addresses. */
  savedId?: string;
  initiallySaved: boolean;
  onChange?: () => void;
  className?: string;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(initiallySaved);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setError(null);
    // Optimistic: flip immediately, and put it back if the server disagrees.
    const goingToSave = !saved;
    setSaved(goingToSave);

    try {
      if (goingToSave) {
        await saveSavedWorker(candidateHandle ?? '', skillTag);
      } else {
        await unsaveSavedWorker(savedId ?? '');
      }
      startTransition(() => {
        onChange?.();
        router.refresh();
      });
    } catch (cause) {
      setSaved(!goingToSave);
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : 'That could not be saved. Please try again.',
      );
    }
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={pending}
        aria-pressed={saved}
        aria-label={saved ? `Remove ${label} from saved workers` : `Save ${label}`}
        title={saved ? 'Saved' : 'Save this worker'}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-60 ${
          saved ? 'text-amber-500 hover:bg-amber-50' : 'text-ink-400 hover:bg-brand-50 hover:text-ink-700'
        } ${className ?? ''}`}
      >
        <Star
          aria-hidden="true"
          className={`h-5 w-5 ${saved ? 'fill-current' : ''}`}
          strokeWidth={ICON_STROKE_WIDTH}
        />
      </button>
      {error ? (
        <span role="alert" className="max-w-48 text-right text-xs font-medium text-red-700">
          {error}
        </span>
      ) : null}
    </span>
  );
}
