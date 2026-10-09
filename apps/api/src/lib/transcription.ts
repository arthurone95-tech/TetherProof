import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * Optional speech-to-text for voice proofs.
 *
 * A voice note is a proof on its own, and the transcript is a convenience bolted
 * on top: it feeds the structured form (the description and the skill page get
 * text from a recording), but the recording is always the record, and a
 * deployment without a provider key still works end to end. That is why this
 * function returns null — not throws — for every one of the three failure
 * modes; each is an ordinary outcome, not an error:
 *
 *   - no provider configured (the common case in development),
 *   - the provider refused or timed out,
 *   - the provider answered but with no usable text.
 *
 * Only the audio bytes leave this process, against the provider's transcription
 * endpoint. The words that come back are stored on the proof row and are as
 * worker-authored as the description; they are rendered as plain text everywhere.
 */
export async function transcribeAudio(
  buffer: Buffer,
  contentType: string,
): Promise<string | null> {
  if (!env.OPENAI_API_KEY) return null;

  try {
    const form = new FormData();
    // The file name is irrelevant to the wording, but the provider keys its
    // handling on the extension; `.webm` is the format the web client records.
    form.append('file', new Blob([buffer], { type: contentType }), 'voice.webm');
    form.append('model', 'whisper-1');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: form,
      // A voice note is uploaded with the proof, and the worker is waiting on
      // this response, so the call is bounded rather than allowed to hang.
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      logger.warn('Transcription provider refused the request', {
        status: response.status,
      });
      return null;
    }

    const data = (await response.json()) as { text?: string };
    const text = data.text?.trim();
    return text && text.length > 0 ? text : null;
  } catch (error) {
    logger.warn('Transcription could not be completed', {
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return null;
  }
}