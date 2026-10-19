'use client';

import { cn } from '@/lib/utils';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { IconSpinner } from './icons';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  fullWidth?: boolean;
}

/** Asosiy — yorqin ko'k (chap menyu bilan bir xil), ikkinchi darajali — oq, chegarali */
const variants: Record<Variant, string> = {
  primary:
    'bg-brand-600 text-white shadow-sm shadow-brand-600/25 hover:bg-brand-700 active:bg-brand-800 disabled:bg-brand-300 disabled:shadow-none',
  secondary:
    'bg-white text-(--color-text) border border-(--color-line-strong) hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 active:bg-brand-100 disabled:text-(--color-text-faint) disabled:hover:border-(--color-line-strong) disabled:hover:bg-white',
  ghost:
    'bg-transparent text-(--color-text-muted) hover:bg-brand-50 hover:text-brand-700 disabled:text-(--color-text-faint)',
  danger:
    'bg-red-600 text-white shadow-sm shadow-red-600/25 hover:bg-red-700 active:bg-red-800 disabled:bg-red-300 disabled:shadow-none',
};

const sizes: Record<Size, string> = {
  sm: 'h-9 px-3.5 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-11 px-5 text-base gap-2',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    fullWidth = false,
    disabled,
    className,
    children,
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-(--radius-control) font-medium',
        'transition-colors duration-150',
        'disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        fullWidth && 'w-full',
        className,
      )}
      {...props}
    >
      {loading && <IconSpinner className="size-4 animate-spin" />}
      {children}
    </button>
  );
});