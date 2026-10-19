'use client';

import { cn } from '@/lib/utils';
import { forwardRef, useId, type SelectHTMLAttributes } from 'react';
import { IconChevronDown } from './icons';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  label?: string;
  error?: string;
  hint?: string;
  options: SelectOption[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, error, hint, options, placeholder, className, id, required, ...props },
  ref,
) {
  const generatedId = useId();
  const selectId = id ?? generatedId;

  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={selectId}
          className="mb-1.5 block text-sm font-medium text-[--color-text]"
        >
          {label}
          {required && <span className="ml-0.5 text-[--color-expense]">*</span>}
        </label>
      )}

      <div className="relative">
        <select
          ref={ref}
          id={selectId}
          required={required}
          aria-invalid={error ? true : undefined}
          className={cn(
            'h-10 w-full appearance-none rounded-[--radius-control] border bg-white',
            'px-3 pr-9 text-sm',
            'transition-colors duration-150',
            'disabled:cursor-not-allowed disabled:bg-[--color-surface-sunken]',
            error
              ? 'border-[--color-expense] focus:border-[--color-expense]'
              : 'border-[--color-line-strong] focus:border-brand-600',
            className,
          )}
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>

        <IconChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-[--color-text-muted]" />
      </div>

      {error ? (
        <p className="mt-1 text-xs text-[--color-expense]">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-[--color-text-muted]">{hint}</p>
      ) : null}
    </div>
  );
});
