'use client';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { IconDownload, IconPlus, IconTrash } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { LoadingState } from '@/components/ui/states';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatDate, formatSum, formatTiyin, parseSum, todayInput } from '@/lib/format';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  DOC_KIND_HINTS,
  DOC_KIND_LABELS,
  DOC_KIND_PATHS,
  downloadAct,
  qtyText,
  warehouseApi,
  type DocKind,
  type Holdings,
  type Supplier,
  type WarehouseAsset,
  type WarehouseDoc,
  type WarehouseItem,
  type WarehouseLookups,
} from '../api';
import { DocDrawer } from '../doc-drawer';
import { ItemForm } from '../item-form';
import { EMPTY_TARGET, TargetPicker, targetEmpty, targetPayload, type TargetValue } from '../target-picker';
import { AssetPicker } from './asset-picker';
import { ItemCombobox } from './item-combobox';
import { drafts, prefs, recentTargets, type FormDraft, type LineDraft } from './memory';
import { PasteDialog, type PastedRow } from './paste-dialog';

// ═══════════════════════════════════════════════════════════
// Ombor hujjatini kiritish — har tur alohida sahifada (Kirim, Chiqim, Ko'chirish, Qaytarish,
// Hisobdan chiqarish). Omborchi uchun: tez va xatosiz to'ldirish.
//  • qatorlar jadvali: buyum nomini yozib tanlash → Enter → miqdor → Enter → narx → Enter → keyingi qator
//  • kirimda: oxirgi narx o'zi qo'yiladi, yangi buyum shu yerda qo'shiladi, Excel'dan qatorlar qo'yiladi
//  • chiqimda: oluvchiga oxirgi berilganni bitta tugma bilan takrorlash
//  • qaytarishda: odam tanlansa — unda nima borligi chiqadi, belgilab qaytariladi
//  • qoralama avtomatik saqlanadi; Ctrl+S — saqlash; saqlangach — dalolatnoma va «Yana …»
// ═══════════════════════════════════════════════════════════

let seq = 0;
const newLine = (patch: Partial<LineDraft> = {}): LineDraft => ({ key: Date.now() * 100 + (++seq % 100), itemId: '', qty: '', price: null, serials: '', ...patch });

const REASONS = ['Yaroqsiz holga kelgan', "Yo'qolgan", 'Sarflangan (ishlatib bo‘lingan)', "Muddati o'tgan", "Buzilgan, ta'mirlab bo'lmaydi"];

const ASSET_STATUS_FOR: Partial<Record<DocKind, 'IN_STOCK' | 'IN_USE' | 'ANY'>> = {
  ISSUE: 'IN_STOCK',
  TRANSFER: 'IN_USE',
  RETURN: 'IN_USE',
  WRITE_OFF: 'ANY',
};

const WRONG_STATE: Partial<Record<DocKind, string>> = {
  ISSUE: 'omborda emas (allaqachon berilgan yoki hisobdan chiqarilgan)',
  TRANSFER: "foydalanishda emas — avval «Chiqim» bilan berilsin",
  RETURN: 'foydalanishda emas',
  WRITE_OFF: 'topilmadi yoki allaqachon hisobdan chiqarilgan',
};

function num(v: string): number {
  const n = Number(v.replace(',', '.').trim());
  return Number.isFinite(n) ? n : 0;
}

function emptyForm(kind: DocKind, issuedBy: string): FormDraft {
  const p = prefs.get();
  return {
    date: todayInput(),
    counterparty: '',
    documentNo: '',
    paymentMethod: p.paymentMethod ?? 'BANK',
    issuedBy,
    responsible: p.responsible ?? '',
    reason: '',
    note: '',
    commission: p.commission ?? '',
    target: EMPTY_TARGET,
    lines: kind === 'TRANSFER' ? [] : [newLine()],
    assetIds: [],
  };
}

/** Narx maydoni: 1 250 000 ko'rinishida, Enter bilan keyingi qatorga */
function PriceInput({ value, onChange, lineKey, invalid, onEnter }: { value: number | null; onChange: (v: number | null) => void; lineKey: number; invalid?: boolean; onEnter: () => void }) {
  const [text, setText] = useState(value === null ? '' : formatSum(value));
  useEffect(() => {
    const parsed = parseSum(text);
    if ((parsed === null ? null : parsed.toNumber()) !== value) setText(value === null ? '' : formatSum(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      data-line={lineKey}
      data-field="price"
      inputMode="numeric"
      value={text}
      onChange={(e) => {
        const cleaned = e.target.value.replace(/[^\d\s ]/g, '');
        const parsed = parseSum(cleaned);
        setText(parsed === null ? cleaned : formatSum(parsed));
        onChange(parsed === null ? null : parsed.toNumber());
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onEnter();
        }
      }}
      placeholder="Narx"
      className={cn('money h-10 w-full rounded-(--radius-control) border bg-white px-3 text-right text-sm focus:border-brand-600', invalid ? 'border-(--color-expense)' : 'border-(--color-line-strong)')}
    />
  );
}

function Section({ title, aside, children, className }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={cn('p-5', className)}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-bold text-heading">{title}</h2>
        {aside}
      </div>
      {children}
    </Card>
  );
}

export function DocEntry({ kind }: { kind: DocKind }) {
  const { user, canWrite } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const editable = canWrite('/ombor');
  const myName = user?.fullName ?? '';

  const [form, setForm] = useState<FormDraft>(() => emptyForm(kind, myName));
  const [ready, setReady] = useState(false);
  const [restoredAt, setRestoredAt] = useState<string | null>(null);
  const [draftAt, setDraftAt] = useState<string | null>(null);
  const [items, setItems] = useState<WarehouseItem[]>([]);
  const [candidates, setCandidates] = useState<WarehouseAsset[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [lookups, setLookups] = useState<WarehouseLookups | null>(null);
  const [holdings, setHoldings] = useState<Holdings | null>(null);
  const [showTarget, setShowTarget] = useState(kind !== 'RECEIPT');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lineErrors, setLineErrors] = useState<Record<number, string>>({});
  const [saved, setSaved] = useState<WarehouseDoc | null>(null);
  const [openDoc, setOpenDoc] = useState<string | null>(null);
  const [newItem, setNewItem] = useState<{ lineKey: number; name: string } | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const formRef = useRef(form);
  formRef.current = form;

  const label = DOC_KIND_LABELS[kind];
  const usesLines = kind !== 'TRANSFER';
  const usesAssets = kind !== 'RECEIPT';
  const tmzOnly = kind !== 'RECEIPT';
  const needTarget = kind === 'ISSUE' || kind === 'TRANSFER';

  const set = useCallback((patch: Partial<FormDraft>) => setForm((f) => ({ ...f, ...patch })), []);
  const setLine = (key: number, patch: Partial<LineDraft>) => setForm((f) => ({ ...f, lines: f.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));

  const reloadItems = useCallback(() => warehouseApi.items().then((r) => setItems(r.data)).catch(() => undefined), []);
  const reloadAssets = useCallback(() => {
    const status = ASSET_STATUS_FOR[kind];
    if (!status) return Promise.resolve();
    return warehouseApi
      .assets({ status: status === 'ANY' ? undefined : status })
      .then((r) => setCandidates(r.data))
      .catch(() => undefined);
  }, [kind]);

  // ── Boshlang'ich yuklash: ma'lumotnomalar, so'ng — nusxa / tayyor vositalar / qoralama ──
  useEffect(() => {
    let alive = true;
    (async () => {
      await Promise.all([
        reloadItems(),
        reloadAssets(),
        warehouseApi.lookups().then((r) => alive && setLookups(r.data)).catch(() => undefined),
        kind === 'RECEIPT' ? warehouseApi.suppliers().then((r) => alive && setSuppliers(r.data)).catch(() => undefined) : Promise.resolve(),
      ]);
      const base = emptyForm(kind, myName);
      const copyId = params.get('copy');
      const assetParam = params.get('assets');
      const itemParam = params.get('item');
      // «Kimda nima bor» sahifasidan: oluvchi / qaytaruvchi oldindan tanlangan
      const pre = { pinfl: params.get('pinfl'), name: params.get('name'), dept: params.get('dept'), region: params.get('region') };
      const preTarget: TargetValue | null =
        pre.pinfl || pre.name || pre.dept || pre.region !== null
          ? { holderPinfl: pre.pinfl ?? '', holderName: pre.name ?? '', departmentId: pre.dept ?? '', regionCode: pre.region ?? (pre.dept ? '0' : '') }
          : null;
      if (copyId) {
        try {
          const d = (await warehouseApi.doc(copyId)).data;
          const tmzLines = d.lines.filter((l) => kind === 'RECEIPT' || l.kind === 'TMZ');
          setForm({
            ...base,
            counterparty: d.counterparty ?? '',
            responsible: d.responsible ?? base.responsible,
            reason: d.reason ?? '',
            target: d.kind === kind && kind !== 'RECEIPT' ? { departmentId: d.to.departmentId ?? '', regionCode: d.to.regionCode === null ? '' : String(d.to.regionCode), holderPinfl: d.to.holderPinfl ?? '', holderName: d.to.holderName ?? '' } : base.target,
            lines: tmzLines.length ? tmzLines.map((l) => newLine({ itemId: l.itemId, qty: String(l.qty), price: kind === 'RECEIPT' ? Number(l.priceTiyin) / 100 : null })) : base.lines,
          });
          setRestoredAt(`nusxa: ${d.number}`);
        } catch {
          setForm(base);
        }
      } else if (assetParam || itemParam || preTarget) {
        setForm({
          ...base,
          target: preTarget ?? base.target,
          assetIds: assetParam ? assetParam.split(',').filter(Boolean) : [],
          lines: itemParam ? [newLine({ itemId: itemParam })] : base.lines,
        });
        if (preTarget && kind === 'RECEIPT') setShowTarget(true);
      } else {
        const d = drafts.load(kind);
        if (d) {
          setForm({ ...base, ...d.form, issuedBy: d.form.issuedBy || myName });
          setRestoredAt(d.savedAt);
          if (kind === 'RECEIPT' && !targetEmpty(d.form.target)) setShowTarget(true);
        } else setForm(base);
      }
      if (alive) setReady(true);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  // ── Qoralama: har o'zgarishdan 0,6 soniyadan keyin ──
  useEffect(() => {
    if (!ready || saved) return;
    const t = setTimeout(() => {
      drafts.save(kind, form);
      setDraftAt(new Date().toISOString());
    }, 600);
    return () => clearTimeout(t);
  }, [form, ready, saved, kind]);

  // ── Oluvchi / qaytaruvchi tanlansa — unda nima bor ──
  const t = form.target;
  useEffect(() => {
    if (!(kind === 'ISSUE' || kind === 'RETURN') || targetEmpty(t)) {
      setHoldings(null);
      return;
    }
    let alive = true;
    const p = t.holderPinfl ? { holderPinfl: t.holderPinfl } : t.holderName ? { holderName: t.holderName } : t.departmentId ? { departmentId: t.departmentId } : { regionCode: t.regionCode };
    warehouseApi
      .holdings(p)
      .then((r) => alive && setHoldings(r.data))
      .catch(() => alive && setHoldings(null));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, t.holderPinfl, t.holderName, t.departmentId, t.regionCode]);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const pickable = useMemo(() => items.filter((i) => i.isActive && (!tmzOnly || i.kind === 'TMZ')), [items, tmzOnly]);
  const heldQty = useMemo(() => new Map((holdings?.tmz ?? []).map((h) => [h.itemId, h.qty])), [holdings]);

  const lineTotal = (l: LineDraft): number => {
    const item = byId.get(l.itemId);
    if (!item) return 0;
    const price = kind === 'RECEIPT' ? (l.price ?? 0) * 100 : Number(item.avgPriceTiyin);
    return Math.round(num(l.qty) * price);
  };
  const assetsTotal = candidates.filter((a) => form.assetIds.includes(a.id)).reduce((s, a) => s + Number(a.priceTiyin), 0);
  const total = form.lines.reduce((s, l) => s + lineTotal(l), 0) + assetsTotal;
  const filledLines = form.lines.filter((l) => l.itemId);

  /** Yangi qator va unga fokus */
  const addLine = (patch: Partial<LineDraft> = {}) => {
    const l = newLine(patch);
    setForm((f) => ({ ...f, lines: [...f.lines, l] }));
    setTimeout(() => document.querySelector<HTMLInputElement>(`[data-line="${l.key}"][data-field="item"]`)?.focus(), 30);
  };
  const nextAfter = (key: number) => {
    const list = formRef.current.lines;
    const i = list.findIndex((l) => l.key === key);
    const next = list[i + 1];
    if (next && !next.itemId) document.querySelector<HTMLInputElement>(`[data-line="${next.key}"][data-field="item"]`)?.focus();
    else addLine();
  };

  const pickItem = (key: number, item: WarehouseItem | null) => {
    if (!item) return setLine(key, { itemId: '', search: undefined });
    // Kirimda — oxirgi narx o'zi qo'yiladi
    const price = kind === 'RECEIPT' && item.lastPriceTiyin ? Number(item.lastPriceTiyin) / 100 : null;
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l) => (l.key === key ? { ...l, itemId: item.id, search: undefined, price: l.price ?? price, qty: l.qty || (kind === 'RETURN' && heldQty.get(item.id) ? String(heldQty.get(item.id)) : '') } : l)),
    }));
    setLineErrors((e) => {
      const n = { ...e };
      delete n[key];
      return n;
    });
  };

  // ── Excel'dan qo'yish ──
  const applyPaste = (rows: PastedRow[]) => {
    const exact = new Map(pickable.map((i) => [i.name.toLowerCase(), i]));
    const codes = new Map(pickable.map((i) => [i.code.toLowerCase(), i]));
    const made = rows.map((r) => {
      const key = r.name.toLowerCase();
      let item = exact.get(key) ?? codes.get(key);
      if (!item) {
        const partial = pickable.filter((i) => i.name.toLowerCase().includes(key));
        if (partial.length === 1) item = partial[0];
      }
      const price = r.price ?? (kind === 'RECEIPT' && item?.lastPriceTiyin ? Number(item.lastPriceTiyin) / 100 : null);
      return newLine({ itemId: item?.id ?? '', search: item ? undefined : r.name, qty: r.qty ? String(r.qty) : '', price: kind === 'RECEIPT' ? price : null });
    });
    setForm((f) => ({ ...f, lines: [...f.lines.filter((l) => l.itemId || l.search), ...made] }));
    setPasteOpen(false);
  };

  // ── Tekshirish va saqlash ──
  const validate = (): boolean => {
    const errs: Record<number, string> = {};
    let headError: string | null = null;
    const lines = form.lines.filter((l) => l.itemId || l.search);
    if (lines.length === 0 && form.assetIds.length === 0) headError = kind === 'TRANSFER' ? "Ko'chiriladigan asosiy vositani qo'shing" : "Kamida bitta qator qo'shing";
    if (needTarget && targetEmpty(form.target)) headError = headError ?? "Kimga berilayotganini tanlang (odam yoki bo'lim)";
    if (kind === 'RETURN' && lines.length > 0 && targetEmpty(form.target)) headError = headError ?? 'TMZ kimdan qaytganini tanlang';
    if (kind === 'WRITE_OFF' && !form.reason.trim()) headError = headError ?? 'Hisobdan chiqarish sababini tanlang yoki yozing';
    for (const l of lines) {
      const item = byId.get(l.itemId);
      if (!item) {
        errs[l.key] = 'Buyumni ro‘yxatdan tanlang yoki yangisini qo‘shing';
        continue;
      }
      const q = num(l.qty);
      if (q <= 0) errs[l.key] = 'Miqdorni kiriting';
      else if (item.kind === 'ASSET' && !Number.isInteger(q)) errs[l.key] = 'Asosiy vosita soni butun bo‘lsin';
      else if (kind === 'RECEIPT' && (l.price === null || l.price < 0)) errs[l.key] = 'Narxni kiriting';
      else if ((kind === 'ISSUE' || kind === 'WRITE_OFF') && q > item.inStock + 1e-9) errs[l.key] = `Omborda ${qtyText(item.inStock)} ${item.unit} bor`;
    }
    // Bir buyum ikki qatorda — chiqimda jami qoldiqdan oshmasin
    if (kind === 'ISSUE' || kind === 'WRITE_OFF') {
      const sum = new Map<string, number>();
      for (const l of lines) if (l.itemId) sum.set(l.itemId, (sum.get(l.itemId) ?? 0) + num(l.qty));
      for (const l of lines) {
        const item = byId.get(l.itemId);
        if (item && (sum.get(l.itemId) ?? 0) > item.inStock + 1e-9 && !errs[l.key]) errs[l.key] = `Qatorlar bo'yicha jami ${qtyText(sum.get(l.itemId)!)} — omborda ${qtyText(item.inStock)} bor`;
      }
    }
    setLineErrors(errs);
    setError(headError ?? (Object.keys(errs).length ? 'Qizil belgilangan qatorlarni to‘g‘rilang' : null));
    return !headError && Object.keys(errs).length === 0;
  };

  const submit = async () => {
    if (saving || saved || !editable) return;
    if (!validate()) return;
    setSaving(true);
    try {
      const f = formRef.current;
      const note = kind === 'WRITE_OFF' && f.commission.trim() ? [`Komissiya a'zolari: ${f.commission.trim()}`, f.note.trim()].filter(Boolean).join('. ') : f.note;
      const r = await warehouseApi.createDoc({
        kind,
        date: f.date,
        counterparty: f.counterparty.trim() || null,
        documentNo: f.documentNo.trim() || null,
        issuedBy: f.issuedBy.trim() || null,
        responsible: f.responsible.trim() || null,
        reason: f.reason.trim() || null,
        note: note.trim() || null,
        paymentMethod: f.paymentMethod,
        ...targetPayload(f.target),
        lines: f.lines
          .filter((l) => l.itemId)
          .map((l) => ({
            itemId: l.itemId,
            qty: num(l.qty),
            ...(kind === 'RECEIPT' ? { priceTiyin: String(Math.round((l.price ?? 0) * 100)) } : {}),
            serials: l.serials
              .split(/[\n,;]+/)
              .map((s) => s.trim())
              .filter(Boolean),
          })),
        assetIds: f.assetIds,
        conditions: Object.fromEntries(Object.entries(f.conditions ?? {}).filter(([id, v]) => f.assetIds.includes(id) && v.trim())),
      });
      drafts.clear(kind);
      prefs.set({ responsible: f.responsible.trim() || undefined, ...(kind === 'RECEIPT' ? { paymentMethod: f.paymentMethod } : {}), ...(kind === 'WRITE_OFF' ? { commission: f.commission.trim() } : {}) });
      if (!targetEmpty(f.target) && r.data.to.text !== 'Ombor') recentTargets.push(r.data.to.text, f.target);
      setSaved(r.data);
      setError(null);
      void reloadItems();
      void reloadAssets();
      window.scrollTo({ top: 0 });
    } catch (err) {
      setError(errorMessage(err, "Saqlab bo'lmadi"));
    } finally {
      setSaving(false);
    }
  };

  // Ctrl+S — saqlash
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void submitRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** Yangi hujjat: odatiy qiymatlar qoladi; keepTarget — shu odamga yana */
  const startNew = (keepTarget = false) => {
    const base = emptyForm(kind, myName);
    setForm(keepTarget ? { ...base, target: formRef.current.target } : base);
    setSaved(null);
    setRestoredAt(null);
    setLineErrors({});
    setError(null);
    setHoldings(null);
    router.replace(DOC_KIND_PATHS[kind]);
    setTimeout(() => document.querySelector<HTMLInputElement>('[data-field="item"], [data-field="asset"]')?.focus(), 60);
  };

  const clearForm = () => {
    drafts.clear(kind);
    startNew(false);
  };

  const act = async () => {
    if (!saved) return;
    setDownloading(true);
    try {
      await downloadAct(saved);
    } catch (err) {
      setError(errorMessage(err, "Dalolatnomani yuklab bo'lmadi"));
    } finally {
      setDownloading(false);
    }
  };

  if (!ready) return <LoadingState />;

  if (!editable) {
    return (
      <div className="p-6">
        <Card className="p-6 text-sm text-(--color-text-muted)">Ombor hujjatlarini kiritish — faqat administrator va omborchi uchun.</Card>
      </div>
    );
  }

  // ═══════════ Saqlandi ═══════════
  if (saved) {
    return (
      <>
        <PageHeader title={label} description={DOC_KIND_HINTS[kind]} />
        <div className="mx-auto max-w-3xl p-6">
          <Card className="overflow-hidden">
            <div className="bg-(--color-income-soft) px-6 py-6 text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-(--color-income) text-2xl text-white">✓</div>
              <p className="mt-3 text-lg font-bold text-heading">
                {label} <span className="font-mono">{saved.number}</span> saqlandi
              </p>
              <p className="mt-1 text-sm text-(--color-text-muted)">
                {formatDate(saved.date)} · {saved.kind === 'RECEIPT' ? saved.counterparty || 'Yetkazib beruvchi ko‘rsatilmagan' : saved.kind === 'WRITE_OFF' ? saved.reason : saved.to.text} · {saved.lines.length + (saved.kind === 'RECEIPT' ? 0 : saved.assets.length)} qator ·{' '}
                <b className="money text-heading">{formatTiyin(saved.totalTiyin)} so&apos;m</b>
              </p>
              {saved.kind === 'RECEIPT' && <p className="mt-1 text-xs text-(--color-text-muted)">Summa Xarajatlarga yozildi (manba: Ombor).</p>}
              {saved.kind === 'RECEIPT' && saved.assets.length > 0 && (
                <p className="mt-1 text-xs text-(--color-text-muted)">
                  Inventar raqamlari: <span className="font-mono">{saved.assets.map((a) => a.inventoryNo).join(', ')}</span>
                </p>
              )}
            </div>
            <div className="grid gap-3 p-6 sm:grid-cols-2">
              <Button size="lg" onClick={() => void act()} loading={downloading}>
                <IconDownload className="size-4" />
                Dalolatnoma (Word)
              </Button>
              <Button size="lg" variant="secondary" onClick={() => setOpenDoc(saved.id)}>
                Hujjatni ko&apos;rish
              </Button>
              <Button size="lg" variant="secondary" onClick={() => startNew(false)}>
                <IconPlus className="size-4" />
                Yana {label.toLowerCase()}
              </Button>
              {(kind === 'ISSUE' || kind === 'TRANSFER') && !targetEmpty(form.target) ? (
                <Button size="lg" variant="secondary" onClick={() => startNew(true)}>
                  Shu oluvchiga yana
                </Button>
              ) : (
                <Link
                  href="/ombor/ish-stoli"
                  className="inline-flex h-11 items-center justify-center rounded-(--radius-control) border border-(--color-line-strong) bg-white px-5 text-base text-(--color-text) hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
                >
                  Ish stoliga
                </Link>
              )}
            </div>
            {error && <p className="mx-6 mb-6 rounded-(--radius-control) bg-(--color-expense-soft) px-3 py-2 text-sm text-(--color-expense)">{error}</p>}
          </Card>
        </div>
        <DocDrawer docId={openDoc} onClose={() => setOpenDoc(null)} onChanged={() => undefined} />
      </>
    );
  }

  // ═══════════ Forma ═══════════
  const recent = recentTargets.get();
  const lastIssue = kind === 'ISSUE' ? holdings?.lastIssue : null;
  const lastIssueLines = lastIssue?.lines.filter((l) => l.kind === 'TMZ') ?? [];

  return (
    <>
      <PageHeader title={label} description={DOC_KIND_HINTS[kind]} />

      <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
        {restoredAt && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-(--radius-card) border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm">
            <span className="text-heading">
              {restoredAt.startsWith('nusxa')
                ? `Oldingi hujjatdan nusxa (${restoredAt.slice(7)}): qatorlar va oluvchi tayyor — tekshirib, saqlang.`
                : `Tugatilmagan qoralama tiklandi (${formatDate(restoredAt)} ${new Date(restoredAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}).`}
            </span>
            <button type="button" onClick={clearForm} className="text-xs font-semibold text-amber-800 hover:underline">
              Tozalab, yangidan boshlash
            </button>
          </div>
        )}

        {/* ── Hujjat ── */}
        <Section title="Hujjat">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Input label="Sana" type="date" value={form.date} max={todayInput()} onChange={(e) => set({ date: e.target.value })} required />
            {kind === 'RECEIPT' && (
              <>
                <div className="lg:col-span-2">
                  <Input
                    label="Yetkazib beruvchi"
                    value={form.counterparty}
                    onChange={(e) => set({ counterparty: e.target.value })}
                    list="wh-suppliers"
                    placeholder='"Ofis Market" MChJ'
                    hint={suppliers.length ? `Oldingilardan tanlash mumkin (${suppliers.length})` : undefined}
                  />
                  <datalist id="wh-suppliers">
                    {suppliers.map((s) => (
                      <option key={s.name} value={s.name}>
                        {`oxirgi: ${formatDate(s.lastDate)} · ${s.count} marta`}
                      </option>
                    ))}
                  </datalist>
                </div>
                <Input label="Faktura / shartnoma №" value={form.documentNo} onChange={(e) => set({ documentNo: e.target.value })} />
                <Select
                  label="To'lov usuli"
                  value={form.paymentMethod}
                  onChange={(e) => set({ paymentMethod: e.target.value })}
                  options={[
                    { value: 'BANK', label: "Bank (o'tkazma)" },
                    { value: 'CASH', label: 'Naqd' },
                    { value: 'CARD', label: 'Karta' },
                    { value: 'OTHER', label: 'Boshqa' },
                  ]}
                />
              </>
            )}
            <Input
              label={kind === 'RECEIPT' || kind === 'RETURN' ? 'Qabul qildi (omborchi)' : kind === 'WRITE_OFF' ? 'Omborchi' : 'Topshirdi (omborchi)'}
              value={form.issuedBy}
              onChange={(e) => set({ issuedBy: e.target.value })}
            />
            <Input
              label={kind === 'WRITE_OFF' ? 'Komissiya raisi' : "Mas'ul shaxs"}
              value={form.responsible}
              onChange={(e) => set({ responsible: e.target.value })}
              placeholder="F.I.Sh. — eslab qolinadi"
            />
            {kind === 'WRITE_OFF' && (
              <div className="sm:col-span-2">
                <Input label="Komissiya a'zolari" value={form.commission} onChange={(e) => set({ commission: e.target.value })} placeholder="F.I.Sh., vergul bilan — eslab qolinadi" />
              </div>
            )}
          </div>

          {kind === 'WRITE_OFF' && (
            <div className="mt-4 space-y-2">
              <p className="text-sm font-medium text-(--color-text)">
                Sabab <span className="text-(--color-expense)">*</span>
              </p>
              <div className="flex flex-wrap gap-2">
                {REASONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => set({ reason: r })}
                    className={cn('rounded-full border px-3 py-1.5 text-sm transition-colors', form.reason === r ? 'border-brand-500 bg-brand-50 font-semibold text-brand-700' : 'border-(--color-line) hover:border-brand-300')}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <Input value={form.reason} onChange={(e) => set({ reason: e.target.value })} placeholder="yoki o'zingiz yozing" />
            </div>
          )}
        </Section>

        {/* ── Kimga / kimdan ── */}
        {kind !== 'WRITE_OFF' && (
          <Section
            title={kind === 'RECEIPT' ? 'Kimning hisobiga' : kind === 'RETURN' ? 'Kimdan qaytdi' : 'Kimga'}
            aside={
              kind === 'RECEIPT' ? (
                <button type="button" onClick={() => setShowTarget((v) => !v)} className="text-xs font-semibold text-brand-700 hover:underline">
                  {showTarget ? 'Yopish' : "Ko'rsatish (ixtiyoriy)"}
                </button>
              ) : undefined
            }
          >
            {kind === 'RECEIPT' && !showTarget ? (
              <p className="text-sm text-(--color-text-muted)">Ko&apos;rsatilmasa — xarajat Markaz (umumiy) hisobiga yoziladi.</p>
            ) : (
              <div className="space-y-3">
                {kind !== 'RECEIPT' && recent.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-(--color-text-muted)">Oxirgilar:</span>
                    {recent.map((r) => (
                      <button
                        key={r.label}
                        type="button"
                        onClick={() => set({ target: r.value })}
                        className={cn(
                          'max-w-[16rem] truncate rounded-full border px-2.5 py-1 text-xs transition-colors',
                          JSON.stringify(r.value) === JSON.stringify(form.target) ? 'border-brand-500 bg-brand-50 font-semibold text-brand-700' : 'border-(--color-line) bg-white hover:border-brand-300',
                        )}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                )}
                <TargetPicker value={form.target} onChange={(v) => set({ target: v })} lookups={lookups} label={kind === 'RETURN' ? 'Kimdan' : 'Oluvchi'} />

                {/* Chiqim: oxirgi berilganni takrorlash */}
                {lastIssue && lastIssueLines.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-(--radius-control) border border-brand-200 bg-brand-50 px-3 py-2.5 text-sm">
                    <span className="min-w-0">
                      Oxirgi marta {formatDate(lastIssue.date)} ({lastIssue.number}):{' '}
                      <span className="text-(--color-text-muted)">{lastIssueLines.map((l) => `${l.itemName} ${qtyText(l.qty)} ${l.unit}`).join(', ')}</span>
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          lines: [...f.lines.filter((l) => l.itemId), ...lastIssueLines.map((l) => newLine({ itemId: l.itemId, qty: String(l.qty) }))],
                        }))
                      }
                    >
                      Takrorlash
                    </Button>
                  </div>
                )}

                {/* Qaytarish: unda nima bor */}
                {kind === 'RETURN' && holdings && (
                  <div className="rounded-(--radius-control) border border-(--color-line) p-3">
                    <p className="text-sm font-semibold text-heading">Unda hozir bor</p>
                    {holdings.assets.length === 0 && holdings.tmz.length === 0 ? (
                      <p className="mt-1 text-xs text-(--color-text-muted)">Hech narsa yo&apos;q (yoki boshqa nom bilan berilgan).</p>
                    ) : (
                      <div className="mt-2 grid gap-1.5 md:grid-cols-2">
                        {holdings.assets.map((a) => {
                          const on = form.assetIds.includes(a.id);
                          return (
                            <label key={a.id} className={cn('flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm', on ? 'bg-brand-50' : 'hover:bg-(--color-surface-muted)')}>
                              <input type="checkbox" className="size-4" checked={on} onChange={() => set({ assetIds: on ? form.assetIds.filter((x) => x !== a.id) : [...form.assetIds, a.id] })} />
                              <span className="font-mono text-xs font-semibold text-brand-700">{a.inventoryNo}</span>
                              <span className="truncate">{a.name}</span>
                            </label>
                          );
                        })}
                        {holdings.tmz.map((h) => {
                          const on = form.lines.some((l) => l.itemId === h.itemId);
                          return (
                            <label key={h.itemId} className={cn('flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm', on ? 'bg-brand-50' : 'hover:bg-(--color-surface-muted)')}>
                              <input
                                type="checkbox"
                                className="size-4"
                                checked={on}
                                onChange={() =>
                                  setForm((f) => ({
                                    ...f,
                                    lines: on ? f.lines.filter((l) => l.itemId !== h.itemId) : [...f.lines.filter((l) => l.itemId || l.search), newLine({ itemId: h.itemId, qty: String(h.qty) })],
                                  }))
                                }
                              />
                              <span className="truncate">{h.itemName}</span>
                              <span className="ml-auto shrink-0 text-xs text-(--color-text-muted)">
                                {qtyText(h.qty)} {h.unit}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </Section>
        )}

        {/* ── Qatorlar ── */}
        {usesLines && (
          <Section
            title={kind === 'RECEIPT' ? 'Qatorlar (TMZ va asosiy vositalar)' : 'TMZ qatorlari'}
            aside={
              <div className="flex flex-wrap gap-2">
                {(kind === 'RECEIPT' || kind === 'ISSUE') && (
                  <Button size="sm" variant="secondary" onClick={() => setPasteOpen(true)} title="Excel jadvalidan nusxa olib qo'yish: nomi, miqdori, narxi">
                    Excel&apos;dan qo&apos;yish
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => addLine()}>
                  <IconPlus className="size-4" />
                  Qator
                </Button>
              </div>
            }
          >
            <div className="hidden grid-cols-[1.5rem_minmax(0,1fr)_8rem_9rem_9rem_2rem] gap-2 px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted) md:grid">
              <span>№</span>
              <span>Buyum</span>
              <span className="text-right">Miqdor</span>
              <span className="text-right">{kind === 'RECEIPT' ? "Narx, so'm" : "O'rtacha narx"}</span>
              <span className="text-right">Summa</span>
              <span />
            </div>
            <div className="space-y-2">
              {form.lines.length === 0 && <p className="px-1 py-2 text-sm text-(--color-text-muted)">Qator yo&apos;q.</p>}
              {form.lines.map((l, index) => {
                const item = byId.get(l.itemId);
                const err = lineErrors[l.key];
                const held = kind === 'RETURN' && item ? heldQty.get(item.id) : undefined;
                return (
                  <div key={l.key} className={cn('rounded-(--radius-control) p-1', err && 'bg-(--color-expense-soft)/50')}>
                    <div className="grid grid-cols-[1.5rem_minmax(0,1fr)_2rem] gap-2 md:grid-cols-[1.5rem_minmax(0,1fr)_8rem_9rem_9rem_2rem] md:items-start">
                      <span className="pt-2.5 text-xs text-(--color-text-faint)">{index + 1}.</span>
                      <ItemCombobox
                        items={pickable}
                        value={l.itemId}
                        initialSearch={l.search}
                        onPick={(it) => pickItem(l.key, it)}
                        onCreate={kind === 'RECEIPT' ? (name) => setNewItem({ lineKey: l.key, name }) : undefined}
                        showStock={kind !== 'RECEIPT'}
                        lineKey={l.key}
                        invalid={Boolean(err) && !item}
                      />
                      <div className="col-start-2 grid grid-cols-3 gap-2 md:col-start-auto md:contents">
                        <div className="relative">
                          <input
                            data-line={l.key}
                            data-field="qty"
                            inputMode="decimal"
                            value={l.qty}
                            onChange={(e) => setLine(l.key, { qty: e.target.value.replace(/[^\d.,]/g, '') })}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                if (kind === 'RECEIPT') document.querySelector<HTMLInputElement>(`[data-line="${l.key}"][data-field="price"]`)?.focus();
                                else nextAfter(l.key);
                              }
                            }}
                            placeholder="Miqdor"
                            className={cn(
                              'h-10 w-full rounded-(--radius-control) border bg-white px-3 pr-16 text-right text-sm focus:border-brand-600',
                              err && item ? 'border-(--color-expense)' : 'border-(--color-line-strong)',
                            )}
                          />
                          <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-(--color-text-muted)">{item?.unit}</span>
                        </div>
                        {kind === 'RECEIPT' ? (
                          <PriceInput value={l.price} onChange={(v) => setLine(l.key, { price: v })} lineKey={l.key} invalid={Boolean(err) && l.price === null} onEnter={() => nextAfter(l.key)} />
                        ) : (
                          <div className="money flex h-10 items-center justify-end text-sm text-(--color-text-muted)">{item ? formatTiyin(item.avgPriceTiyin) : ''}</div>
                        )}
                        <div className="money flex h-10 items-center justify-end text-sm font-semibold text-heading">{lineTotal(l) ? formatTiyin(lineTotal(l)) : ''}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, lines: f.lines.filter((x) => x.key !== l.key) }))}
                        className="col-start-3 row-start-1 mt-1.5 flex size-7 items-center justify-center rounded text-(--color-text-muted) hover:bg-red-50 hover:text-red-600 md:col-start-auto md:row-start-auto"
                        aria-label="Qatorni o'chirish"
                        tabIndex={-1}
                      >
                        <IconTrash className="size-4" />
                      </button>
                    </div>
                    {(item || err) && (
                      <div className="flex flex-wrap items-center justify-between gap-2 pl-8 pr-10 pt-1 text-[11px]">
                        <span className="text-(--color-text-muted)">
                          {item && `Omborda: ${qtyText(item.inStock)} ${item.unit}`}
                          {held !== undefined && ` · unda: ${qtyText(held)} ${item?.unit}`}
                          {kind === 'RECEIPT' && item?.lastPriceTiyin && ` · oxirgi narx ${formatTiyin(item.lastPriceTiyin)} so'm`}
                        </span>
                        {err && <span className="font-semibold text-(--color-expense)">{err}</span>}
                      </div>
                    )}
                    {kind === 'RECEIPT' && item?.kind === 'ASSET' && (
                      <textarea
                        value={l.serials}
                        onChange={(e) => setLine(l.key, { serials: e.target.value })}
                        rows={2}
                        placeholder="Seriya raqamlari (ixtiyoriy): har birini yangi qatorga yoki vergul bilan. Har donasiga inventar raqami o'zi beriladi."
                        className="ml-8 mt-1.5 w-[calc(100%-4.5rem)] rounded-(--radius-control) border border-(--color-line-strong) px-3 py-2 text-xs"
                      />
                    )}
                  </div>
                );
              })}
            </div>
            <button type="button" onClick={() => addLine()} className="mt-3 w-full rounded-(--radius-control) border border-dashed border-(--color-line-strong) py-2 text-sm text-(--color-text-muted) hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700">
              + Qator qo&apos;shish <span className="text-xs">(oxirgi maydonda Enter)</span>
            </button>
          </Section>
        )}

        {/* ── Asosiy vositalar ── */}
        {usesAssets && (
          <Section title="Asosiy vositalar">
            <AssetPicker
              title={kind === 'ISSUE' ? 'Beriladigan' : kind === 'TRANSFER' ? "Ko'chiriladigan" : kind === 'RETURN' ? 'Qaytgan' : 'Hisobdan chiqariladigan'}
              candidates={candidates}
              selected={form.assetIds}
              onChange={(ids) => set({ assetIds: ids })}
              conditions={form.conditions ?? {}}
              onConditionChange={(id, v) => set({ conditions: { ...(form.conditions ?? {}), [id]: v } })}
              emptyText={kind === 'ISSUE' ? "Omborda turgan asosiy vositani inventar raqami bilan qo'shing (bo'lmasa — bo'sh qoldiring)" : 'Inventar raqamini yozib Enter bosing'}
              wrongState={WRONG_STATE[kind]}
            />
          </Section>
        )}

        <Section title="Izoh">
          <Input value={form.note} onChange={(e) => set({ note: e.target.value })} placeholder="Ixtiyoriy — dalolatnomada chiqadi" />
        </Section>
      </div>

      {/* ── Pastki panel: jami va saqlash ── */}
      <div className="no-print sticky bottom-0 z-20 -mb-8 border-t border-(--color-line) bg-white/95 shadow-[0_-4px_16px_rgba(15,23,42,0.06)] backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3 md:px-6">
          <div className="mr-auto min-w-0">
            <p className="text-sm">
              Jami: <b className="money text-lg text-heading">{formatTiyin(total)}</b> so&apos;m
              <span className="ml-2 text-xs text-(--color-text-muted)">
                {filledLines.length} qator{form.assetIds.length ? ` · ${form.assetIds.length} asosiy vosita` : ''}
              </span>
            </p>
            {error ? (
              <p className="truncate text-xs font-semibold text-(--color-expense)">{error}</p>
            ) : (
              <p className="text-[11px] text-(--color-text-faint)">
                {draftAt ? `Qoralama saqlandi ${new Date(draftAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : 'Qoralama avtomatik saqlanadi'} · Ctrl+S — saqlash
              </p>
            )}
          </div>
          <Button variant="ghost" onClick={clearForm} disabled={saving}>
            Tozalash
          </Button>
          <Button size="lg" onClick={() => void submit()} loading={saving}>
            Saqlash
          </Button>
        </div>
      </div>

      <ItemForm
        open={Boolean(newItem)}
        item={null}
        lookups={lookups}
        initialName={newItem?.name}
        onClose={() => setNewItem(null)}
        onSaved={() => setNewItem(null)}
        onCreated={(created) => {
          const key = newItem?.lineKey;
          setItems((list) => [...list, created]);
          if (key !== undefined) pickItem(key, created);
          void reloadItems();
        }}
      />
      <PasteDialog open={pasteOpen} withPrice={kind === 'RECEIPT'} onClose={() => setPasteOpen(false)} onApply={applyPaste} />
    </>
  );
}