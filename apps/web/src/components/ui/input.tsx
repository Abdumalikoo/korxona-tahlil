'use client';

import { cn } from '@/lib/utils';
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  /** Maydon ichida o'ng tomonda ko'rsatiladigan element - masalan "so'm" */
  suffix?: ReactNode;
  /** Pul maydoni - monoshrift va o'ngga tekislash */
  money?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, suffix, money = false, className, id, required, ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={inputId}
          className="mb-1.5 block text-sm font-medium text-[--color-text]"
        >
          {label}
          {required && <span className="ml-0.5 text-[--color-expense]">*</span>}
        </label>

      )}

      <div className="relative">
        <input
          ref={ref}
          id={inputId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
          className={cn(
            'h-10 w-full rounded-[--radius-control] border bg-white px-3 text-sm',
            'placeholder:text-[--color-text-faint]',
            'transition-colors duration-150',
            'disabled:cursor-not-allowed disabled:bg-[--color-surface-sunken] disabled:text-[--color-text-muted]',
            money && 'money text-right',
            suffix && 'pr-14',
            error
              ? 'border-[--color-expense] focus:border-[--color-expense]'
              : 'border-[--color-line-strong] focus:border-brand-600',
            className,
          )}
          {...props}
        />

        {suffix && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[--color-text-muted]">
            {suffix}
          </span>
        )}
      </div>

      {error ? (

        <p id={`${inputId}-error`} className="mt-1 text-xs text-[--color-expense]">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="mt-1 text-xs text-[--color-text-muted]">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
