'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ApiRequestError, apiFetch } from '@/lib/api';

interface VerificationSummary {
  skillTag: string | null;
  taskSummary: string;
  status: 'awaiting_response' | 'confirmed' | 'rejected';
  expiresAt: string;
  respondedAt: string | null;
}

type ViewState =
  | { phase: 'loading' }
  | { phase: 'ready'; summary: VerificationSummary }
  | { phase: 'submitting'; summary: VerificationSummary }
  | { phase: 'done'; outcome: 'confirmed' | 'rejected' }
  | { phase: 'error'; message: string };

export function VerificationView({ token }: { token: string }) {
  const [state, setState] = useState<ViewState>({ phase: 'loading' });

  const load = useCallback(async () => {
    setState({ phase: 'loading' });
    try {
      const summary = await apiFetch<VerificationSummary>(`/verifications/${token}`);
      setState({ phase: 'ready', summary });
    } catch (error) {
      setState({
        phase: 'error',
        message:
          error instanceof ApiRequestError
            ? error.message
            : 'We could not load this request. Please try again.',
      });
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function respond(response: 'confirmed' | 'rejected') {
    if (state.phase !== 'ready' && state.phase !== 'submitting') return;
    setState({ phase: 'submitting', summary: state.summary });

    try {
      await apiFetch(`/verifications/${token}`, {
        method: 'POST',
        body: JSON.stringify({ response }),
      });
      setState({ phase: 'done', outcome: response });
    } catch (error) {
      setState({
        phase: 'error',
        message:
          error instanceof ApiRequestError
            ? error.message
            : 'We could not record your answer. Please try again.',
      });
    }
  }

  if (state.phase === 'loading') {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
        <div className="rounded-2xl border border-brand-100 bg-white p-6" aria-busy="true">
          <div className="h-4 w-24 animate-pulse rounded bg-brand-100" />
          <div className="mt-4 h-6 w-full animate-pulse rounded bg-brand-50" />
          <div className="mt-3 h-4 w-3/4 animate-pulse rounded bg-brand-50" />
          <p className="sr-only">Loading request details</p>
        </div>
      </main>
    );
  }

  if (state.phase === 'error') {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
        <Card title="This request could not be opened">
          <p role="alert" className="text-ink-600">
            {state.message}
          </p>
          <div className="mt-6">
            <Button variant="secondary" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        </Card>
      </main>
    );
  }

  if (state.phase === 'done') {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
        <Card>
          <div role="status" aria-live="polite" className="text-center">
            <div
              aria-hidden="true"
              className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-2xl text-brand-600"
            >
              {state.outcome === 'confirmed' ? '✓' : '!'}
            </div>
            <h1 className="text-xl font-semibold text-ink-900">
              {state.outcome === 'confirmed' ? 'Thank you' : 'Request noted'}
            </h1>
            <p className="mt-2 text-ink-600">
              {state.outcome === 'confirmed'
                ? 'Your confirmation has been recorded.'
                : 'The worker has been told that something needs attention.'}
            </p>
            <p className="mt-4 text-sm text-ink-600">You can close this page.</p>
          </div>
        </Card>
      </main>
    );
  }

  const { summary } = state;
  const busy = state.phase === 'submitting';

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      <Card>
        <p className="text-sm font-semibold tracking-wide text-brand-600 uppercase">TetherProof</p>
        <h1 className="mt-2 text-xl font-semibold text-ink-900">Was this work completed?</h1>

        {summary.skillTag ? (
          <p className="mt-3 inline-block rounded-full bg-brand-50 px-3 py-1 text-sm font-medium text-brand-700">
            {summary.skillTag}
          </p>
        ) : null}

        <p className="mt-4 text-ink-600">{summary.taskSummary}</p>

        {summary.status === 'awaiting_response' ? (
          <>
            <p className="mt-6 text-sm text-ink-600" id="confirm-hint">
              Your answer is shared with the worker and cannot be changed afterwards.
            </p>
            <div className="mt-4 flex flex-col gap-3" aria-describedby="confirm-hint">
              <Button disabled={busy} onClick={() => void respond('confirmed')}>
                {busy ? 'Sending…' : 'Yes, work completed'}
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => void respond('rejected')}>
                No / report issue
              </Button>
            </div>
          </>
        ) : (
          <div role="status" aria-live="polite" className="mt-6">
            <p className="text-ink-600">
              This request was already answered{' '}
              {summary.respondedAt ? `on ${new Date(summary.respondedAt).toLocaleDateString()}` : ''}.
            </p>
          </div>
        )}
      </Card>
    </main>
  );
}
