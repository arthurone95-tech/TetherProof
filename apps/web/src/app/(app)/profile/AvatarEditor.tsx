'use client';

import { useActionState, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { removeAvatar, uploadAvatar } from '@/lib/actions';
import { EMPTY_FORM, type FormState } from '@/lib/form-state';
import { ProfileAvatar } from '@/components/shell/ProfileAvatar';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';

/** What the picker may offer; every type the API and its scrubber accept. */
const AVATAR_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

/**
 * The photo editor that opens when the avatar is tapped.
 *
 * The whole flow is one sheet, the way a phone's gallery editor feels: the photo
 * sits large in the middle, a pencil opens the device picker, a trash button
 * removes the photo, and Save and Cancel cap the sheet. There is no upload
 * button, no file chooser widget and no file-name field — the picker is a hidden
 * input behind the pencil, so the sheet never stops being about the photo.
 *
 * Picking a file only previews it locally; nothing leaves the device until Save.
 * Save runs one HTTP action: upload when a photo was picked, remove when the
 * trash was used, and no request at all when nothing changed. Once the action
 * reports done the sheet closes and the revalidated page shows the result.
 *
 * The action states live here rather than in `ProfileForm` on purpose: the sheet
 * only exists while `editorOpen` is true, so mounting it fresh each time gives
 * every session a clean slate — no stale "done" flag from an earlier photo
 * closing the sheet early.
 */
export function AvatarEditor({
  avatarUrl,
  onClose,
}: {
  avatarUrl: string | null;
  /** Called after Cancel, or after a successful upload or remove. */
  onClose: () => void;
}) {
  const [uploadState, uploadDispatch, uploadPending] = useActionState(uploadAvatar, EMPTY_FORM as FormState);
  const [removeState, removeDispatch, removePending] = useActionState(removeAvatar, EMPTY_FORM as FormState);

  const [picked, setPicked] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // A picked file is previewed locally, and the object URL is released with the
  // sheet so nothing outlives its use.
  useEffect(() => {
    if (!picked) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(picked);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [picked]);

  const saving = uploadPending || removePending;

  // A successful upload or remove closes the sheet; the revalidated profile
  // page behind it already shows the new state.
  const done = uploadState.done === true || removeState.done === true;
  useEffect(() => {
    if (done) onClose();
  }, [done, onClose]);

  const error = uploadState.error ?? removeState.error;

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Clear the input value so picking the same file again still fires.
    event.target.value = '';
    if (!file) return;
    setPicked(file);
    setRemoving(false);
  }

  function save() {
    if (saving) return;
    if (picked) {
      const formData = new FormData();
      formData.append('avatar_file', picked);
      uploadDispatch(formData);
      return;
    }
    if (removing && avatarUrl) {
      removeDispatch(new FormData());
      return;
    }
    onClose();
  }

  // What the sheet shows: the picked preview, the current photo unless trash
  // was tapped, or the person-icon placeholder when there is nothing left.
  const photo = picked ? previewUrl : removing ? null : avatarUrl;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Profile photo"
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-ink-900/40"
      />
      <div className="relative w-full max-w-md rounded-t-3xl bg-white px-6 pb-10 pt-4 shadow-xl sm:rounded-3xl">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="min-h-11 px-2 text-sm font-semibold text-ink-600 transition hover:text-ink-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <span className="text-sm font-semibold text-ink-900">Profile photo</span>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="min-h-11 px-2 text-sm font-semibold text-brand-700 transition hover:text-brand-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>

        <div className="mt-8 flex flex-col items-center gap-7">
          <ProfileAvatar avatarUrl={photo} size="lg" alt="Your profile photo" />

          <div className="flex items-center gap-14">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Choose a new photo"
              disabled={saving}
              className="flex flex-col items-center gap-1.5 text-ink-600 transition hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                <Pencil
                  aria-hidden="true"
                  className="h-5 w-5"
                  strokeWidth={ICON_STROKE_WIDTH}
                />
              </span>
              <span className="text-xs font-medium">Choose</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setPicked(null);
                setRemoving(true);
              }}
              disabled={saving || (!avatarUrl && !picked)}
              aria-label="Remove photo"
              className="flex flex-col items-center gap-1.5 text-ink-600 transition hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
                <Trash2
                  aria-hidden="true"
                  className="h-5 w-5"
                  strokeWidth={ICON_STROKE_WIDTH}
                />
              </span>
              <span className="text-xs font-medium">Remove</span>
            </button>
          </div>

          <p className="text-center text-xs text-ink-500">JPG, PNG, WebP or HEIC, under 5 MB.</p>
          {error ? (
            <p role="alert" className="text-sm font-medium text-red-800">
              {error}
            </p>
          ) : null}

          {/* The device picker itself. Hidden behind the pencil; the Accept list
              mirrors the API's allow-list so the sheet never offers a file the
              server would refuse. */}
          <input
            ref={fileInputRef}
            type="file"
            name="avatar_file"
            accept={AVATAR_MEDIA_TYPES.join(',')}
            className="hidden"
            onChange={onPick}
          />
        </div>
      </div>
    </div>
  );
}