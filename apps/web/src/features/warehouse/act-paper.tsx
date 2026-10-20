'use client';

import { cn } from '@/lib/utils';
import { useEffect, useRef, useState } from 'react';
import { warehouseApi, type ActModel, type EmployeeOption } from './api';

// ═══════════════════════════════════════════════════════════
// Dalolatnoma qog'ozda — serverdagi mazmun (ActModel) bo'yicha, Word bilan bir xil.
// Hujjat oynasida «Dalolatnoma» yorlig'i shu ko'rinishni ko'rsatadi.
// ═══════════════════════════════════════════════════════════

export function ActPaper({ m, className }: { m: ActModel; className?: string }) {
  return (
    <div className={cn('mx-auto max-w-[640px] bg-white px-8 py-7 font-serif text-[13px] leading-snug text-black shadow-card ring-1 ring-black/5', className)}>
      <div className="ml-auto w-[48%]">
        {m.approve.map((line, i) => (
          <p key={i} className={cn(i === 0 && m.approveBold && 'font-bold')}>
            {line}
          </p>
        ))}
      </div>
      {m.title && <p className="mt-4 text-center font-bold">{m.title}</p>}
      {m.title2 && <p className="text-center font-bold">{m.title2}</p>}
      {m.cancelled && <p className="text-center font-bold text-red-700">(БЕКОР ҚИЛИНГАН)</p>}
      <p className="mt-2 flex justify-between gap-4">
        <span>{m.dateText}</span>
        <span>{m.city}</span>
      </p>
      <div className="mt-2 space-y-0.5 indent-8">
        {m.intro.map((t, i) => (
          <p key={i}>{t}</p>
        ))}
        {m.lead && <p className="pt-1">{m.lead}</p>}
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-[10px] leading-tight sm:text-[11.5px] sm:leading-snug">
          <thead>
            <tr>
              {m.columns.map((c, i) => (
                <th key={i} className="border border-black px-1 py-0.5 font-bold">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {m.rows.map((r, ri) => (
              <tr key={ri} className="text-center">
                {r.map((v, i) => (
                  <td key={i} className={cn('border border-black px-1 py-0.5', i === 1 && 'text-left')}>
                    {v}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="text-center font-bold">
              {m.total.map((v, i) => (
                <td key={i} className={cn('border border-black px-1 py-0.5', i === 1 && 'text-left')}>
                  {v}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="mt-2 space-y-0.5 text-justify indent-8">
        {m.closing.map((t, i) => (
          <p key={i}>{t}</p>
        ))}
        {m.liability && <p className="pt-1">{m.liability}</p>}
        {m.note && <p className="pt-1">{m.note}</p>}
      </div>
      <div className="mt-4 space-y-3">
        {m.signatures.map((s, i) =>
          s.name !== null ? (
            <p key={i} className="flex items-end justify-between gap-4">
              <b>{s.label}</b>
              <span className="flex items-end gap-1 whitespace-nowrap">
                {m.sign?.status === 'SIGNED' && m.sign.signature && m.sign.signerLine === i ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.sign.signature} alt="imzo" className="-mb-1 h-11 w-auto max-w-[9rem] object-contain" />
                ) : (
                  '__________'
                )}{' '}
                {s.name}
              </span>
            </p>
          ) : (
            <p key={i}>{s.label}</p>
          ),
        )}
      </div>
      {m.agreed.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="font-bold">{m.agreedHeading}</p>
          {m.agreed.map((a, i) => (
            <p key={i} className="flex justify-between gap-4">
              <span>{a.title}:</span>
              <span className="whitespace-nowrap">__________ {a.name}</span>
            </p>
          ))}
        </div>
      )}
      {m.sign && (
        <div className="mt-5 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={m.sign.qr} alt="QR" className="size-20 shrink-0" />
          <div className="min-w-0 font-sans">
            <p className={cn('text-[11px] font-semibold', m.sign.status === 'SIGNED' ? 'text-emerald-700' : 'text-gray-700')}>{m.sign.stamp}</p>
            <p className="break-all text-[9px] text-gray-400">{m.sign.url}</p>
          </div>
        </div>
      )}
      {m.footer && <p className="mt-5 text-[9px] text-gray-400">{m.footer}</p>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Xodim tanlash (Xodimlar bo'limidan) — shablondagi imzochilar uchun.
// Ism qo'lda yozilmaydi: tanlangan xodim dalolatnomada o'z ismi bilan chiqadi.
// ═══════════════════════════════════════════════════════════

export function EmployeePick({
  pinfl,
  name,
  onPick,
  onClear,
  disabled,
  placeholder = 'Xodimni tanlang — ism yoki JShShIR',
  compact,
}: {
  pinfl: string | null | undefined;
  name: string;
  onPick: (e: EmployeeOption) => void;
  onClear?: () => void;
  disabled?: boolean;
  placeholder?: string;
  compact?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<EmployeeOption[]>([]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      warehouseApi
        .employees(search)
        .then((r) => setFound(r.data))
        .catch(() => setFound([]));
    }, 220);
    return () => clearTimeout(timer);
  }, [search, open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const h = compact ? 'h-8 text-[13px]' : 'h-9 text-sm';
  if (pinfl && !open) {
    return (
      <div className={cn('flex items-center justify-between gap-2 rounded-(--radius-control) border border-brand-200 bg-brand-50 px-2.5', h)}>
        <span className="min-w-0 truncate" title={`JShShIR ${pinfl}`}>
          <span className="mr-1.5 inline-block size-1.5 rounded-full bg-emerald-500 align-middle" aria-hidden />
          <b className="font-semibold">{name}</b>
        </span>
        {!disabled && (
          <span className="flex shrink-0 gap-2 text-xs font-semibold">
            <button type="button" className="text-brand-700 hover:underline" onClick={() => setOpen(true)}>
              Almashtirish
            </button>
            {onClear && (
              <button type="button" className="text-(--color-text-muted) hover:text-red-600" onClick={onClear} aria-label="Olib tashlash">
                ×
              </button>
            )}
          </span>
        )}
      </div>
    );
  }
  return (
    <div ref={box} className="relative">
      <input
        value={search}
        disabled={disabled}
        autoFocus={open && !!pinfl}
        onChange={(e) => {
          setSearch(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={name && !pinfl ? `${name} (ro'yxatdan tanlanmagan)` : placeholder}
        className={cn('w-full rounded-(--radius-control) border bg-white px-2.5 focus:border-brand-600 disabled:bg-(--color-surface-muted)', h, name && !pinfl ? 'border-amber-300 placeholder:text-amber-700' : 'border-(--color-line-strong)')}
      />
      {open && (
        <div className="absolute z-30 mt-1 max-h-64 w-full min-w-[18rem] overflow-y-auto rounded-(--radius-control) border border-(--color-line) bg-white shadow-lg">
          {found.map((e) => (
            <button
              key={e.pinfl}
              type="button"
              onClick={() => {
                onPick(e);
                setSearch('');
                setOpen(false);
              }}
              className="block w-full px-3 py-2 text-left text-sm hover:bg-brand-50"
            >
              <span className="font-medium text-heading">{e.fullName}</span>
              <span className="ml-2 text-xs text-(--color-text-muted)">{[e.position, e.place].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
          {found.length === 0 && (
            <p className="px-3 py-2 text-xs text-(--color-text-muted)">
              {search.trim().length < 2 ? 'Ism yoki JShShIR yozing' : "Topilmadi — xodim Xodimlar bo'limida bo'lishi kerak"}
            </p>
          )}
          {pinfl && (
            <button type="button" onClick={() => setOpen(false)} className="block w-full border-t border-(--color-line) px-3 py-1.5 text-left text-xs text-(--color-text-muted) hover:bg-(--color-surface-muted)">
              Bekor qilish
            </button>
          )}
        </div>
      )}
    </div>
  );
}