/**
 * Adapter that logs instead of sending.
 *
 * This is the default, and that is a safety decision rather than a placeholder.
 * An unconfigured deployment must never silently claim to have sent a
 * verification link, and it must not fail a proof submission either: the worker
 * still receives the link in the API response and can pass it on manually.
 *
 * The link is logged at `info` and the recipient's number is reduced to its last
 * four digits, so a development log does not become a store of client phone
 * numbers.
 */
import { renderVerificationMessage, type DispatchResult, type MessageProvider } from './types.js';

export class LogProvider implements MessageProvider {
  readonly name = 'log';

  constructor(private readonly log: (message: string) => void) {}

  isConfigured(): boolean {
    return true;
  }

  async sendVerificationLink(input: {
    to: string;
    workerName: string;
    skillTag: string;
    link: string;
    expiresAt: Date;
  }): Promise<DispatchResult> {
    this.log(
      [
        `[${this.name}] verification link not sent (no messaging provider configured)`,
        `  to: ...${input.to.slice(-4)}`,
        `  skill: ${input.skillTag}`,
        `  link: ${input.link}`,
        '',
        renderVerificationMessage(input),
      ].join('\n'),
    );

    return { sent: false, reason: 'No messaging provider is configured.' };
  }
}