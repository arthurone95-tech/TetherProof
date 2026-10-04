/**
 * Twilio adapter.
 *
 * Uses `fetch` against Twilio's Messages REST endpoint rather than the official
 * SDK. The endpoint is a single authenticated POST with a form-encoded body, so
 * an SDK would add a dependency tree — and its own release cadence and audit
 * surface — for no capability this call needs. Keeping it to `fetch` means the
 * adapter is auditable in one screenful and the project gains no new runtime
 * dependency.
 *
 * Requires `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER`.
 */
import { renderVerificationMessage, type DispatchResult, type MessageProvider } from './types.js';

const ENDPOINT = 'https://api.twilio.com/2010-04-01/Accounts';

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  /** Overridable for testing. Defaults to Twilio's production host. */
  baseUrl?: string;
  timeoutMs?: number;
}

export class TwilioProvider implements MessageProvider {
  readonly name = 'twilio';

  constructor(private readonly config: TwilioConfig) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.accountSid &&
        this.config.authToken &&
        this.config.fromNumber,
    );
  }

  async sendVerificationLink(input: {
    to: string;
    workerName: string;
    skillTag: string;
    link: string;
    expiresAt: Date;
  }): Promise<DispatchResult> {
    if (!this.isConfigured()) {
      return { sent: false, reason: 'Twilio is not configured.' };
    }

    const url = `${this.config.baseUrl ?? ENDPOINT}/${this.config.accountSid}/Messages.json`;
    const body = new URLSearchParams({
      To: input.to,
      From: this.config.fromNumber,
      Body: renderVerificationMessage(input),
    });

    // Twilio requires HTTP Basic auth with the account SID as the username.
    const credentials = Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString(
      'base64',
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 10_000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        // The body can contain the recipient's number, so only the status is
        // kept. The full response goes to the server log, never to a response
        // body and never to the database.
        return { sent: false, reason: `Twilio returned HTTP ${response.status}.` };
      }

      const payload = (await response.json()) as { sid?: string };
      return { sent: true, providerMessageId: payload.sid };
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      return {
        sent: false,
        reason: aborted ? 'Twilio did not respond in time.' : 'Twilio could not be reached.',
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}