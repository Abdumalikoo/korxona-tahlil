'use client';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime, todayInput } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { cashApi, dmy, downloadCashDay, importCashFile, shiftDate, weekday, type CashAccount, type CashDay, type CashImport, type CashLine } from './api';
import { CASH_COLUMNS, computeAll, thousandsToTiyin, tiyinToThousands, type CashColumn, type CashValues } from './calc';

// ═══════════════════════════════════════════════════════════
// Buxgalteriya › Kunlik tushum — «Kunlik tushum hamda qoldiq mablag'lar to'g'risida MA'LUMOT»
// shablonining ekrandagi ko'rinishi:
//   • ko'k katak — kiritiladi; kulrang ∑ — avtomatik jami; qulf — oldingi kundan avtomatik;
//   • o'ngda «Bugun bilan birga» (shablondagi J, K, L) — o'zi hisoblanadi;
//   • Enter / ↓ ↑ — shu ustunda keyingi/oldingi katakka; Ctrl+S — saqlash;
//   • Excel'dan to'ldirish: to'ldirilgan shablon yuklanadi, tekshirib «Saqlash».
// Hamma summa — ming so'mda (3 xonagacha kasr: 1 789,176).
// ═══════════════════════════════════════════════════════════

type Texts = Record<string, Record<CashColumn, string>>;

const MAIN_COLS: { col: CashColumn; label: string; short: string }[] = [
  { col: 'ytd', label: 'Yil boshidan', short: 'Yil boshidan' },
  { col: 'mtd', label: 'Oy boshidan', short: 'Oy boshidan' },
  { col: 'refund', label: "Qaytarilgan pul mablag'lari", short: 'Qaytarilgan' },
  { col: 'daily', label: 'Kunlik tushum', short: 'Kunlik tushum' },
  { col: 'balance', label: 'Holatiga qoldiq', short: 'Qoldiq' },
];

const SECTION_TONE: Record<string, string> = {
  I: 'bg-brand-600 text-white',
  II: 'bg-emerald-600 text-white',
  III: 'bg-amber-500 text-white',
  IV: 'bg-violet-600 text-white',
  V: 'bg-sky-600 text-white',
};

function toTexts(day: CashDay): Texts {
  const out: Texts = {};
  for (const a of day.accounts) {
    const v = day.values[a.id];
    const row = {} as Record<CashColumn, string>;
    for (const c of CASH_COLUMNS) row[c] = v && v[c] !== null ? tiyinToThousands(BigInt(v[c]!)) : '';
    out[a.id] = row;
  }
  return out;
}

/** Bo'lim sarlavhasi (I, II …) — shu qatorning eng yuqori ota-onasi */
function sectionOf(a: CashAccount, byId: Map<string, CashAccount>): CashAccount {
  let cur = a;
  for (let i = 0; i < 10 && cur.parentId && byId.has(cur.parentId); i++) cur = byId.get(cur.parentId)!;
  return cur;
}

function Money({ value, strong, muted, className }: { value: bigint | null; strong?: boolean; muted?: boolean; className?: string }) {
  return <span className={cn('money tabular-nums', strong && 'font-bold', muted && 'text-(--color-text-muted)', value !== null && value < 0n && 'text-(--color-expense)', className)}>{value === null ? '' : tiyinToThousands(value)}</span>;
}

export function CashDaySheet({ adminView = false }: { adminView?: boolean }) {
  const params = useSearchParams();
  const router = useRouter();
  const { isAdmin } = useAuth();
  const today = todayInput();
  const base = adminView ? '/dashbord/buxgalteriya/kun' : '/buxgalteriya/kunlik';
  const raw = params?.get('sana') ?? '';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) && raw <= today ? raw : today;

  const [tick, setTick] = useState(0);
  const day = useAsync(() => cashApi.day(date), [date, tick]);
  const d = day.data?.data ?? null;

  const [texts, setTexts] = useState<Texts>({});
  const [initial, setInitial] = useState<Texts>({});
  const [note, setNote] = useState('');
  const [noteInitial, setNoteInitial] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // «Bugun bilan» ustunlari — keng ekranda ochiq, kichigida yopiq (belgi bilan ochiladi)
  const [showAfter, setShowAfter] = useState(false);
  useEffect(() => {
    if (window.innerWidth >= 1680) setShowAfter(true);
  }, []);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone?: 'success' | 'error' } | null>(null);
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importInfo, setImportInfo] = useState<CashImport | null>(null);
  const [removing, setRemoving] = useState(false);
  const pendingImport = useRef<CashImport | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const loadedFor = useRef<string | null>(null);

  // Kun yuklanganda — kataklar to'ldiriladi (Excel'dan kutilayotgan bo'lsa — ustidan yoziladi)
  useEffect(() => {
    if (!d) return;
    const key = `${d.date}|${d.savedAt ?? ''}|${tick}`;
    if (loadedFor.current === key) return;
    loadedFor.current = key;
    const base = toTexts(d);
    setInitial(base);
    setNoteInitial(d.note ?? '');
    setNote(d.note ?? '');
    const imp = pendingImport.current;
    if (imp) {
      pendingImport.current = null;
      setTexts(applyImport(base, d, imp));
      setImportInfo(imp);
    } else {
      setTexts(base);
    }
  }, [d, tick]);

  const accounts = useMemo(() => d?.accounts ?? [], [d]);
  const byId = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  // Kiritilganlarni o'qish va hisoblash
  const { calc, invalid } = useMemo(() => {
    const input = new Map<string, Partial<CashValues>>();
    const bad = new Set<string>();
    for (const a of accounts) {
      const row = texts[a.id];
      if (!row) continue;
      const v: Partial<CashValues> = {};
      for (const c of CASH_COLUMNS) {
        if (!a.inputs.includes(c)) continue;
        const t = thousandsToTiyin(row[c]);
        if (t === undefined) bad.add(`${a.id}:${c}`);
        else if (t !== null && t < 0n && c !== 'balance') bad.add(`${a.id}:${c}`);
        v[c] = t ?? null;
      }
      input.set(a.id, v);
    }
    return { calc: computeAll(accounts, input), invalid: bad };
  }, [accounts, texts]);

  const changed = useMemo(() => {
    let n = 0;
    for (const a of accounts) for (const c of CASH_COLUMNS) if ((texts[a.id]?.[c] ?? '') !== (initial[a.id]?.[c] ?? '')) n++;
    return n + (note !== noteInitial ? 1 : 0);
  }, [accounts, texts, initial, note, noteInitial]);
  const dirty = changed > 0;

  // Sahifadan chiqishda ogohlantirish
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const go = useCallback(
    (target: string, force = false) => {
      const href = `${base}?sana=${target}`;
      if (dirty && !force) setLeaveTo(href);
      else router.push(href);
    },
    [base, dirty, router],
  );

  const auto = (a: CashAccount, c: CashColumn) => (c === 'ytd' || c === 'mtd') && d !== null && !d.opening;
  const editable = (a: CashAccount, c: CashColumn) => a.inputs.includes(c) && !auto(a, c);

  const setCell = (id: string, c: CashColumn, value: string) =>
    setTexts((prev) => ({ ...prev, [id]: { ...(prev[id] ?? ({} as Record<CashColumn, string>)), [c]: value } }));

  const save = useCallback(async () => {
    if (!d || saving) return;
    if (invalid.size > 0) {
      setToast({ message: "Qizil kataklarni tuzating: raqam noto'g'ri (masalan: 1 789,176)", tone: 'error' });
      return;
    }
    setSaving(true);
    try {
      const lines: CashLine[] = [];
      for (const a of accounts) {
        if (a.inputs.length === 0) continue;
        const line: CashLine = { accountId: a.id };
        for (const c of CASH_COLUMNS) {
          if (!a.inputs.includes(c)) continue;
          const t = thousandsToTiyin(texts[a.id]?.[c] ?? '');
          line[c] = t === null || t === undefined ? null : t.toString();
        }
        lines.push(line);
      }
      await cashApi.save(d.date, lines, note.trim() || null);
      setImportInfo(null);
      setToast({ message: `${dmy(d.date)} saqlandi` });
      setTick((t) => t + 1);
    } catch (error) {
      setToast({ message: errorMessage(error, "Saqlab bo'lmadi"), tone: 'error' });
    } finally {
      setSaving(false);
    }
  }, [accounts, d, invalid, note, saving, texts]);

  // Ish stolidan «Excel'dan to'ldirish» — fayl tanlash oynasi darhol ochiladi
  const askedImport = useRef(false);
  useEffect(() => {
    if (askedImport.current || params?.get('import') !== '1' || !d) return;
    askedImport.current = true;
    fileRef.current?.click();
  }, [d, params]);

  // Ctrl+S
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [save]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setImporting(true);
    try {
      const imp = await importCashFile(file);
      if (imp.date && imp.date !== date && imp.date <= today) {
        // Fayl sanasiga o'tamiz va o'sha kun yuklangach to'ldiramiz
        pendingImport.current = imp;
        router.push(`${base}?sana=${imp.date}`);
      } else if (d) {
        setTexts((prev) => applyImport(prev, d, imp));
        setImportInfo(imp);
      }
    } catch (error) {
      setToast({ message: errorMessage(error, "Faylni o'qib bo'lmadi"), tone: 'error' });
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const remove = async () => {
    if (!d) return;
    try {
      await cashApi.remove(d.date);
      setRemoving(false);
      setToast({ message: `${dmy(d.date)} o'chirildi` });
      setTick((t) => t + 1);
    } catch (error) {
      setRemoving(false);
      setToast({ message: errorMessage(error, "O'chirib bo'lmadi"), tone: 'error' });
    }
  };

  // Enter / ↓ ↑ — shu ustundagi keyingi katak
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!['Enter', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
    const col = e.currentTarget.dataset.col;
    const list = Array.from(document.querySelectorAll<HTMLInputElement>(`input[data-col="${col}"]`));
    const i = list.indexOf(e.currentTarget);
    const next = list[e.key === 'ArrowUp' ? i - 1 : i + 1];
    if (next) {
      e.preventDefault();
      next.focus();
      next.select();
    }
  };

  const hidden = (a: CashAccount) => {
    let p = a.parentId;
    for (let i = 0; i < 10 && p; i++) {
      if (collapsed.has(p)) return true;
      p = byId.get(p)?.parentId ?? null;
    }
    return false;
  };
  const hasKids = useMemo(() => new Set(accounts.map((a) => a.parentId).filter(Boolean) as string[]), [accounts]);
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (day.loading && !d) return <LoadingState />;
  if (day.error || !d) return <ErrorState message={day.error ?? "Ma'lumot yo'q"} onRetry={day.reload} />;

  const head = (key: string) => {
    const a = accounts.find((x) => x.key === key);
    return a ? calc.get(a.id) : undefined;
  };
  const I = head('I');
  const II = head('II');
  const filled = accounts.filter((a) => a.inputs.includes('daily') && (texts[a.id]?.daily ?? '') !== '').length;
  const dailyRows = accounts.filter((a) => a.inputs.includes('daily')).length;

  const kpis = [
    { label: 'Kunlik tushum — jami', value: I?.values.daily ?? null, hint: `${filled} / ${dailyRows} qator to'ldirilgan`, tone: 'from-brand-600 to-brand-800' },
    { label: "Hududiy bo'limlardan", value: II?.values.daily ?? null, hint: 'II bo‘lim, kunlik', tone: 'from-emerald-600 to-emerald-700' },
    { label: 'Oy boshidan (bugun bilan)', value: I?.after.mtd ?? null, hint: 'jami hisobraqamlar', tone: 'from-sky-600 to-sky-700' },
    { label: 'Yil boshidan (bugun bilan)', value: I?.after.ytd ?? null, hint: 'jami hisobraqamlar', tone: 'from-indigo-600 to-indigo-800' },
  ];

  const readOnlyAdmin = adminView && !isAdmin;
  const colCount = 3 + MAIN_COLS.length + (showAfter ? 3 : 0);

  return (
    <>
      <PageHeader
        title="Kunlik tushum va qoldiq"
        description={`Hisobraqamlar bo'yicha kunlik ma'lumotnoma · ming so'mda${adminView ? ' · buxgalter kiritgan, xatoni shu yerda tuzatasiz' : ''}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {!readOnlyAdmin && (
              <>
                <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
                <Button variant="secondary" loading={importing} onClick={() => fileRef.current?.click()} title="To'ldirilgan shablonni yuklang — kataklar to'ldiriladi, tekshirib saqlaysiz">
                  Excel&apos;dan to&apos;ldirish
                </Button>
              </>
            )}
            {d.exists && (
              <Button variant="secondary" onClick={() => void downloadCashDay(d.date).catch((e) => setToast({ message: errorMessage(e), tone: 'error' }))}>
                Excel yuklab olish
              </Button>
            )}
          </div>
        }
      />

      <div className="space-y-4 p-4 md:p-6">
        {/* ── Sana va holat ── */}
        <div className="flex flex-wrap items-center gap-3 rounded-(--radius-card) bg-white p-3 shadow-card">
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => go(shiftDate(date, -1))} className="flex size-10 items-center justify-center rounded-xl text-xl text-heading hover:bg-brand-50" title="Oldingi kun" aria-label="Oldingi kun">
              ‹
            </button>
            <label className="relative">
              <span className="sr-only">Sana</span>
              <input
                type="date"
                value={date}
                max={today}
                onChange={(e) => e.target.value && go(e.target.value)}
                className="h-10 rounded-xl border border-(--color-line-strong) bg-white px-3 text-[15px] font-semibold text-heading focus:border-brand-500 focus:outline-none"
              />
            </label>
            <button
              type="button"
              onClick={() => go(shiftDate(date, 1))}
              disabled={date >= today}
              className="flex size-10 items-center justify-center rounded-xl text-xl text-heading hover:bg-brand-50 disabled:opacity-30"
              title="Keyingi kun"
              aria-label="Keyingi kun"
            >
              ›
            </button>
          </div>
          <div className="min-w-0">
            <p className="text-lg font-bold leading-tight text-heading">
              {dmy(date)} <span className="text-sm font-medium text-(--color-text-muted)">· {weekday(date)}</span>
            </p>
            <p className="text-xs text-(--color-text-muted)">
              {d.exists ? (
                <>
                  <span className="font-semibold text-(--color-income)">● Saqlangan</span> · {d.savedAt ? formatDateTime(d.savedAt) : ''}
                  {d.savedBy ? ` · ${d.savedBy}` : ''}
                </>
              ) : (
                <span className="font-semibold text-amber-600">● Hali saqlanmagan — yangi kun</span>
              )}
            </p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {date !== today && (
              <Button size="sm" variant="ghost" onClick={() => go(today)}>
                Bugun
              </Button>
            )}
            {d.prevDate && (
              <Button size="sm" variant="ghost" onClick={() => go(d.prevDate!)} title="Oxirgi saqlangan oldingi kun">
                ← {dmy(d.prevDate)}
              </Button>
            )}
            {d.nextDate && (
              <Button size="sm" variant="ghost" onClick={() => go(d.nextDate!)} title="Keyingi saqlangan kun">
                {dmy(d.nextDate)} →
              </Button>
            )}
            <label className="flex cursor-pointer items-center gap-2 rounded-xl px-2 py-1 text-sm text-(--color-text-muted) hover:bg-brand-50">
              <input type="checkbox" checked={showAfter} onChange={(e) => setShowAfter(e.target.checked)} className="size-4 accent-brand-600" />
              «Bugun bilan» ustunlari
            </label>
          </div>
        </div>

        {/* ── Eslatmalar ── */}
        {d.opening && (
          <div className="rounded-(--radius-card) border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
            <b>Birinchi kun.</b> «Yil boshidan» va «Oy boshidan» ustunlarini shu kun uchun qo&apos;lda kiriting (yoki Excel&apos;dan to&apos;ldiring). Keyingi kunlarda ular o&apos;zi
            hisoblanadi: kechagi qiymat + kechagi kunlik tushum.
          </div>
        )}
        {!d.exists && !d.opening && d.prevDate && (
          <div className="rounded-(--radius-card) border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Yangi kun: «Yil boshidan», «Oy boshidan» va «Qoldiq» <b>{dmy(d.prevDate)}</b> kunidan o&apos;tkazildi. Kunlik tushum va qaytarilganlarni kiriting, qoldiqni bank
            ko&apos;chirmasi bilan solishtiring.
          </div>
        )}
        {importInfo && (
          <div className="flex flex-wrap items-center gap-2 rounded-(--radius-card) border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            <span>
              Fayldan <b>{importInfo.matched}</b> ta qator to&apos;ldirildi{importInfo.date ? ` (${dmy(importInfo.date)})` : ''}. Tekshirib, pastdagi <b>«Saqlash»</b>ni bosing.
              {!d.opening && " «Yil/Oy boshidan» fayldan olinmadi — ular oldingi kundan avtomatik."}
            </span>
            {importInfo.unmatched.length > 0 && <span className="text-amber-800">Topilmagan qatorlar: {importInfo.unmatched.join(', ')}</span>}
            <button type="button" className="ml-auto text-xs font-semibold underline" onClick={() => setImportInfo(null)}>
              Yopish
            </button>
          </div>
        )}

        {/* ── Asosiy raqamlar (yozish bilan birga yangilanadi) ── */}
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {kpis.map((k) => (
            <div key={k.label} className={cn('rounded-(--radius-card) bg-gradient-to-br p-4 text-white shadow-card', k.tone)}>
              <p className="text-xs font-semibold text-white/80">{k.label}</p>
              <p className="money mt-1 truncate text-[19px] font-bold leading-tight sm:text-[24px] xl:text-[28px]">{k.value === null ? '—' : tiyinToThousands(k.value)}</p>
              <p className="text-[11px] text-white/75">ming so&apos;m · {k.hint}</p>
            </div>
          ))}
        </div>

        {/* ── Jadval ── */}
        <div className="overflow-hidden rounded-(--radius-card) bg-white shadow-card">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-(--color-line) px-4 py-2.5 text-xs text-(--color-text-muted)">
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-3 rounded-sm border border-brand-300 bg-white" /> kiritiladi
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-3 rounded-sm bg-slate-100" /> ∑ jami — o&apos;zi hisoblanadi
            </span>
            {!d.opening && (
              <span className="flex items-center gap-1.5">
                <span aria-hidden>🔒</span> oldingi kundan avtomatik
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-3 rounded-sm bg-amber-100 ring-1 ring-amber-300" /> o&apos;zgartirildi
            </span>
            <span className="ml-auto hidden md:inline">Enter / ↓ — keyingi katak · Ctrl+S — saqlash · bo&apos;lim sarlavhasini bosing — yig&apos;iladi</span>
          </div>
          <div className="max-h-[calc(100vh-260px)] overflow-auto">
            <table className={cn('w-full table-fixed border-separate border-spacing-0 text-[13px]', showAfter ? 'min-w-[1500px]' : 'min-w-[1110px]')}>
              <colgroup>
                <col style={{ width: 52 }} />
                <col style={{ width: 340 }} />
                {MAIN_COLS.map((m) => (
                  <col key={m.col} style={{ width: m.col === 'daily' ? 150 : 144 }} />
                ))}
                {showAfter && (
                  <>
                    <col style={{ width: 150 }} />
                    <col style={{ width: 140 }} />
                    <col style={{ width: 150 }} />
                  </>
                )}
              </colgroup>
              <thead className="sticky top-0 z-20">
                <tr className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">
                  <th rowSpan={2} className="sticky left-0 z-10 border-b border-(--color-line) bg-slate-50 px-2 py-2 text-center">T/r</th>
                  <th rowSpan={2} className="sticky left-[52px] z-10 border-b border-r border-(--color-line) bg-slate-50 px-3 py-2 text-left">Hisobraqam nomi · hisob raqami</th>
                  {MAIN_COLS.map((m) => (
                    <th key={m.col} rowSpan={2} className={cn('border-b border-(--color-line) px-2 py-2 text-right leading-tight', m.col === 'daily' && 'bg-brand-50 text-brand-700')}>
                      {m.col === 'balance' ? `${dmy(date)} holatiga qoldiq` : m.label}
                    </th>
                  ))}
                  {showAfter && (
                    <th colSpan={3} className="border-b border-l border-(--color-line) bg-slate-100 px-2 py-1 text-center normal-case tracking-normal">
                      Bugun bilan birga
                    </th>
                  )}
                </tr>
                {showAfter && (
                  <tr className="bg-slate-100 text-[11px] font-semibold text-(--color-text-muted)">
                    <th className="border-b border-l border-(--color-line) px-2 py-1 text-right">Yil boshidan</th>
                    <th className="border-b border-(--color-line) px-2 py-1 text-right">Oy boshidan</th>
                    <th className="border-b border-(--color-line) px-2 py-1 text-right">Bugungi qoldiq</th>
                  </tr>
                )}
              </thead>
              <tbody>
                {accounts.map((a) => {
                  if (hidden(a)) return null;
                  const c = calc.get(a.id);
                  const section = sectionOf(a, byId);
                  const tone = SECTION_TONE[section.code ?? ''] ?? 'bg-slate-600 text-white';
                  if (a.isHeader) {
                    const open = !collapsed.has(a.id);
                    return (
                      <tr key={a.id} className="cursor-pointer select-none" onClick={() => toggle(a.id)} title={open ? 'Yig‘ish' : 'Ochish'}>
                        <td className={cn('sticky left-0 z-[5] px-2 py-2.5 text-center text-sm font-bold', tone)}>{a.code}</td>
                        <td className={cn('sticky left-[52px] z-[5] border-r border-white/20 px-3 py-2.5 text-sm font-bold', tone)}>
                          <span className="mr-2 inline-block w-3 text-white/80">{open ? '▾' : '▸'}</span>
                          {a.name}
                        </td>
                        {MAIN_COLS.map((m) => (
                          <td key={m.col} className={cn('px-2 py-2.5 text-right', tone)}>
                            {a.sums.includes(m.col) ? <Money value={c?.values[m.col] ?? null} strong className="text-white" /> : null}
                          </td>
                        ))}
                        {showAfter && (
                          <>
                            <td className={cn('px-2 py-2.5 text-right opacity-90', tone)}>{a.sums.includes('ytd') && <Money value={c?.after.ytd ?? null} strong className="text-white" />}</td>
                            <td className={cn('px-2 py-2.5 text-right opacity-90', tone)}>{a.sums.includes('mtd') && <Money value={c?.after.mtd ?? null} strong className="text-white" />}</td>
                            <td className={cn('px-2 py-2.5 text-right opacity-90', tone)}>{a.sums.includes('balance') && <Money value={c?.after.balance ?? null} strong className="text-white" />}</td>
                          </>
                        )}
                      </tr>
                    );
                  }
                  const parentRow = hasKids.has(a.id);
                  const isOpen = !collapsed.has(a.id);
                  const sub = a.level >= 2;
                  return (
                    <tr key={a.id} className={cn('group', parentRow ? 'bg-slate-50/70' : 'bg-white', !a.isActive && 'opacity-60')}>
                      <td className={cn('sticky left-0 z-[5] border-b border-(--color-line) px-2 py-1 text-center text-xs font-semibold text-(--color-text-muted) group-hover:bg-brand-50/60', parentRow ? 'bg-slate-50' : 'bg-white')}>{a.code}</td>
                      <td className={cn('sticky left-[52px] z-[5] border-b border-r border-(--color-line) px-3 py-1.5 group-hover:bg-brand-50/60', parentRow ? 'bg-slate-50' : 'bg-white')}>
                        <div className="flex items-start gap-2" style={{ paddingLeft: Math.max(0, a.level - 1) * 16 }}>
                          {parentRow ? (
                            <button type="button" onClick={() => toggle(a.id)} className="mt-0.5 w-3 shrink-0 text-xs text-(--color-text-muted) hover:text-brand-700" aria-label={isOpen ? 'Yig‘ish' : 'Ochish'}>
                              {isOpen ? '▾' : '▸'}
                            </button>
                          ) : (
                            sub && <span className="mt-0.5 w-3 shrink-0 text-xs text-slate-300">└</span>
                          )}
                          <div className="min-w-0">
                            <p className={cn('leading-snug text-heading', parentRow ? 'font-bold' : 'font-medium', sub && 'text-[12.5px]')}>{a.name}</p>
                            {a.number && <p className="font-mono text-[10.5px] text-(--color-text-faint)">{a.number}</p>}
                          </div>
                        </div>
                      </td>
                      {MAIN_COLS.map((m) => {
                        const col = m.col;
                        const err = invalid.has(`${a.id}:${col}`);
                        const was = (initial[a.id]?.[col] ?? '') !== (texts[a.id]?.[col] ?? '');
                        if (editable(a, col) && !readOnlyAdmin) {
                          return (
                            <td key={col} className={cn('border-b border-(--color-line) p-0.5', col === 'daily' && 'bg-brand-50/40')}>
                              <input
                                data-col={col}
                                inputMode="decimal"
                                value={texts[a.id]?.[col] ?? ''}
                                onChange={(e) => setCell(a.id, col, e.target.value)}
                                onFocus={(e) => e.currentTarget.select()}
                                onBlur={(e) => {
                                  const t = thousandsToTiyin(e.target.value);
                                  if (t !== undefined) setCell(a.id, col, t === null ? '' : tiyinToThousands(t));
                                }}
                                onKeyDown={onKey}
                                placeholder="—"
                                aria-label={`${a.name}: ${m.label}`}
                                title={err ? "Raqam noto'g'ri: masalan 1 789,176 (ming so'm, 3 xonagacha kasr)" : `${m.label} — ming so'm`}
                                className={cn(
                                  'money h-8 w-full rounded-md border bg-white px-2 text-right tabular-nums outline-none transition-colors placeholder:text-slate-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-200',
                                  err ? 'border-red-400 bg-red-50 text-red-700' : was ? 'border-amber-300 bg-amber-50' : 'border-brand-200 hover:border-brand-400',
                                  col === 'daily' && !err && !was && 'border-brand-300 font-semibold',
                                )}
                              />
                            </td>
                          );
                        }
                        if (a.inputs.includes(col)) {
                          // Avtomatik (oldingi kundan) yoki faqat ko'rish
                          const v = thousandsToTiyin(texts[a.id]?.[col] ?? '');
                          return (
                            <td key={col} className="border-b border-(--color-line) px-2 py-1 text-right text-(--color-text-muted)" title={auto(a, col) ? `Oldingi kundan avtomatik (${d.prevDate ? dmy(d.prevDate) : ''})` : undefined}>
                              {auto(a, col) && v !== null && v !== undefined && <span className="mr-1 text-[10px] opacity-60">🔒</span>}
                              <Money value={v ?? null} muted />
                            </td>
                          );
                        }
                        if (a.sums.includes(col)) {
                          return (
                            <td key={col} className="border-b border-(--color-line) bg-slate-100/80 px-2 py-1 text-right" title="Ichidagi qatorlar yig'indisi">
                              <Money value={c?.values[col] ?? null} strong />
                            </td>
                          );
                        }
                        return <td key={col} className="border-b border-(--color-line) bg-[repeating-linear-gradient(135deg,transparent,transparent_6px,#f1f5f9_6px,#f1f5f9_7px)]" />;
                      })}
                      {showAfter && (
                        <>
                          <td className="border-b border-l border-(--color-line) bg-slate-50 px-2 py-1 text-right">{(a.inputs.includes('ytd') || a.sums.includes('ytd')) && <Money value={c?.after.ytd ?? null} muted={!parentRow} strong={parentRow} />}</td>
                          <td className="border-b border-(--color-line) bg-slate-50 px-2 py-1 text-right">{(a.inputs.includes('mtd') || a.sums.includes('mtd')) && <Money value={c?.after.mtd ?? null} muted={!parentRow} strong={parentRow} />}</td>
                          <td className="border-b border-(--color-line) bg-slate-50 px-2 py-1 text-right" title={a.balanceRule === 'SUB' ? 'Qoldiq − kunlik' : a.balanceRule === 'KEEP' ? "Qoldiq o'zgarmaydi" : 'Qoldiq + kunlik'}>
                            {(a.inputs.includes('balance') || a.sums.includes('balance')) && <Money value={c?.after.balance ?? null} muted={!parentRow} strong={parentRow} />}
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
                {accounts.length === 0 && (
                  <tr>
                    <td colSpan={colCount} className="p-8 text-center text-(--color-text-muted)">
                      Hisobraqamlar yo&apos;q
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Izoh ── */}
        <div className="rounded-(--radius-card) bg-white p-4 shadow-card">
          <label className="text-sm font-semibold text-heading" htmlFor="cash-note">
            Izoh <span className="font-normal text-(--color-text-muted)">(ixtiyoriy — masalan, bank ko&apos;chirmasi kechikdi)</span>
          </label>
          <textarea
            id="cash-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={readOnlyAdmin}
            rows={2}
            maxLength={500}
            className="mt-2 w-full rounded-xl border border-(--color-line-strong) px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
          />
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-(--color-text-muted)">
            {!adminView && (
              <Link href="/buxgalteriya/hisobraqamlar" className="font-semibold text-brand-700 hover:underline">
                Hisobraqamlar ro&apos;yxatini o&apos;zgartirish →
              </Link>
            )}
            {isAdmin && d.exists && (
              <button type="button" onClick={() => setRemoving(true)} className="ml-auto font-semibold text-(--color-expense) hover:underline">
                Bu kunni o&apos;chirish
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Pastki panel: Saqlash ── */}
      {!readOnlyAdmin && (
        <div className="no-print sticky bottom-0 z-30 -mb-8 border-t border-(--color-line) bg-white/95 shadow-[0_-6px_16px_-10px_rgba(15,23,42,0.25)] backdrop-blur">
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-4 py-3 md:px-6">
            <div className="min-w-0 text-sm">
              {invalid.size > 0 ? (
                <span className="font-semibold text-(--color-expense)">{invalid.size} ta katakda xato — qizil kataklarni tuzating</span>
              ) : dirty ? (
                <span className="font-semibold text-amber-700">● {changed} ta o&apos;zgarish — saqlanmagan</span>
              ) : !d.exists ? (
                <span className="font-semibold text-amber-700">● Yangi kun — hali saqlanmagan</span>
              ) : (
                <span className="text-(--color-income)">✓ Hammasi saqlangan</span>
              )}
              <span className="ml-2 hidden text-(--color-text-muted) sm:inline">
                · Kunlik jami: <b className="money text-heading">{I?.values.daily != null ? tiyinToThousands(I.values.daily) : '—'}</b> ming so&apos;m
              </span>
            </div>
            <div className="ml-auto flex gap-2">
              {changed > 0 && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setTexts(initial);
                    setNote(noteInitial);
                    setImportInfo(null);
                  }}
                >
                  Bekor qilish
                </Button>
              )}
              <Button size="lg" onClick={() => void save()} loading={saving} disabled={invalid.size > 0} className="min-w-[180px]">
                {d.exists ? 'Saqlash' : 'Saqlash (yangi kun)'}
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={leaveTo !== null}
        title="Saqlanmagan o'zgarishlar bor"
        message="Boshqa kunga o'tsangiz, kiritilganlar yo'qoladi. Avval «Saqlash»ni bosing yoki o'zgarishlarni tashlab keting."
        confirmLabel="Saqlamasdan o'tish"
        cancelLabel="Qolish"
        danger
        onConfirm={() => {
          const href = leaveTo;
          setLeaveTo(null);
          if (href) router.push(href);
        }}
        onCancel={() => setLeaveTo(null)}
      />
      <ConfirmDialog
        open={removing}
        title={`${dmy(d.date)} kunini o'chirish`}
        message="Bu kunning hamma qiymatlari o'chadi. Keyingi kunlarning «Yil/Oy boshidan» qiymatlari qayta hisoblanadi."
        confirmLabel="O'chirish"
        danger
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(false)}
      />
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} duration={toast.tone === 'error' ? 6000 : 3000} />}
    </>
  );
}

/** Excel'dan o'qilgan qiymatlarni kataklarga yozish (faqat tahrirlanadigan ustunlar) */
function applyImport(base: Texts, day: CashDay, imp: CashImport): Texts {
  const out: Texts = { ...base };
  for (const a of day.accounts) {
    const v = imp.values[a.id];
    if (!v) continue;
    const row = { ...(out[a.id] ?? ({} as Record<CashColumn, string>)) };
    for (const c of CASH_COLUMNS) {
      if (!a.inputs.includes(c)) continue;
      if ((c === 'ytd' || c === 'mtd') && !day.opening) continue;
      row[c] = v[c] === null ? '' : tiyinToThousands(BigInt(v[c]!));
    }
    out[a.id] = row;
  }
  return out;
}