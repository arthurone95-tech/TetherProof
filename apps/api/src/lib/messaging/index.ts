/**
 * Provider selection.
 *
 * Resolved once at startup so a deployment that intends to send messages but has
 * misconfigured them is caught by the health check rather than by the first
 * worker who submits a proof.
 */
import { logger } from '../../config/logger.js';
import { env } from '../../config/env.js';
import { LogProvider } from './log-provider.js';
import { TwilioProvider } from './twilio.js';
import type { DispatchResult, MessageProvider } from './types.js';

export { renderVerificationMessage } from './types.js';
export type { DispatchResult, MessageProvider } from './types.js';

let provider: MessageProvider | null = null;

function resolve(): MessageProvider {
  if (env.MESSAGING_PROVIDER === 'twilio') {
    const twilio = new TwilioProvider({
      accountSid: env.TWILIO_ACCOUNT_SID,
      authToken: env.TWILIO_AUTH_TOKEN,
      fromNumber: env.TWILIO_FROM_NUMBER,
    });

    // Refusing to start is the point. A deployment that asked for Twilio but did
    // not supply credentials would otherwise look healthy and quietly never send.
    if (!twilio.isConfigured()) {
      throw new Error(
        'MESSAGING_PROVIDER is "twilio" but TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER are not all set.',
      );
    }

    return twilio;
  }

  return new LogProvider((message) => logger.info(message));
}

export function getMessageProvider(): MessageProvider {
  provider ??= resolve();
  return provider;
}

/**
 * Sends a confirmation link, never throwing.
 *
 * A messaging failure must not fail the proof. The proof row is already written
 * and the link is already in the worker's response, so a provider outage
 * degrades the feature rather than losing the work. The outcome is recorded
 * either way, so a worker whose link never arrived is visible rather than
 * mysterious.
 */
export async function sendVerificationLink(input: {
  to: string;
  workerName: string;
  skillTag: string;
  link: string;
  expiresAt: Date;
}): Promise<DispatchResult> {
  try {
    const result = await getMessageProvider().sendVerificationLink(input);

    if (!result.sent) {
      logger.warn('Verification link was not sent', {
        reason: result.reason,
        provider: getMessageProvider().name,
      });
    }

    return result;
  } catch (error) {
    logger.error('Verification dispatch threw unexpectedly', {
      message: error instanceof Error ? error.message : String(error),
    });
    return { sent: false, reason: 'The messaging provider failed unexpectedly.' };
  }
}