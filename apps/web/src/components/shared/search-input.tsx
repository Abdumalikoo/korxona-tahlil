'use client';

import { IconClose, IconSearch } from '@/components/ui/icons';
import { useEffect, useState } from 'react';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

/**
 * Qidiruv maydoni kechikish bilan.
 *
 * Foydalanuvchi yozayotganda har harfda so'rov yubormaslik uchun
 * 400 ms kutiladi. Bu serverdagi yukni sezilarli kamaytiradi.
 */
export function SearchInput({
  value,
  onChange,
  placeholder = 'Qidirish',
  className,
}: SearchInputProps) {
  const [local, setLocal] = useState(value);

  // Tashqaridan qiymat o'zgarsa (masalan filtr tozalanganda) sinxronlaymiz
  useEffect(() => {
    setLocal(value);
  }, [value]);

  useEffect(() => {
    if (local === value) return;

    const timer = setTimeout(() => onChange(local), 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local]);

  return (
    <div className={`relative ${className ?? ''}`}>
      <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[--color-text-faint]" />

      <input
        type="text"
        value={local}
        onChange={(event) => setLocal(event.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-[--radius-control] border border-[--color-line-strong] bg-white pl-9 pr-8 text-sm placeholder:text-[--color-text-faint] focus:border-brand-600"
      />

      {local && (
        <button
          type="button"
          onClick={() => {
            setLocal('');
            onChange('');
          }}
          className="absolute right-2 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-[--color-text-faint] transition-colors hover:text-[--color-text]"
          aria-label="Tozalash"
        >
          <IconClose className="size-3.5" />
        </button>
      )}
    </div>
  );
}
