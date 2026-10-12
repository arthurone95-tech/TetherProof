'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { submitProof } from '@/lib/actions';
import { EMPTY_PROOF, type ProofFormState, type ProofSubmissionView } from '@/lib/form-state';
import { locateMessage, useGeolocation } from '@/lib/use-geolocation';
import { prettyCoords } from '@/lib/gps';
import { SKILL_LEVELS } from '@/lib/capabilities';
import { Field } from '@/components/ui/Field';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { ShareLinkButton } from '@/components/proofs/ShareLinkButton';

type MediaKind = 'photo' | 'voice';

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
const VOICE_TYPES = ['audio/mpeg', 'audio/mp4', 'audio/aac'];

/**
 * Recording formats offered to the browser, in the order they are preferred.
 *
 * A recorder defaults to WebM, which storage deliberately refuses: keeping it
 * would mean running an external binary to strip the metadata every other format
 * has already been handled with. So the format is chosen from what the API keeps
 * rather than left to the browser, and a browser that can produce none of them is
 * given the file picker instead of a button that only ever fails.
 */
const RECORDING_FORMATS = [
  { mime: 'audio/mp4', extension: 'm4a' },
  { mime: 'audio/aac', extension: 'aac' },
  { mime: 'audio/mpeg', extension: 'mp3' },
];

/**
 * The worker's log form.
 *
 * Split into two so that "Log another" can start from a genuinely clean sheet.
 * The action's state cannot be cleared from outside `useActionState`, so the part
 * that holds it is remounted instead — which also resets the inputs, the chosen
 * file, and the recording, rather than leaving the last job's evidence sitting in
 * a form that is about to become somebody's next submission.
 */
export function LogWorkForm() {
  const [attempt, setAttempt] = useState(0);
  return <LogWorkFormBody key={attempt} onLogAnother={() => setAttempt((n) => n + 1)} />;
}

function LogWorkFormBody({ onLogAnother }: { onLogAnother: () => void }) {
  const [state, formAction] = useActionState(submitProof, EMPTY_PROOF as ProofFormState);

  const [kind, setKind] = useState<MediaKind>('photo');

  // Where the job happened. `gps` is the stored "latitude,longitude" value; the
  // rest is what the worker sees and how they typed it. The GPS button fills the
  // value in and a place name is looked up for it, so a person is handed an area
  // name with coordinates underneath instead of being asked to read a number
  // pair. Typing coordinates remains, but as a fallback, not the main event.
  const [gps, setGps] = useState('');
  const [placeName, setPlaceName] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [placeFailed, setPlaceFailed] = useState(false);
  const [typingCoords, setTypingCoords] = useState(false);
  const [draftLat, setDraftLat] = useState('');
  const [draftLng, setDraftLng] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  // The location section's own message. It is separate from `notice` (which is
  // the evidence section's voice), so the two blocks can never repeat each
  // other's errors under both fieldsets.
  const [coordsNotice, setCoordsNotice] = useState<string | null>(null);
  // Discards a naming answer that arrives after the location was replaced or
  // cleared, so a slow network cannot slap yesterday's name onto today's place.
  const nameRequestRef = useRef(0);

  // `undefined` means "not asked yet", which is what the server rendered too, so
  // the button for it appears after mount rather than disagreeing with the HTML.
  const [recordFormat, setRecordFormat] = useState<
    { mime: string; extension: string } | null | undefined
  >(undefined);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);

  const mediaRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  const { state: locateState, locate } = useGeolocation();

  useEffect(() => {
    if (typeof window === 'undefined' || !('MediaRecorder' in window)) {
      setRecordFormat(null);
      return;
    }
    setRecordFormat(
      RECORDING_FORMATS.find((format) => MediaRecorder.isTypeSupported(format.mime)) ?? null,
    );
  }, []);

  useEffect(() => {
    if (!recording) return undefined;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  // Let go of the microphone when the form leaves, so the recording indicator in
  // the browser's own chrome does not outlive the page that asked for it.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  // React empties a form once its action settles. Nothing here wants that. A
  // refusal means the worker is about to correct one line and try again, and
  // clearing the rest — the description they wrote and the photo they chose —
  // would make every rejection cost them the whole submission. The clean sheet
  // this form does need comes from "Log another" remounting it instead.
  //
  // Listened for on the form itself rather than through the component's `onReset`
  // prop: React calls `form.reset()` from within its own work, and on that path
  // the synthetic event never reaches the prop handler, so the prop looks like it
  // should stop the reset and does not. A native listener on the form runs before
  // the browser acts on the event, and the event is cancelable, so this is the
  // one place the reset can actually be stopped.
  useEffect(() => {
    const form = formRef.current;
    if (!form) return undefined;
    const keepContents = (event: Event) => event.preventDefault();
    form.addEventListener('reset', keepContents);
    return () => form.removeEventListener('reset', keepContents);
  }, []);

  if (state.done && state.result) {
    return <LoggedPanel result={state.result} onLogAnother={onLogAnother} />;
  }

  function adopt(file: File | null | undefined) {
    if (!file) return;
    if (typeof DataTransfer === 'undefined') {
      setNotice('This browser cannot attach that recording. Choose the file instead.');
      return;
    }
    const transfer = new DataTransfer();
    transfer.items.add(file);
    if (mediaRef.current) mediaRef.current.files = transfer.files;
    setNotice(null);
  }

  function switchKind(next: MediaKind) {
    if (next === kind) return;
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    setRecording(false);
    setSeconds(0);
    setKind(next);
    setNotice(null);
    // The two kinds accept different files, so what was chosen for one has no
    // business being submitted for the other.
    if (mediaRef.current) mediaRef.current.value = '';
  }

  async function startRecording(): Promise<void> {
    setNotice(null);
    if (!recordFormat || typeof MediaRecorder === 'undefined' || !navigator.mediaDevices) {
      setNotice('This browser cannot record here. Choose a recording you already have.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: recordFormat.mime });
      const format = recordFormat;

      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        recorderRef.current = null;
        streamRef.current = null;
        setRecording(false);
        setSeconds(0);
        adopt(new File([new Blob(chunksRef.current, { type: format.mime })], `voice-note.${format.extension}`, { type: format.mime }));
      };

      recorder.start();
      recorderRef.current = recorder;
      streamRef.current = stream;
      setSeconds(0);
      setRecording(true);
    } catch {
      setRecording(false);
      setNotice('Your microphone was not available. Allow access, or choose a recording instead.');
    }
  }

  function stopRecording(): void {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
  }

  /**
   * Shares the phone's GPS fix and names the place it returned.
   *
   * The coordinates are the record; the name is presentation. So a place that
   * cannot be named still gets its coordinates stored, and the sentence merely
   * says so instead of pretending the sensor failed.
   */
  async function shareLocation(): Promise<void> {
    const fix = await locate();
    if (!fix) return;

    const lat = fix.latitude.toFixed(6);
    const lon = fix.longitude.toFixed(6);
    setGps(`${lat},${lon}`);
    setPlaceName(null);
    setPlaceFailed(false);
    setTypingCoords(false);
    setCoordsNotice(null);
    await namePlace(lat, lon);
  }

  async function namePlace(lat: string, lon: string): Promise<void> {
    const request = ++nameRequestRef.current;
    setNaming(true);
    try {
      const name = await lookupName(lat, lon, 1);
      if (nameRequestRef.current !== request) return;
      setPlaceName(name);
      setPlaceFailed(name === null);
    } catch {
      if (nameRequestRef.current !== request) return;
      setPlaceName(null);
      setPlaceFailed(true);
    } finally {
      if (nameRequestRef.current === request) setNaming(false);
    }
  }

  /**
   * Naming a place is presentation — the coordinates are the record and are
   * already safe — so one transient failure is worth one retry before the area
   * is admitted unnamed. The retry happens here rather than in the API because
   * it is cheap at this layer: the naming call carries no session state, and
   * the API's own retry is what the server's outbound side needs.
   */
  async function lookupName(lat: string, lon: string, attempt: number): Promise<string | null> {
    try {
      const { placeName } = await apiFetch<{ placeName: string | null }>(
        `/locations/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`,
      );
      return placeName;
    } catch (error) {
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return lookupName(lat, lon, attempt + 1);
      }
      throw error;
    }
  }

  function openManualCoords(): void {
    const [lat = '', lon = ''] = gps.split(',');
    setDraftLat(lat);
    setDraftLng(lon);
    setTypingCoords(true);
    setCoordsNotice(null);
  }

  /**
   * Accepts a hand-typed pair, validating it with the same rule the submission
   * repeats before it reaches the API, so a bad pair is fixed where it was typed.
   */
  function saveManualCoords(): void {
    const lat = draftLat.trim();
    const lon = draftLng.trim();
    const candidate = `${lat},${lon}`;

    if (!/^-?\d{1,3}(\.\d+)?,-?\d{1,3}(\.\d+)?$/.test(candidate)) {
      setCoordsNotice('Enter coordinates as latitude, longitude — for example 5.6037,-0.1870.');
      return;
    }
    const latNum = Number(lat);
    const lonNum = Number(lon);
    if (Math.abs(latNum) > 90 || Math.abs(lonNum) > 180) {
      setCoordsNotice(
        'Those coordinates are out of range (latitude −90 to 90, longitude −180 to 180).',
      );
      return;
    }

    setGps(candidate);
    setPlaceName(null);
    setPlaceFailed(false);
    setTypingCoords(false);
    setCoordsNotice(null);
    void namePlace(lat, lon);
  }

  function clearLocation(): void {
    nameRequestRef.current += 1;
    setGps('');
    setPlaceName(null);
    setPlaceFailed(false);
    setTypingCoords(false);
    setDraftLat('');
    setDraftLng('');
    setCoordsNotice(null);
  }

  const evidenceError = state.field === 'media_file' ? state.error : undefined;

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-5">
      <Field
        name="skillTag"
        label="Skill this proves"
        required
        maxLength={160}
        placeholder="Solar Panel Installation"
        error={state.field === 'skillTag' ? state.error : undefined}
        hint="One skill per job. It joins the block you already have for it, or starts one."
      />

      <fieldset className="min-w-0 rounded-xl border border-brand-100 p-4">
        <legend className="px-1 text-sm font-medium text-ink-900">Skill level</legend>
        <p className="mb-3 text-sm text-ink-600">
          The tier this skill sits at on your record. Entry is the starting point — you can raise
          or lower the level on any log later.
        </p>
        <div className="flex flex-col gap-3">
          {SKILL_LEVELS.map((entry) => (
            <label key={entry.level} className="flex cursor-pointer items-start gap-3">
              <input
                type="radio"
                name="skillLevel"
                value={entry.level}
                defaultChecked={entry.level === 1}
                className="mt-1 h-4 w-4 border-brand-300 text-brand-600 focus:ring-brand-500"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink-900">{entry.label}</span>
                <span className="block text-sm text-ink-600">{entry.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="min-w-0 rounded-xl border border-brand-100 p-4">
        <legend className="px-1 text-sm font-medium text-ink-900">The evidence</legend>

        <div role="group" aria-label="Kind of evidence" className="flex gap-2">
          <Choice active={kind === 'photo'} onClick={() => switchKind('photo')}>
            Photo
          </Choice>
          <Choice active={kind === 'voice'} onClick={() => switchKind('voice')}>
            Voice note
          </Choice>
        </div>

        {kind === 'voice' && recordFormat && !recording ? (
          <div className="mt-4">
            <button
              type="button"
              onClick={startRecording}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-red-700 px-4 text-sm font-semibold text-red-800 transition-colors hover:bg-red-50"
            >
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-red-700" />
              Start recording
            </button>
          </div>
        ) : null}

        {recording ? (
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={stopRecording}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-red-700 px-4 text-sm font-semibold text-white transition-colors hover:bg-red-800"
            >
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-white" />
              Stop
            </button>
            <span className="text-sm font-semibold text-red-800 tabular-nums" aria-hidden="true">
              {formatClock(seconds)}
            </span>
            <span className="text-sm text-ink-600">Recording…</span>
          </div>
        ) : null}

        <div className="mt-4 flex flex-col gap-1.5">
          <label htmlFor="media_file" className="text-sm font-medium text-ink-900">
            {kind === 'photo' ? 'Photo of the work' : 'Recording'}
            <span aria-hidden="true"> *</span>
          </label>
          <input
            ref={mediaRef}
            id="media_file"
            name="media_file"
            type="file"
            accept={(kind === 'photo' ? PHOTO_TYPES : VOICE_TYPES).join(',')}
            onChange={(event) => {
              if (!event.target.files?.length) setNotice(null);
            }}
            aria-invalid={evidenceError ? true : undefined}
            aria-describedby={evidenceError ? 'media_file-error' : 'media_file-hint'}
            className="max-w-full rounded-xl border border-brand-100 bg-white p-2 text-sm text-ink-900 file:mr-4 file:cursor-pointer file:rounded-lg file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-brand-700 hover:file:bg-brand-100"
          />
          <p id="media_file-hint" className="text-sm text-ink-600">
            {kind === 'photo'
              ? 'JPG, PNG, WebP or HEIC. On a phone the picker offers your camera.'
              : 'MP3, M4A or AAC. Up to 25 MB.'}
          </p>
          {evidenceError ? (
            <p id="media_file-error" role="alert" className="text-sm font-medium text-red-800">
              {evidenceError}
            </p>
          ) : null}

        {kind === 'voice' ? (
          <p className="mt-3 text-sm text-ink-600">
            A text version of the recording is added to the log when transcription is available,
            so the words can be read at a glance. The recording itself is always what is kept and
            verified.
          </p>
        ) : null}
        </div>

        {notice ? (
          <p role="alert" className="mt-3 text-sm font-medium text-red-800">
            {notice}
          </p>
        ) : null}
      </fieldset>

      <Field
        name="description"
        label="What you did"
        multiline
        rows={4}
        required
        maxLength={2000}
        placeholder="Replaced two cracked panels on the north array and re-commissioned the string."
        error={state.field === 'description' ? state.error : undefined}
        hint="At least 10 characters. The person confirming it reads this, so say what was actually done."
      />

      <fieldset className="min-w-0 rounded-xl border border-brand-100 p-4">
        <legend className="px-1 text-sm font-medium text-ink-900">Where it happened</legend>
        <p className="mb-3 text-sm text-ink-600">
          Optional. Use your phone&apos;s GPS and the area is named for you.
        </p>

        {/*
          The stored value is carried invisibly: the API keeps latitude,longitude
          and nothing else, so the box has to exist for the form, not for the
          worker. When it is absent the submission reads the empty carrier as "I
          chose not to share where this happened".
        */}
        <input type="hidden" name="submissionGps" value={gps} />

        {!gps && !typingCoords ? (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={shareLocation}
              disabled={locateState === 'locating'}
              className="inline-flex min-h-11 items-center rounded-xl border border-brand-600 px-4 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {locateState === 'locating' ? 'Finding you…' : 'Use my location'}
            </button>
            <button
              type="button"
              onClick={openManualCoords}
              className="inline-flex min-h-11 items-center rounded-xl border border-brand-100 px-4 text-sm font-semibold text-ink-600 transition-colors hover:border-brand-600 hover:text-brand-700"
            >
              Type coordinates
            </button>
            <span className="text-sm text-ink-600">Not sharing is fine.</span>
          </div>
        ) : null}

        {gps ? (
          <div className="flex flex-col gap-3">
            <div className="rounded-xl border border-brand-100 bg-brand-50/60 px-4 py-3">
              <p className="text-base font-semibold text-ink-900">
                {naming
                  ? 'Naming this place…'
                  : placeName ?? 'These coordinates could not be named'}
              </p>
              <p className="mt-0.5 font-mono text-xs text-ink-600">{prettyCoords(gps)}</p>
              {placeFailed ? (
                <p className="mt-1 text-xs text-ink-600">
                  The area could not be named, but the coordinates were saved.
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={shareLocation}
                disabled={locateState === 'locating'}
                className="inline-flex min-h-11 items-center rounded-xl border border-brand-600 px-4 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {locateState === 'locating' ? 'Finding you…' : 'Update my location'}
              </button>
              {!typingCoords ? (
                <button
                  type="button"
                  onClick={openManualCoords}
                  className="inline-flex min-h-11 items-center rounded-xl border border-brand-100 px-4 text-sm font-semibold text-ink-600 transition-colors hover:border-brand-600 hover:text-brand-700"
                >
                  Type coordinates
                </button>
              ) : null}
              <button
                type="button"
                onClick={clearLocation}
                className="text-sm font-semibold text-ink-600 hover:text-ink-900"
              >
                Clear
              </button>
            </div>
          </div>
        ) : null}

        {typingCoords ? (
          <div className="mt-3 rounded-xl border border-brand-100 p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-900">
                Latitude
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={draftLat}
                  onChange={(event) => setDraftLat(event.target.value)}
                  placeholder="5.6037"
                  className="min-h-11 rounded-xl border border-brand-100 bg-white px-3 text-base text-ink-900 placeholder:text-ink-600/60"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-900">
                Longitude
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={draftLng}
                  onChange={(event) => setDraftLng(event.target.value)}
                  placeholder="-0.1870"
                  className="min-h-11 rounded-xl border border-brand-100 bg-white px-3 text-base text-ink-900 placeholder:text-ink-600/60"
                />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={saveManualCoords}
                className="inline-flex min-h-11 items-center rounded-xl border border-brand-600 px-4 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50"
              >
                Save location
              </button>
              <button
                type="button"
                onClick={() => setTypingCoords(false)}
                className="text-sm font-semibold text-ink-600 hover:text-ink-900"
              >
                Cancel
              </button>
            </div>
            <p className="mt-2 text-xs text-ink-600">
              Stored as latitude, longitude. The place name is looked up from these too.
            </p>
          </div>
        ) : null}

        {locateState !== 'locating' && locateMessage(locateState) ? (
          <p role="status" className="mt-2 text-sm text-ink-600">
            {locateMessage(locateState)}
          </p>
        ) : null}

        {coordsNotice ? (
          <p role="alert" className="mt-3 text-sm font-medium text-red-800">
            {coordsNotice}
          </p>
        ) : null}

        {state.field === 'submissionGps' ? (
          <p role="alert" className="mt-2 text-sm font-medium text-red-800">
            {state.error}
          </p>
        ) : null}
      </fieldset>

      {state.error && !state.field ? (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
          {state.error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Uploading…" className="sm:w-auto">
          Log this work
        </SubmitButton>
        <p className="text-sm text-ink-600">
          One job at a time. The file is stripped of its location before it is stored.
        </p>
      </div>
    </form>
  );
}

function Choice({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-11 rounded-xl border px-4 text-sm font-semibold transition-colors ${
        active
          ? 'border-brand-600 bg-brand-600 text-white'
          : 'border-brand-100 bg-white text-ink-600 hover:border-brand-600 hover:text-brand-700'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * What a submission produced, and the one link that lets somebody confirm it.
 *
 * The token is shown because the API returns it exactly once and keeps only its
 * digest: nothing can produce it a second time, so hiding it here would be
 * discarding the only copy rather than protecting it.
 *
 * Sharing is the worker's job now. The form no longer asks for the client's number,
 * so nothing is dispatched and nothing is claimed to have been sent — the link is
 * handed over and the worker decides who receives it, by whichever app they already
 * use. Both Copy and Share sit here because one of them is always available: the
 * share sheet needs a browser that has one and a device with apps installed, and
 * copying needs neither.
 */
function LoggedPanel({
  result,
  onLogAnother,
}: {
  result: ProofSubmissionView;
  onLogAnother: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(result.verificationUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // A refused clipboard is a browser decision, not a broken submission. The
      // link is on screen and selectable, so there is nothing to report beyond
      // leaving the button as it was.
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl bg-brand-50 p-5">
        <h3 className="text-lg font-semibold text-ink-900">Work logged</h3>
        <p className="mt-1 text-ink-600">
          <span className="font-medium text-ink-900">{result.skillTag}</span> is on your record,
          waiting for the person you worked with to confirm it.
        </p>
        <p className="mt-2 text-sm text-ink-600">{scrubSentence(result.scrubbed)}</p>
      </div>

      <div className="rounded-xl border border-brand-100 p-4">
        <p className="text-sm font-medium text-ink-900">
          Nobody has been sent anything — this link is yours to pass on.
        </p>
        <p className="mt-1 text-sm text-ink-600">
          Send it to the person who received the work or supervised it. They open it to read what
          you logged, look at the photo, and confirm or reject it. No account needed.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <code className="min-w-0 flex-1 break-all rounded-lg bg-ink-900/5 px-3 py-2 text-xs text-ink-900">
            {result.verificationUrl}
          </code>
          <div className="flex shrink-0 flex-wrap gap-2">
            <ShareLinkButton url={result.verificationUrl} />
            <button
              type="button"
              onClick={copy}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-brand-600 px-4 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50"
            >
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
        </div>
        <p role="status" aria-live="polite" className="mt-2 text-sm text-brand-700">
          {copied ? 'Link copied to your clipboard.' : ''}
        </p>
        <p className="mt-1 text-sm text-ink-600">
          They can answer once, and the link stops working on{' '}
          {new Date(result.verificationExpiresAt).toLocaleDateString()}. After that you can get a
          fresh one from your logs.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onLogAnother}
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-brand-600 px-4 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50"
        >
          Log another job
        </button>
        <Link
          href="/logs"
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-brand-100 px-4 text-sm font-semibold text-ink-600 transition-colors hover:border-brand-600 hover:text-brand-700"
        >
          View all logs
        </Link>
      </div>
    </div>
  );
}

/** What the scrubber took out, in the words a worker would use for it. */
function scrubSentence(scrubbed: ProofSubmissionView['scrubbed']): string {
  const removed: string[] = [];
  if (scrubbed.hadGps) removed.push('the location written into the file');
  if (scrubbed.hadMetadata) removed.push('the camera and date details');
  if (scrubbed.hadAudioTags) removed.push('the tags inside the recording');

  if (removed.length === 0) {
    return 'The file carried no location or device details to remove.';
  }
  return `We removed ${removed.join(', ')} before it was stored, so the only record of where this happened is what you wrote above.`;
}

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
