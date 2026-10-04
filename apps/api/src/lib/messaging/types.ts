/**
 * Outbound verification links.
 *
 * A proof is only worth anything if a client can confirm it, and the only
 * channel that reaches a supervisor on a job site is a message. So the link has
 * to be dispatchable, but the provider is not something the rest of the code
 * should know about: it is configured by environment, selected once at startup,
 * and reached only through `sendVerificationLink`.
 */

export interface DispatchResult {
  /** True when a provider accepted the message for delivery. */
  sent: boolean;
  /**
   * Why it did not send, safe to store. Never the provider's raw response,
   * which can echo the recipient's number.
   */
  reason?: string;
  /** Provider-specific message id, when there is one. Useful for support. */
  providerMessageId?: string;
}

export interface MessageProvider {
  readonly name: string;

  /**
   * True when the provider is configured well enough to send. Checked at startup
   * so a misconfigured deployment is visible immediately rather than at the
   * moment a worker submits their first proof.
   */
  isConfigured(): boolean;

  sendVerificationLink(input: {
    to: string;
    workerName: string;
    skillTag: string;
    link: string;
    expiresAt: Date;
  }): Promise<DispatchResult>;
}

/**
 * Renders the message body.
 *
 * The link is on its own line because most phones turn long URLs into tappable
 * links, and a link broken across two lines is often not recognised as one. The
 * expiry is stated in the message itself, so nobody is left wondering why a link
 * stopped working, and no expiry arithmetic happens on the handset.
 */
export function renderVerificationMessage(input: {
  workerName: string;
  skillTag: string;
  link: string;
  expiresAt: Date;
}): string {
  const days = Math.max(1, Math.round((input.expiresAt.getTime() - Date.now()) / 86_400_000));
  const who = input.workerName.trim() || 'A worker';

  return [
    `${who} logged "${input.skillTag}" as completed work.`,
    'Please confirm the work was done:',
    input.link,
    '',
    `This link can be used once and expires in ${days} day${days === 1 ? '' : 's'}.`,
    'If you did not expect this, you can ignore it. Nobody is charged for a proof.',
  ].join('\n');
}