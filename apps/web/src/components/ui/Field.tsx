import type { ReactNode } from 'react';

interface FieldProps {
  name: string;
  label: string;
  type?: 'text' | 'email' | 'password' | 'number' | 'tel';
  /**
   * Renders a textarea instead of an input.
   *
   * Same label, same error wiring, same styling — a long answer should not have
   * to re-learn how a message gets attached to it. The field's own name and id
   * are used either way, so nothing downstream has to know which control it got.
   */
  multiline?: boolean;
  /** Height of a multiline field, in rows. Ignored for a single-line field. */
  rows?: number;
  /** Present only when this field is the one the server rejected. */
  error?: string;
  hint?: ReactNode;
  defaultValue?: string | number;
  /**
   * Controlled value, for a form that must survive its own submission.
   *
   * React resets an uncontrolled form once its action finishes, whether the
   * action succeeded or failed, so a person whose sign-in was refused came back
   * to two empty boxes. A controlled field is not reset, so what was typed
   * survives and only the one wrong letter has to be changed.
   *
   * Use this for anything a person would be annoyed to type twice, and leave
   * single-shot forms on `defaultValue`.
   */
  value?: string;
  placeholder?: string;
  autoComplete?: string;
  inputMode?: 'text' | 'numeric' | 'decimal' | 'email' | 'tel';
  required?: boolean;
  min?: number;
  max?: number;
  maxLength?: number;
  step?: number | 'any';
  /**
   * Notified with the field's text on every keystroke.
   *
   * Passing this alongside `value` makes the field controlled, which is how a
   * form keeps what was typed across a submission. Without a `value` the input
   * stays uncontrolled and this only reports, which is all a strength meter or
   * an address carried to the next screen needs.
   */
  onChange?: (value: string) => void;
  /**
   * Rendered inside the field's right edge.
   *
   * The input reserves padding for it so typed text cannot run underneath, and
   * the wrapper is positioned rather than the button being part of the input, so
   * the control keeps a full-height hit area.
   */
  inputSuffix?: ReactNode;
  /**
   * Id of a hint rendered outside the field instead of under it.
   *
   * For a hint that needs more room than the field's own column has: the
   * register form runs the password rules across both columns, where a sentence
   * squeezed under a half-width box reads as a footnote stuck to the left edge.
   * The paragraph outside carries this id, so the input still points at it and
   * the rules are still announced when the box takes focus.
   */
  linkedHintId?: string;
}

/**
 * A labelled input with its own error message.
 *
 * The message is linked with `aria-describedby` and the input marked
 * `aria-invalid`, so a screen reader announces the reason rather than leaving the
 * user to hunt for it. The error sits inside the label's group rather than at the
 * top of the form, which keeps a long form's mistakes next to the offending field.
 */
export function Field({
  name,
  label,
  type = 'text',
  multiline = false,
  rows = 4,
  error,
  hint,
  defaultValue,
  value,
  placeholder,
  autoComplete,
  inputMode,
  required,
  min,
  max,
  maxLength,
  step,
  onChange,
  inputSuffix,
  linkedHintId,
}: FieldProps) {
  const errorId = `${name}-error`;
  const hintId = `${name}-hint`;
  const describedBy =
    [error ? errorId : null, hint ? hintId : null, linkedHintId ?? null]
      .filter(Boolean)
      .join(' ') || undefined;
  const report = onChange ? (value: string) => onChange(value) : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-sm font-medium text-ink-900">
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      <div className="relative">
        {multiline ? (
          <textarea
            id={name}
            name={name}
            required={required}
            rows={rows}
            maxLength={maxLength}
            defaultValue={value === undefined ? defaultValue : undefined}
            value={value}
            placeholder={placeholder}
            onChange={report ? (event) => report(event.target.value) : undefined}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className={`w-full rounded-xl border bg-white px-4 py-3 text-base text-ink-900 placeholder:text-ink-600/60 ${
              error ? 'border-red-700' : 'border-brand-100'
            }`}
          />
        ) : (
          <>
            <input
              id={name}
              name={name}
              type={type}
              required={required}
              min={min}
              max={max}
              maxLength={maxLength}
              step={step}
              defaultValue={value === undefined ? defaultValue : undefined}
              value={value}
              placeholder={placeholder}
              autoComplete={autoComplete}
              inputMode={inputMode}
              onChange={report ? (event) => report(event.target.value) : undefined}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy}
              className={`min-h-12 w-full rounded-xl border bg-white text-base text-ink-900 placeholder:text-ink-600/60 ${
                inputSuffix ? 'pl-4 pr-14' : 'px-4'
              } ${error ? 'border-red-700' : 'border-brand-100'}`}
            />
            {inputSuffix ? (
              <div className="absolute inset-y-0 right-0 flex items-center">{inputSuffix}</div>
            ) : null}
          </>
        )}
      </div>
      {hint ? (
        <p id={hintId} className="text-sm text-ink-600">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-sm font-medium text-red-800">
          {error}
        </p>
      ) : null}
    </div>
  );
}