'use client';

import { SourceActions } from '@/components/shared/source-actions';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconAlert, IconPlus, IconSearch, IconSpinner } from '@/components/ui/icons';
import { ErrorState } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { MonthRangeCard, useMonthRange } from '@/features/units/month-range';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatTiyin, parseSum } from '@/lib/format';
import type { EntryUnit } from '@/lib/segments';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { Decimal } from 'decimal.js';
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import {
  downloadEntriesTemplate,
  EntrySaveError,
  exportEntries,
  parseEntriesFile,
  saveEntries,
  unitEntriesApi,
  type EntryBranch,
  type EntryInput,
  type EntryKindCode,
  type EntryRow,
} from './api';

// ═══════════════════════════════════════════════════════════
// Xarajatlar › <yo'nalish> › Asosiy vositalar / Reklama / Boshqa — qo'lda kiritish jadvali (Excel kabi).
//  • Katakka to'g'ridan-to'g'ri yoziladi; Enter — pastdagi katak. Oxirgi bo'sh qatorga yozilsa — yangi qator ochiladi.
//  • Excel'dan nusxa (Ctrl+C) → istalgan katakka qo'yish (Ctrl+V): qatorlar va ustunlar o'zi to'ladi.
//  • Shablon → to'ldirib yuklash: qatorlar jadvalga qoralama bo'lib tushadi, tekshirib «Saqlash».
//  • Saqlangan qatorni tahrirlash — o'sha katakni o'zgartirib «Saqlash». Belgilab — o'chirish (savatga).
//  • Asosiy vositalarda: Soni × Narxi = Summa (Summa bo'sh qoldirilsa — o'zi hisoblanadi).
// ═══════════════════════════════════════════════════════════

type Field = 'date' | 'name' | 'branch' | 'counterparty' | 'docNo' | 'qty' | 'price' | 'amount' | 'note';
type Values = Record<Field, string>;

interface GridRow {
  key: string;
  /** Saqlangan qator id (yangi qatorda — null) */
  id: string | null;
  values: Values;
  /** Saqlangan holati (tahrir solishtirish uchun) */
  base: Values | null;
}

type ToastState = { message: string; tone?: 'success' | 'error' } | null;

const KIND_TEXT: Record<EntryKindCode, { item: string; placeholder: string }> = {
  ASSET: { item: 'asosiy vosita', placeholder: 'Masalan: Noutbuk HP ProBook' },
  AD: { item: 'reklama xarajati', placeholder: 'Masalan: Instagram reklama (aprel)' },
  OTHER: { item: 'xarajat', placeholder: 'Masalan: Kantselyariya tovarlari' },
  TMZ: { item: 'TMZ', placeholder: "Masalan: O'g'it (ammiakli selitra), qop" },
};

const EMPTY: Values = { date: '', name: '', branch: '', counterparty: '', docNo: '', qty: '', price: '', amount: '', note: '' };
const isBlank = (v: Values) => (Object.keys(EMPTY) as Field[]).every((f) => !v[f].trim());
const same = (a: Values, b: Values) => (Object.keys(EMPTY) as Field[]).every((f) => a[f].trim() === b[f].trim());

let seq = 0;
const newKey = () => `n${Date.now().toString(36)}${(seq++).toString(36)}`;
const blankRow = (): GridRow => ({ key: newKey(), id: null, values: { ...EMPTY }, base: null });

/** Tiyin → katakdagi ko'rinish («1 250 000,50») */
function sumText(tiyin: string | null): string {
  if (!tiyin) return '';
  const d = new Decimal(tiyin).dividedBy(100);
  const [i = '0', f] = d.toFixed(2).split('.');
  return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}${f && f !== '00' ? `,${f}` : ''}`;
}

/** So'm matni → tiyin (bo'sh — null, xato — NaN) */
function toTiyin(text: string): string | null | typeof NaN {
  if (!text.trim()) return null;
  const d = parseSum(text);
  return d ? d.times(100).toDecimalPlaces(0).toFixed(0) : NaN;
}

function qtyOf(text: string): number | null {
  if (!text.trim()) return null;
  const n = Number(text.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

const fmtDate = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : iso);

/** Kiritilgan/qo'yilgan sana → YYYY-MM-DD («05.01.2026», «2026-01-05», Excel seriya raqami) */
function normDate(raw: string): string {
  const s = raw.trim();
  const a = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(s);
  if (a) {
    const y = a[3]!.length === 2 ? `20${a[3]}` : a[3]!;
    return `${y}-${a[2]!.padStart(2, '0')}-${a[1]!.padStart(2, '0')}`;
  }
  if (/^\d{5}$/.test(s)) {
    const n = Number(s);
    if (n > 20000 && n < 80000) return new Date(Math.round((n - 25569) * 86_400_000)).toISOString().slice(0, 10);
  }
  return s.slice(0, 10);
}

function validDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

const normText = (s: string) => s.toLowerCase().replace(/[«»"'`ʻʼ‘’“”]/g, '').replace(/\s+/g, ' ').trim();

/** Filial: kod, № yoki nomi bo'yicha; topilmasa — «!matn» (xato ko'rsatiladi) */
function normBranch(raw: string, branches: EntryBranch[]): string {
  const s = raw.trim();
  if (!s) return '';
  const byCode = branches.find((b) => b.code === s);
  if (byCode) return byCode.code;
  const n = Number(s);
  if (Number.isInteger(n)) {
    const b = branches.find((x) => x.no === n);
    if (b) return b.code;
  }
  const t = normText(s);
  const b = branches.find((x) => normText(x.name) === t) ?? branches.find((x) => normText(x.name).includes(t));
  return b ? b.code : `!${s}`;
}

function toValues(r: EntryRow): Values {
  return {
    date: r.date,
    name: r.name,
    branch: r.branch ?? '',
    counterparty: r.counterparty ?? '',
    docNo: r.docNo ?? '',
    qty: r.qty === null ? '' : String(r.qty),
    price: sumText(r.priceTiyin),
    amount: sumText(r.amountTiyin),
    note: r.note ?? '',
  };
}

/** Summa: yozilgani yoki Soni × Narxi */
function amountOf(v: Values, withQty: boolean): string | null {
  const a = toTiyin(v.amount);
  if (a !== null) return Number.isNaN(a as number) ? null : (a as string);
  if (!withQty) return null;
  const p = toTiyin(v.price);
  if (p === null || Number.isNaN(p as number)) return null;
  const q = qtyOf(v.qty);
  if (q !== null && Number.isNaN(q)) return null;
  return new Decimal(p as string).times(q ?? 1).toDecimalPlaces(0).toFixed(0);
}

function check(v: Values, withQty: boolean, today: string): Partial<Record<Field, string>> {
  const e: Partial<Record<Field, string>> = {};
  if (!validDate(v.date)) e.date = "Sana noto'g'ri";
  else if (v.date > today) e.date = 'Kelajak sanasi';
  if (v.name.trim().length < 2) e.name = 'Nomi yozilmagan';
  if (v.branch.startsWith('!')) e.branch = `Filial topilmadi: «${v.branch.slice(1)}»`;
  if (withQty) {
    const q = qtyOf(v.qty);
    if (q !== null && (Number.isNaN(q) || q <= 0)) e.qty = "Soni noto'g'ri";
    const p = toTiyin(v.price);
    if (p !== null && (Number.isNaN(p as number) || BigInt(p as string) < 0n)) e.price = "Narx noto'g'ri";
  }
  const a = toTiyin(v.amount);
  if (a !== null && Number.isNaN(a as number)) e.amount = "Summa noto'g'ri";
  else {
    const total = amountOf(v, withQty);
    if (!total || BigInt(total) <= 0n) e.amount = withQty ? 'Summa (yoki Soni va Narxi) kerak' : "Summa 0 dan katta bo'lsin";
  }
  return e;
}

function toInput(r: GridRow, withQty: boolean): EntryInput {
  const v = r.values;
  const price = withQty ? toTiyin(v.price) : null;
  const q = withQty ? qtyOf(v.qty) : null;
  return {
    ...(r.id ? { id: r.id } : {}),
    date: v.date.trim(),
    name: v.name.trim(),
    branch: v.branch.trim() || null,
    counterparty: v.counterparty.trim() || null,
    docNo: v.docNo.trim() || null,
    qty: q === null || Number.isNaN(q) ? null : q,
    priceTiyin: price === null || Number.isNaN(price as number) ? null : (price as string),
    amountTiyin: amountOf(v, withQty),
    note: v.note.trim() || null,
  };
}

function todayIso(): string {
  return new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
}

export function UnitEntriesView({ unit, kind }: { unit: EntryUnit; kind: EntryKindCode }) {
  const { isAdmin } = useAuth();
  const range = useMonthRange();
  const { from, to, error: rangeError, text: rangeText } = range;
  const list = useAsync(() => (rangeError ? Promise.resolve(null) : unitEntriesApi.list(unit.code, kind, from, to)), [unit.code, kind, from, to, rangeError]);
  const data = list.data?.data ?? null;
  const withQty = data?.qty ?? (kind === 'ASSET' || kind === 'TMZ');
  const branches = data?.branches ?? [];
  const text = KIND_TEXT[kind];

  const [drafts, setDrafts] = useState<GridRow[]>(() => [blankRow()]);
  const [edits, setEdits] = useState<Record<string, Values>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [serverErrors, setServerErrors] = useState<Record<string, string[]>>({});
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState<'template' | 'export' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const today = todayIso();

  // Tur yoki bo'lim almashsa — qoralamalar tozalanadi
  useEffect(() => {
    setDrafts([blankRow()]);
    setEdits({});
    setSelected(new Set());
    setServerErrors({});
    setShowErrors(false);
  }, [unit.code, kind]);

  const saved: GridRow[] = useMemo(
    () => (data?.rows ?? []).map((r) => {
      const base = toValues(r);
      return { key: r.id, id: r.id, base, values: edits[r.id] ?? base };
    }),
    [data, edits],
  );

  const q = normText(search);
  const branchName = (code: string) => branches.find((b) => b.code === code)?.name ?? '';
  const visibleSaved = q
    ? saved.filter((r) => normText([r.values.name, r.values.counterparty, r.values.docNo, r.values.note, branchName(r.values.branch), fmtDate(r.values.date)].join(' ')).includes(q))
    : saved;
  const rows = [...drafts, ...visibleSaved];

  const filledDrafts = drafts.filter((d) => !isBlank(d.values));
  const changed = saved.filter((r) => r.base && !same(r.values, r.base));
  const dirtyRows = [...filledDrafts, ...changed];
  const dirty = dirtyRows.length > 0;
  const errorsOf = (r: GridRow) => (r.id === null && isBlank(r.values) ? {} : check(r.values, withQty, today));
  const badRows = dirtyRows.filter((r) => Object.keys(errorsOf(r)).length > 0);
  const draftTotal = filledDrafts.reduce((s, r) => s + BigInt(amountOf(r.values, withQty) ?? '0'), 0n);

  // Saqlanmagan o'zgarish bilan sahifadan chiqishda ogohlantirish
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const fields: { f: Field; label: string; width: string; align?: 'right' }[] = [
    { f: 'date', label: 'Sana', width: 'w-[9.5rem]' },
    { f: 'name', label: 'Nomi', width: 'min-w-[14rem]' },
    ...(branches.length ? [{ f: 'branch' as Field, label: 'Filial', width: 'min-w-[12rem]' }] : []),
    { f: 'counterparty', label: 'Kontragent', width: 'min-w-[10rem]' },
    { f: 'docNo', label: 'Hujjat №', width: 'w-[7.5rem]' },
    ...(withQty
      ? [
          { f: 'qty' as Field, label: 'Soni', width: 'w-[5.5rem]', align: 'right' as const },
          { f: 'price' as Field, label: "Narxi, so'm", width: 'w-[9rem]', align: 'right' as const },
        ]
      : []),
    { f: 'amount', label: "Summa, so'm", width: 'w-[10rem]', align: 'right' },
    { f: 'note', label: 'Izoh', width: 'min-w-[10rem]' },
  ];

  /** Oxirgi qoralama bo'sh bo'lmasa — yangi bo'sh qator qo'shiladi */
  const withBlank = (list: GridRow[]) => (list.length && isBlank(list[list.length - 1]!.values) ? list : [...list, blankRow()]);

  function setValue(row: GridRow, f: Field, value: string) {
    if (row.id === null) {
      setDrafts((ds) => withBlank(ds.map((d) => (d.key === row.key ? { ...d, values: { ...d.values, [f]: value } } : d))));
    } else {
      const id = row.id;
      setEdits((es) => ({ ...es, [id]: { ...(es[id] ?? row.base ?? EMPTY), [f]: value } }));
    }
    if (serverErrors[row.key]) setServerErrors((s) => {
      const n = { ...s };
      delete n[row.key];
      return n;
    });
  }

  function normalize(f: Field, raw: string): string {
    if (f === 'date') return normDate(raw);
    if (f === 'branch') return normBranch(raw, branches);
    if (f === 'price' || f === 'amount') {
      const t = toTiyin(raw);
      return typeof t === 'string' ? sumText(t) : raw.trim();
    }
    return raw.replace(/\s+/g, ' ').trim();
  }

  function focusCell(r: number, c: number) {
    const el = tableRef.current?.querySelector<HTMLElement>(`[data-cell="${r}:${c}"]`);
    el?.focus();
    if (el instanceof HTMLInputElement && el.type === 'text') el.select();
  }

  function onKey(e: KeyboardEvent<HTMLElement>, r: number, c: number) {
    if (e.key === 'Enter') {
      e.preventDefault();
      focusCell(e.shiftKey ? Math.max(0, r - 1) : r + 1, c);
    } else if (e.key === 'ArrowDown' && (e.ctrlKey || e.altKey)) {
      e.preventDefault();
      focusCell(r + 1, c);
    } else if (e.key === 'ArrowUp' && (e.ctrlKey || e.altKey)) {
      e.preventDefault();
      focusCell(Math.max(0, r - 1), c);
    }
  }

  /** Excel'dan qo'yish: bir nechta katak bo'lsa — jadvalga yoyiladi (keyingi qatorlar — yangi qatorlar) */
  function onPaste(e: ClipboardEvent<HTMLElement>, row: GridRow, c: number) {
    const raw = e.clipboardData.getData('text/plain');
    if (!raw) return;
    const lines = raw.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map((l) => l.split('\t'));
    if (lines.length === 1 && lines[0]!.length === 1) {
      const f = fields[c]!.f;
      if (f === 'date' || f === 'branch') {
        e.preventDefault();
        setValue(row, f, normalize(f, lines[0]![0]!));
      }
      return;
    }
    e.preventDefault();
    const apply = (base: Values, cells: string[]): Values => {
      const v = { ...base };
      cells.forEach((cell, j) => {
        const col = fields[c + j];
        if (col) v[col.f] = normalize(col.f, cell);
      });
      return v;
    };
    let rest = lines;
    if (row.id !== null) {
      const id = row.id;
      setEdits((es) => ({ ...es, [id]: apply(es[id] ?? row.base ?? EMPTY, lines[0]!) }));
      rest = lines.slice(1);
    }
    setDrafts((ds) => {
      const out = [...ds];
      let at = row.id === null ? out.findIndex((d) => d.key === row.key) : -1;
      for (const cells of rest) {
        if (cells.every((x) => !x.trim())) continue;
        if (at >= 0 && at < out.length && (out[at]!.key === row.key || isBlank(out[at]!.values))) {
          out[at] = { ...out[at]!, values: apply(out[at]!.values, cells) };
          at += 1;
        } else {
          // keyingi qoralama band — yangi qator oxirgi bo'sh qator o'rniga
          const blankAt = out.length && isBlank(out[out.length - 1]!.values) ? out.length - 1 : out.length;
          out.splice(blankAt, 0, { ...blankRow(), values: apply({ ...EMPTY }, cells) });
          at = -1;
        }
      }
      return withBlank(out);
    });
    setToast({ message: `${lines.length} ta qator qo'yildi — tekshirib «Saqlash» bosing` });
  }

  function addRow() {
    setDrafts((ds) => withBlank(ds));
    setTimeout(() => {
      const idx = drafts.findIndex((d) => isBlank(d.values));
      focusCell(idx >= 0 ? idx : drafts.length, 0);
    }, 0);
  }

  function discard() {
    setDrafts([blankRow()]);
    setEdits({});
    setServerErrors({});
    setShowErrors(false);
  }

  async function handleSave() {
    if (!dirty) return;
    setShowErrors(true);
    if (badRows.length) {
      setToast({ message: `${badRows.length} ta qatorda xato bor — qizil kataklarni to'g'rilang`, tone: 'error' });
      return;
    }
    setSaving(true);
    try {
      const res = await saveEntries(unit.code, kind, dirtyRows.map((r) => toInput(r, withQty)));
      const months = [...new Set(res.rows.map((r) => r.date.slice(0, 7)))];
      range.include(months);
      setDrafts([blankRow()]);
      setEdits({});
      setServerErrors({});
      setShowErrors(false);
      list.reload();
      setToast({ message: [res.created ? `${res.created} ta qo'shildi` : '', res.updated ? `${res.updated} ta tahrirlandi` : ''].filter(Boolean).join(', ') + ' — Xarajatlarga yozildi' });
    } catch (err) {
      if (err instanceof EntrySaveError) {
        const map: Record<string, string[]> = {};
        for (const x of err.rows) {
          const r = dirtyRows[x.index];
          if (r) map[r.key] = x.errors;
        }
        setServerErrors(map);
      }
      setToast({ message: errorMessage(err, "Saqlab bo'lmadi"), tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function handleFile(file: File) {
    if (!/\.(xlsx|xltx)$/i.test(file.name)) {
      setToast({ message: 'Faqat Excel (.xlsx yoki .xltx) fayl yuklang', tone: 'error' });
      return;
    }
    setUploading(true);
    try {
      const res = await parseEntriesFile(unit.code, kind, file);
      const added: GridRow[] = res.rows.map((p) => ({
        ...blankRow(),
        values: {
          date: p.date,
          name: p.name,
          branch: p.branch ?? '',
          counterparty: p.counterparty ?? '',
          docNo: p.docNo ?? '',
          qty: p.qty === null ? '' : String(p.qty),
          price: sumText(p.priceTiyin),
          amount: sumText(p.amountTiyin),
          note: p.note ?? '',
        },
      }));
      const errs: Record<string, string[]> = {};
      res.rows.forEach((p, i) => {
        if (p.errors.length) errs[added[i]!.key] = p.errors.map((x) => `Fayl ${p.rowIndex}-qator: ${x}`);
      });
      setDrafts((ds) => withBlank([...ds.filter((d) => !isBlank(d.values)), ...added]));
      setServerErrors((s) => ({ ...s, ...errs }));
      const months = [...new Set(added.map((r) => r.values.date.slice(0, 7)).filter((m) => /^\d{4}-\d{2}$/.test(m)))];
      range.include(months);
      setToast({ message: `«${res.fileName}»: ${added.length} ta qator jadvalga qo'shildi — tekshirib «Saqlash» bosing` });
    } catch (err) {
      setToast({ message: errorMessage(err, "Faylni o'qib bo'lmadi"), tone: 'error' });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function runDownload(which: 'template' | 'export') {
    setBusy(which);
    try {
      if (which === 'template') await downloadEntriesTemplate(unit.code, kind);
      else await exportEntries(unit.code, kind, from, to);
    } catch (err) {
      setToast({ message: errorMessage(err, "Yuklab bo'lmadi"), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  const selectedSaved = saved.filter((r) => selected.has(r.key));
  const selectedDrafts = drafts.filter((r) => selected.has(r.key) && !isBlank(r.values));
  const selectedCount = selectedSaved.length + selectedDrafts.length;

  async function handleDelete() {
    if (selectedDrafts.length) setDrafts((ds) => withBlank(ds.filter((d) => !selected.has(d.key))));
    if (!selectedSaved.length) {
      setSelected(new Set());
      setConfirmDelete(false);
      return;
    }
    setDeleting(true);
    try {
      const ids = selectedSaved.map((r) => r.id!);
      const res = await unitEntriesApi.remove(unit.code, kind, ids);
      setEdits((es) => {
        const n = { ...es };
        ids.forEach((id) => delete n[id]);
        return n;
      });
      setSelected(new Set());
      list.reload();
      setToast({ message: `${res.data.count} ta yozuv o'chirildi — savatdan tiklash mumkin` });
    } catch (err) {
      setToast({ message: errorMessage(err, "O'chirib bo'lmadi"), tone: 'error' });
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  function toggle(key: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  const selectable = rows.filter((r) => !(r.id === null && isBlank(r.values)));
  const allChecked = selectable.length > 0 && selectable.every((r) => selected.has(r.key));
  const visibleTotal = visibleSaved.reduce((s, r) => s + BigInt(r.base ? (amountOf(r.base, withQty) ?? '0') : '0'), 0n);
  const months = data?.byMonth ?? [];
  const maxMonth = months.reduce((m, x) => (BigInt(x.totalTiyin) > m ? BigInt(x.totalTiyin) : m), 0n);

  const cellBase = 'h-9 w-full bg-transparent px-2 text-sm text-heading outline-none placeholder:text-(--color-text-faint) focus:bg-white focus:ring-2 focus:ring-brand-400 focus:ring-inset disabled:cursor-default';

  return (
    <div className="space-y-4">
      <MonthRangeCard range={range} />

      <SourceActions
        add={{ label: 'Yangi qator', onClick: addRow, hint: "Jadvalning yuqorisidagi bo'sh qatorga yozing" }}
        upload={{ label: "Excel'dan yuklash", onClick: () => fileRef.current?.click(), loading: uploading, hint: "To'ldirilgan shablon — qatorlar jadvalga qo'shiladi (hali saqlanmaydi)" }}
        template={{ label: 'Shablon', onClick: () => void runDownload('template'), loading: busy === 'template', hint: "Ustunlar va filiallar ro'yxati bilan" }}
        download={{ label: "Excel'ga yuklab olish", onClick: () => void runDownload('export'), loading: busy === 'export', disabled: !data?.rows.length, hint: rangeText }}
        remove={{ count: selectedCount, onClick: () => setConfirmDelete(true), label: "Belgilanganlarni o'chirish", hint: 'Chapdagi katakchalar bilan qatorlarni belgilang' }}
        note={
          <>
            Katakka to&apos;g&apos;ridan-to&apos;g&apos;ri yozing — <b>Enter</b> pastga o&apos;tadi. Excel&apos;dan nusxa olib (<b>Ctrl+C</b>) istalgan katakka qo&apos;ying (
            <b>Ctrl+V</b>) — qatorlar o&apos;zi to&apos;ladi.{withQty && <> Summa bo&apos;sh qolsa — <b>Soni × Narxi</b>.</>} Har qator — Xarajatlarda alohida yozuv ({unit.label} ·{' '}
            {data?.label ?? text.item}).
          </>
        }
      />
      <input ref={fileRef} type="file" accept=".xlsx,.xltx" className="hidden" onChange={(e) => e.target.files?.[0] && void handleFile(e.target.files[0])} />

      {/* Xulosa: jami va oylar */}
      {data && (
        <Card className="p-4">
          <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
            <div>
              <p className="text-xs font-medium text-(--color-text-muted)">Jami · {rangeText}</p>
              <p className="mt-0.5 text-2xl font-bold tabular-nums text-heading">{formatTiyin(data.totalTiyin, { currency: true })}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-(--color-text-muted)">Yozuvlar</p>
              <p className="mt-0.5 text-2xl font-bold tabular-nums text-heading">{data.rows.length}</p>
            </div>
            {dirty && (
              <div className="rounded-(--radius-control) bg-(--color-warn-soft) px-3 py-1.5 text-sm text-(--color-warn)">
                Saqlanmagan: <b>{dirtyRows.length}</b> qator{filledDrafts.length ? ` · yangi ${formatTiyin(draftTotal.toString(), { currency: true })}` : ''}
              </div>
            )}
          </div>
          {months.length > 1 && (
            <div className="mt-4 flex gap-1.5 overflow-x-auto pb-1">
              {months.map((m) => {
                const t = BigInt(m.totalTiyin);
                const h = maxMonth > 0n ? Math.max(4, Number((t * 100n) / maxMonth)) : 4;
                return (
                  <div key={m.period} className="flex min-w-[4.5rem] flex-1 flex-col items-center gap-1" title={`${m.label}: ${m.count} ta · ${formatTiyin(m.totalTiyin, { currency: true })}`}>
                    <div className="flex h-12 w-full items-end rounded bg-(--color-surface-sunken)">
                      <div className={cn('w-full rounded', t > 0n ? 'bg-brand-500' : 'bg-transparent')} style={{ height: `${t > 0n ? h : 0}%` }} />
                    </div>
                    <p className="text-[11px] font-medium text-(--color-text-muted)">{m.label.split(' ')[0]?.slice(0, 3)} {m.period.slice(2, 4)}</p>
                    <p className="text-[11px] tabular-nums text-heading">{t > 0n ? formatTiyin(m.totalTiyin) : '—'}</p>
                  </div>
                );
              })}
            </div>
          )}
          {data.deletedElsewhere > 0 && (
            <p className="mt-3 text-xs text-(--color-text-muted)">
              {data.deletedElsewhere} ta yozuv Xarajatlar bo&apos;limida o&apos;chirilgan (savatda) — bu yerda ko&apos;rinmaydi; savatdan tiklansa qaytadi.
            </p>
          )}
        </Card>
      )}

      {list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b border-(--color-line) px-4 py-3">
            <p className="text-sm font-semibold text-heading">{data?.label ?? 'Jadval'}</p>
            {list.loading && <IconSpinner className="size-4 text-brand-600" />}
            <label className="relative ml-auto block w-full max-w-xs">
              <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-(--color-text-faint)" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={branches.length ? 'Qidirish: nomi, kontragent, filial…' : 'Qidirish: nomi, kontragent, izoh…'}
                className="h-9 w-full rounded-(--radius-control) border border-(--color-line-strong) bg-white pl-8 pr-2 text-sm"
              />
            </label>
          </div>
          <div className="overflow-x-auto">
            <table ref={tableRef} className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-(--color-surface-sunken) text-left text-xs font-semibold text-(--color-text-muted)">
                  <th className="w-10 border-b border-(--color-line) px-2 py-2">
                    <input
                      type="checkbox"
                      aria-label="Hammasini belgilash"
                      checked={allChecked}
                      disabled={!isAdmin || !selectable.length}
                      onChange={() => setSelected(allChecked ? new Set() : new Set(selectable.map((r) => r.key)))}
                    />
                  </th>
                  <th className="w-10 border-b border-(--color-line) px-1 py-2 text-center">№</th>
                  {fields.map((c) => (
                    <th key={c.f} className={cn('border-b border-l border-(--color-line) px-2 py-2 whitespace-nowrap', c.width, c.align === 'right' && 'text-right')}>
                      {c.label}
                      {(c.f === 'date' || c.f === 'name' || c.f === 'amount') && <span className="text-(--color-expense)"> *</span>}
                    </th>
                  ))}
                  <th className="w-8 border-b border-(--color-line)" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, r) => {
                  const isDraft = row.id === null;
                  const blank = isDraft && isBlank(row.values);
                  const edited = !isDraft && row.base !== null && !same(row.values, row.base);
                  const errs = showErrors || edited || (isDraft && !blank) ? errorsOf(row) : {};
                  // Saqlashdan oldin — faqat yozilgan (noto'g'ri) kataklar; «Saqlash» bosilgach yoki tahrirda — hammasi
                  const visibleErrs: Partial<Record<Field, string>> = showErrors || edited ? errs : Object.fromEntries(Object.entries(errs).filter(([f]) => row.values[f as Field].trim() !== ''));
                  const srv = serverErrors[row.key];
                  const hasErr = Object.keys(visibleErrs).length > 0 || Boolean(srv?.length);
                  const auto = withQty && !row.values.amount.trim() ? amountOf(row.values, true) : null;
                  const firstSaved = r === drafts.length && visibleSaved.length > 0;
                  return (
                    <tr
                      key={row.key}
                      className={cn(
                        'group border-b border-(--color-line) transition-colors',
                        firstSaved && 'border-t-2 border-t-(--color-line-strong)',
                        blank ? 'bg-white' : isDraft ? 'bg-emerald-50/60' : edited ? 'bg-amber-50/70' : 'bg-white hover:bg-brand-50/40',
                        selected.has(row.key) && 'bg-brand-50',
                      )}
                    >
                      <td className="px-2 text-center">
                        {!blank && <input type="checkbox" aria-label="Belgilash" checked={selected.has(row.key)} disabled={!isAdmin} onChange={() => toggle(row.key)} />}
                      </td>
                      <td className="px-1 text-center text-xs tabular-nums text-(--color-text-faint)">
                        {blank ? <IconPlus className="mx-auto size-3.5 text-(--color-text-faint)" /> : isDraft ? <span className="font-semibold text-emerald-700">yangi</span> : r - drafts.length + 1}
                      </td>
                      {fields.map((c, ci) => {
                        const err = visibleErrs[c.f];
                        const common = {
                          'data-cell': `${r}:${ci}`,
                          disabled: !isAdmin,
                          title: err,
                          onKeyDown: (e: KeyboardEvent<HTMLElement>) => onKey(e, r, ci),
                          onPaste: (e: ClipboardEvent<HTMLElement>) => onPaste(e, row, ci),
                          className: cn(cellBase, c.align === 'right' && 'text-right tabular-nums', err && 'bg-red-50 ring-1 ring-red-300 ring-inset'),
                        };
                        return (
                          <td key={c.f} className={cn('border-l border-(--color-line) p-0', c.width)}>
                            {c.f === 'date' ? (
                              <input type="date" max={today} value={validDate(row.values.date) ? row.values.date : ''} onChange={(e) => setValue(row, 'date', e.target.value)} {...common} />
                            ) : c.f === 'branch' ? (
                              <select value={row.values.branch.startsWith('!') ? '' : row.values.branch} onChange={(e) => setValue(row, 'branch', e.target.value)} {...common} className={cn(common.className, 'pr-6', !row.values.branch && 'text-(--color-text-faint)')}>
                                <option value="">{row.values.branch.startsWith('!') ? `⚠ ${row.values.branch.slice(1)}` : '— tanlang —'}</option>
                                {branches.map((b) => (
                                  <option key={b.code} value={b.code}>
                                    {b.no}. {b.name}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <input
                                type="text"
                                inputMode={c.f === 'qty' || c.f === 'price' || c.f === 'amount' ? 'decimal' : undefined}
                                value={row.values[c.f]}
                                placeholder={c.f === 'name' && blank && r === 0 ? text.placeholder : c.f === 'amount' && auto ? sumText(auto) : undefined}
                                onChange={(e) => setValue(row, c.f, e.target.value)}
                                onBlur={(e) => {
                                  if ((c.f === 'price' || c.f === 'amount') && e.target.value.trim()) {
                                    const t = toTiyin(e.target.value);
                                    if (typeof t === 'string') setValue(row, c.f, sumText(t));
                                  }
                                }}
                                {...common}
                              />
                            )}
                          </td>
                        );
                      })}
                      <td className="px-1 text-center">
                        {hasErr && (
                          <span title={[...Object.values(visibleErrs), ...(srv ?? [])].join('\n')} className="inline-flex text-(--color-expense)">
                            <IconAlert className="size-4" />
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!list.loading && data && !visibleSaved.length && (
                  <tr>
                    <td colSpan={fields.length + 3} className="px-4 py-8 text-center text-sm text-(--color-text-muted)">
                      {q ? 'Qidiruv bo‘yicha topilmadi' : `${rangeText} oralig‘ida ${text.item} yozilmagan — yuqoridagi bo‘sh qatorga yozing yoki Excel‘dan yuklang`}
                    </td>
                  </tr>
                )}
              </tbody>
              {visibleSaved.length > 0 && (
                <tfoot>
                  <tr className="bg-(--color-surface-sunken) font-semibold text-heading">
                    <td colSpan={2} />
                    <td colSpan={fields.findIndex((c) => c.f === 'amount')} className="px-2 py-2.5 text-sm">
                      Jami{q ? ' (topilganlar)' : ''}: {visibleSaved.length} ta
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{formatTiyin(visibleTotal.toString())}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </Card>
      )}

      {/* Saqlash paneli — o'zgarish bo'lsa */}
      {dirty && isAdmin && (
        <div className="sticky bottom-3 z-20">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3 rounded-(--radius-card) border border-(--color-line-strong) bg-white px-4 py-3 shadow-lg">
            <p className="text-sm text-heading">
              <b>{dirtyRows.length}</b> ta saqlanmagan qator
              {filledDrafts.length > 0 && changed.length > 0 && (
                <span className="text-(--color-text-muted)">
                  {' '}
                  ({filledDrafts.length} yangi, {changed.length} tahrir)
                </span>
              )}
              {showErrors && badRows.length > 0 && <span className="ml-2 font-semibold text-(--color-expense)">· {badRows.length} tasida xato</span>}
            </p>
            <div className="ml-auto flex gap-2">
              <Button variant="secondary" size="sm" onClick={discard} disabled={saving}>
                Bekor qilish
              </Button>
              <Button size="sm" onClick={() => void handleSave()} loading={saving}>
                Saqlash
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Qatorlarni o'chirish"
        message={`${selectedCount} ta qator o'chiriladi${selectedSaved.length ? ` (saqlanganlari — ${formatTiyin(selectedSaved.reduce((s, r) => s + BigInt(amountOf(r.base ?? r.values, withQty) ?? '0'), 0n).toString(), { currency: true })} — savatga tushadi, tiklash mumkin)` : ''}.`}
        confirmLabel="O'chirish"
        danger
        loading={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => setConfirmDelete(false)}
      />
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}
    </div>
  );
}