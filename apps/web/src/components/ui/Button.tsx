import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
}

const base =
  'inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-xl px-6 text-base font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-12 sm:w-auto';

const variants: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700',
  secondary: 'border border-brand-600 text-brand-700 hover:bg-brand-50',
  danger: 'border border-red-700 text-red-800 hover:bg-red-50',
};

export function Button({ variant = 'primary', className = '', children, ...rest }: ButtonProps) {
  return (
    <button type="button" className={`${base} ${variants[variant]} ${className}`} {...rest}>
      {children}
    </button>
  );
}
