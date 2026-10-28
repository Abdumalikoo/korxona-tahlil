'use client';

import { IconCalendar, IconCheck, IconChevronDown, IconChevronLeft, IconChevronRight } from '@/components/ui/icons';
import { formatDate, formatPeriod, shiftPeriod } from '@/lib/format';
import { OPEN_PERIOD_EVENT, PRESETS, currentMonth, isValidRange, periodMode, presetLabel, todayIso, usePeriod } from '@/lib/period';
import { cn } from '@/lib/utils';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

// ═══════════════════════════════════════════════════════════
// Yuqori paneldagi «Davr» tugmasi — hamma bo'limda bitta joyda.
// Bir marta tanlangan davr hamma sahifaga tegishli (lib/period.tsx).
// Ikki ko'rinishi bor (sahifaga qarab, lib/period.tsx → periodMode):
//   oraliq — «Bu oy · 01.10 — 05.10.2026 ▾»: tez tanlovlar va qo'lda «dan — gacha»;
//   oy     — «‹ Oktyabr 2026 ›»: oy bilan ishlaydigan sahifalar (Manba ro'yxatlari, yuklashlar),
//            tanlangan davrning oxirgi oyi ko'rsatiladi.
// Davr bilan ishlamaydigan sahifalarda (Sozlamalar va h.k.) ko'rinmaydi.
// ═══════════════════════════════════════════════════════════

export function PeriodControl() {
  const pathname = usePathname() ?? '/';
  const mode = periodMode(pathname);
  const { pageOwnsRange } = usePeriod();
  // Sahifada o'z «Dan — Gacha» kartasi bor — bitta tanlagich qolsin
  if (pageOwnsRange) return null;
  if (mode === 'month') return <MonthControl />;
  if (mode === 'range') return <RangeControl />;
  return null;
}

/** Ochiladigan oyna: tashqariga bosilsa yoki Esc — yopiladi */
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  // Boshqa joydan ochish (bo'sh holatdagi «Davrni o'zgartirish» tugmasi)
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_PERIOD_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_PERIOD_EVENT, onOpen);
  }, []);
  return { open, setOpen, ref };
}

function RangeControl() {
  const { range, preset, setRange, setPreset } = usePeriod();
  const { open, setOpen, ref } = usePopover();
  const [draft, setDraft] = useState(range);

  // Davr tashqaridan o'zgarsa — qoralama yangisidan (effektsiz: oldingi qiymat bilan solishtirib)
  const [seenRange, setSeenRange] = useState(range);
  if (seenRange !== range) {
    setSeenRange(range);
    setDraft(range);
  }

  const datesText = `${formatDate(range.from)} — ${formatDate(range.to)}`;
  // Tugmada qisqaroq: yil bir xil bo'lsa faqat oxirida — "01.09 — 30.09.2026"
  const shortText = range.from.slice(0, 4) === range.to.slice(0, 4) ? `${formatDate(range.from).slice(0, 5)} — ${formatDate(range.to)}` : datesText;
  const draftOk = Boolean(isValidRange(draft));

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`Davr: ${datesText} (hamma bo'lim uchun bitta)`}
        className={cn(
          'flex h-10 items-center gap-2 rounded-xl border bg-white px-3 text-sm transition-colors',
          open ? 'border-brand-400 ring-2 ring-brand-100' : 'border-(--color-line) hover:border-brand-300',
        )}
      >
        <IconCalendar className="size-4 text-brand-600" />
        <span className="font-semibold text-heading">{presetLabel(preset)}</span>
        <span className="money hidden whitespace-nowrap text-xs text-(--color-text-muted) lg:inline">{shortText}</span>
        <IconChevronDown className={cn('size-4 text-(--color-text-muted) transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div role="dialog" aria-label="Davrni tanlash" className="absolute right-0 top-12 z-50 w-80 overflow-hidden rounded-2xl border border-(--color-line) bg-white shadow-xl">
          <div className="border-b border-(--color-line) px-4 py-3">
            <p className="text-sm font-semibold text-heading">Davr</p>
            <p className="text-xs text-(--color-text-muted)">Hamma bo&apos;lim shu davr bo&apos;yicha ko&apos;rsatiladi</p>
          </div>

          {/* Tez tanlash */}
          <div className="p-2">
            {PRESETS.map((p) => {
              const r = p.range();
              const on = preset === p.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => {
                    setPreset(p.key);
                    setOpen(false);
                  }}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors',
                    on ? 'bg-brand-50' : 'hover:bg-(--color-surface-muted)',
                  )}
                >
                  <span className="flex size-4 shrink-0 items-center justify-center text-brand-600">{on && <IconCheck className="size-4" />}</span>
                  <span className="min-w-0 flex-1">
                    <span className={cn('block text-sm', on ? 'font-semibold text-brand-700' : 'text-heading')}>{p.label}</span>
                    <span className="block text-[11px] text-(--color-text-muted)">{p.hint}</span>
                  </span>
                  <span className="money whitespace-nowrap text-[11px] text-(--color-text-faint)">
                    {formatDate(r.from).slice(0, 5)}–{formatDate(r.to)}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Qo'lda tanlash */}
          <div className="border-t border-(--color-line) p-3">
            <p className="mb-2 text-xs font-semibold text-(--color-text-muted)">
              Qo&apos;lda tanlash{preset === 'custom' && <span className="ml-1 text-brand-700">· tanlangan</span>}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-[11px] text-(--color-text-muted)">Dan</span>
                <input
                  type="date"
                  value={draft.from}
                  max={draft.to || todayIso()}
                  onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
                  className="w-full rounded-lg border border-(--color-line-strong) px-2 py-1.5 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] text-(--color-text-muted)">Gacha</span>
                <input
                  type="date"
                  value={draft.to}
                  min={draft.from}
                  onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
                  className="w-full rounded-lg border border-(--color-line-strong) px-2 py-1.5 text-sm"
                />
              </label>
            </div>
            {!draftOk && draft.from && draft.to && <p className="mt-1.5 text-[11px] text-(--color-expense)">«Dan» sanasi «Gacha»dan keyin bo&apos;lmasligi kerak</p>}
            <button
              type="button"
              disabled={!draftOk}
              onClick={() => {
                setRange(draft);
                setOpen(false);
              }}
              className="mt-2.5 w-full rounded-lg bg-brand-700 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-800 disabled:bg-brand-300"
            >
              Qo&apos;llash
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Oy ko'rinishi: ‹ Oktyabr 2026 › — o'rtasini bossangiz, oylar jadvali ochiladi
// ═══════════════════════════════════════════════════════════

const MONTH_SHORT = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyn', 'Iyl', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek'];

function MonthControl() {
  const { month, range, setMonth } = usePeriod();
  const { open, setOpen, ref } = usePopover();
  const now = currentMonth();
  const [year, setYear] = useState(() => Number(month.slice(0, 4)));
  const [seenMonth, setSeenMonth] = useState(month);
  if (seenMonth !== month) {
    setSeenMonth(month);
    setYear(Number(month.slice(0, 4)));
  }

  const isLatest = month >= now;
  // Tanlangan davr bir oydan uzun bo'lsa — oxirgi oyi olinayotganini aytamiz
  const wider = range.from.slice(0, 7) !== month;
  const arrow = 'flex h-full w-8 items-center justify-center text-(--color-text-muted) transition-colors hover:bg-(--color-surface-muted) hover:text-heading disabled:cursor-not-allowed disabled:text-(--color-text-faint) disabled:hover:bg-transparent';

  return (
    <div ref={ref} className="relative shrink-0">
      <div className={cn('flex h-10 items-stretch overflow-hidden rounded-xl border bg-white text-sm', open ? 'border-brand-400 ring-2 ring-brand-100' : 'border-(--color-line)')}>
        <button type="button" onClick={() => setMonth(shiftPeriod(month, -1))} className={arrow} aria-label="Oldingi oy" title={`Oldingi oy: ${formatPeriod(shiftPeriod(month, -1))}`}>
          <IconChevronLeft className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="dialog"
          aria-expanded={open}
          title={wider ? `Davr: ${formatDate(range.from)} — ${formatDate(range.to)}. Bu sahifa oy bo'yicha — oxirgi oyi ko'rsatilmoqda` : "Oy (hamma bo'lim uchun bitta davr)"}
          className="flex items-center gap-2 border-x border-(--color-line) px-3 hover:bg-(--color-surface-muted)"
        >
          <IconCalendar className="size-4 text-brand-600" />
          <span className="whitespace-nowrap font-semibold text-heading">{formatPeriod(month)}</span>
          {month === now && <span className="hidden rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700 lg:inline">joriy</span>}
        </button>
        <button type="button" onClick={() => setMonth(shiftPeriod(month, 1))} disabled={isLatest} className={arrow} aria-label="Keyingi oy" title={isLatest ? "Kelajak oylari yo'q" : `Keyingi oy: ${formatPeriod(shiftPeriod(month, 1))}`}>
          <IconChevronRight className="size-4" />
        </button>
      </div>

      {open && (
        <div role="dialog" aria-label="Oyni tanlash" className="absolute right-0 top-12 z-50 w-72 overflow-hidden rounded-2xl border border-(--color-line) bg-white shadow-xl">
          <div className="border-b border-(--color-line) px-4 py-3">
            <p className="text-sm font-semibold text-heading">Oy</p>
            <p className="text-xs text-(--color-text-muted)">Bu sahifa oy bo&apos;yicha ishlaydi. Tanlangan oy boshqa bo&apos;limlarga ham o&apos;tadi</p>
          </div>
          <div className="flex items-center justify-between px-3 pt-3">
            <button type="button" onClick={() => setYear((y) => y - 1)} className="flex size-8 items-center justify-center rounded-lg text-(--color-text-muted) hover:bg-(--color-surface-muted)" aria-label="Oldingi yil">
              <IconChevronLeft className="size-4" />
            </button>
            <span className="money text-sm font-semibold text-heading">{year}</span>
            <button
              type="button"
              onClick={() => setYear((y) => y + 1)}
              disabled={year >= Number(now.slice(0, 4))}
              className="flex size-8 items-center justify-center rounded-lg text-(--color-text-muted) hover:bg-(--color-surface-muted) disabled:text-(--color-text-faint) disabled:hover:bg-transparent"
              aria-label="Keyingi yil"
            >
              <IconChevronRight className="size-4" />
            </button>
          </div>
          <div className="grid grid-cols-4 gap-1.5 p-3">
            {MONTH_SHORT.map((label, i) => {
              const value = `${year}-${String(i + 1).padStart(2, '0')}`;
              const on = value === month;
              const future = value > now;
              return (
                <button
                  key={value}
                  type="button"
                  disabled={future}
                  onClick={() => {
                    setMonth(value);
                    setOpen(false);
                  }}
                  className={cn(
                    'rounded-lg py-2 text-sm transition-colors',
                    on ? 'bg-brand-700 font-semibold text-white' : future ? 'cursor-not-allowed text-(--color-text-faint)' : 'text-heading hover:bg-brand-50',
                    value === now && !on && 'ring-1 ring-brand-300',
                  )}
                  title={formatPeriod(value)}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className="flex gap-2 border-t border-(--color-line) p-3">
            {[
              { label: 'Bu oy', value: now },
              { label: "O'tgan oy", value: shiftPeriod(now, -1) },
            ].map((q) => (
              <button
                key={q.label}
                type="button"
                onClick={() => {
                  setMonth(q.value);
                  setOpen(false);
                }}
                className={cn('flex-1 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors', month === q.value ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-(--color-line) text-heading hover:bg-(--color-surface-muted)')}
              >
                {q.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}