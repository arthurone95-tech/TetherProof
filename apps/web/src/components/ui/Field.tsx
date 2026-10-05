import type { ReactNode } from 'react';

interface FieldProps {
  name: string;
  label: string;
  type?: 'text' | 'email' | 'password' | 'number';
  /** Present only when this field is the one the server rejected. */
  error?: string;
  hint?: ReactNode;
  defaultValue?: string | number;
  placeholder?: string;
  autoComplete?: string;
  inputMode?: 'text' | 'numeric' | 'decimal' | 'email' | 'tel';
  required?: boolean;
  min?: number;
  max?: number;
  maxLength?: number;
  step?: number | 'any';
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
  error,
  hint,
  defaultValue,
  placeholder,
  autoComplete,
  inputMode,
  required,
  min,
  max,
  maxLength,
  step,
}: FieldProps) {
  const errorId = `${name}-error`;
  const hintId = `${name}-hint`;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-sm font-medium text-ink-900">
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        min={min}
        max={max}
        maxLength={maxLength}
        step={step}
        defaultValue={defaultValue}
        placeholder={placeholder}
        autoComplete={autoComplete}
        inputMode={inputMode}
        aria-invalid={error ? true : undefined}
        aria-describedby={[error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined}
        className={`min-h-12 w-full rounded-xl border bg-white px-4 text-base text-ink-900 placeholder:text-ink-600/60 ${
          error ? 'border-red-700' : 'border-brand-100'
        }`}
      />
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