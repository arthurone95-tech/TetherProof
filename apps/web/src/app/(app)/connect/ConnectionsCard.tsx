'use client';

import { useActionState } from 'react';
import type { ConnectionInfo } from '@tetherproof/shared';
import { GitBranch } from 'lucide-react';
import { githubConnect, githubRevoke } from '@/lib/actions';
import { EMPTY_FORM, type FormState } from '@/lib/form-state';
import { FormSuccess } from '@/components/ui/FormSuccess';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * The work sources a worker has connected to their account.
 *
 * Connecting is a deliberate, repeating quote of what the source offers (the
 * GitHub start screen spells out the exact scopes being asked for), and the
 * API never stores the OAuth token — the row only records that a source is
 * connected and who it belongs to. So the card's job is honest: it shows what
 * the connection reads, connects when the member asks, and disconnects when
 * they change their mind, with the disconnection immediate because there is no
 * credential sitting on the server to revoke.
 */
export function ConnectionsCard({ connections }: { connections: ConnectionInfo[] }) {
  const [connectState, connectAction] = useActionState(githubConnect, EMPTY_FORM as FormState);
  const [revokeState, revokeAction] = useActionState(githubRevoke, EMPTY_FORM as FormState);

  const github = connections.find((connection) => connection.provider === 'github');

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-600">
        Sources of work you have connected. TetherProof reads public profile data only — a
        connection never lets TetherProof post, change, or delete anything on your behalf.
      </p>

      <div className="rounded-xl border border-brand-100 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
              <GitBranch aria-hidden="true" className="h-5 w-5" strokeWidth={ICON_STROKE_WIDTH} />
            </span>
            <div className="min-w-0">
              <p className="font-semibold text-ink-900">GitHub</p>
              {github ? (
                <p className="truncate text-sm text-ink-600">
                  @{github.externalUsername ?? 'connected'} · since{' '}
                  {DATE_FORMATTER.format(new Date(github.connectedAt))}
                </p>
              ) : (
                <p className="text-sm text-ink-600">Not connected</p>
              )}
            </div>
          </div>

          {github ? (
            <form action={revokeAction} className="shrink-0">
              <input type="hidden" name="provider" value="github" />
              <button
                type="submit"
                className="inline-flex min-h-10 items-center rounded-xl border border-brand-600 px-3 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50"
              >
                Disconnect
              </button>
            </form>
          ) : (
            <form action={connectAction} className="shrink-0">
              <button
                type="submit"
                className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
              >
                <GitBranch aria-hidden="true" className="h-4 w-4" strokeWidth={ICON_STROKE_WIDTH} />
                Connect
              </button>
            </form>
          )}
        </div>

        {connectState.error ? (
          <p role="alert" className="mt-3 text-sm font-medium text-red-800">
            {connectState.error}
          </p>
        ) : null}
        {revokeState.error ? (
          <p role="alert" className="mt-3 text-sm font-medium text-red-800">
            {revokeState.error}
          </p>
        ) : null}
        <FormSuccess when={revokeState.done === true}>Disconnected.</FormSuccess>
      </div>
    </div>
  );
}