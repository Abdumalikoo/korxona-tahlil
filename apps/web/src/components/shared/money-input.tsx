'use client';

import { formatSum, parseSum } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useEffect, useId, useState } from 'react';

interface MoneyInputProps {
  /** Qiymat so'mda; bo'sh bo'lsa null */
  value: number | null;
  onChange: (value: number | null) => void;
  label?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}

/**
 * Pul kiritish maydoni.
 *
 * Yozayotganda avtomatik formatlanadi: 1250000 → 1 250 000
 * Bu katta summalarda nol sonini adashtirmaslik uchun muhim.
 */
export function MoneyInput({
  value,
  onChange,
  label,
  error,
  hint,
  required,
  disabled,
  placeholder = '0',
  autoFocus,
}: MoneyInputProps) {
  const id = useId();
  const [text, setText] = useState(value === null ? '' : formatSum(value));

  // Tashqaridan qiymat o'zgarsa (forma tozalanganda) sinxronlaymiz
  useEffect(() => {
    const parsed = parseSum(text);
    const current = parsed === null ? null : parsed.toNumber();
    if (current !== value) {
      setText(value === null ? '' : formatSum(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function handleChange(raw: string) {
    // Faqat raqam, bo'shliq va kasr ajratuvchini qoldiramiz
    const cleaned = raw.replace(/[^\d\s,.\u00A0]/g, '');
    const parsed = parseSum(cleaned);

    if (parsed === null) {
      setText(cleaned);
      onChange(null);
      return;
    }

    // Kasr qismi yozilayotgan bo'lsa formatlamaymiz - kursor sakrab ketadi
    const typingDecimal = /[,.]\d{0,2}$/.test(cleaned);
    setText(typingDecimal ? cleaned : formatSum(parsed));
    onChange(parsed.toNumber());
  }

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-[--color-text]">
          {label}
          {required && <span className="ml-0.5 text-[--color-expense]">*</span>}
        </label>
      )}

      <div className="relative">
        <input
          id={id}
          type="text"
          inputMode="numeric"
          value={text}
          onChange={(event) => handleChange(event.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          autoComplete="off"
          className={cn(
            'money h-10 w-full rounded-[--radius-control] border bg-white px-3 pr-14 text-right text-sm',
            'placeholder:text-[--color-text-faint]',
            'transition-colors disabled:cursor-not-allowed disabled:bg-[--color-surface-sunken]',
            error
              ? 'border-[--color-expense] focus:border-[--color-expense]'
              : 'border-[--color-line-strong] focus:border-brand-600',
          )}
        />

        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[--color-text-muted]">
          so&apos;m
        </span>
      </div>

      {error ? (
        <p className="mt-1 text-xs text-[--color-expense]">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-[--color-text-muted]">{hint}</p>
      ) : null}
    </div>
  );
}
