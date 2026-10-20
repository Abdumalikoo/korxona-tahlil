'use client';

import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconTrash } from '@/components/ui/icons';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { SubTabs } from '@/components/ui/tabs';
import { Toast } from '@/components/ui/toast';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { EmployeePick } from './act-paper';
import { TemplateApproveDialog } from './template-approve';
import { downloadActSample, downloadSignArchive, warehouseApi, type ActKindTexts, type ActRegionOverride, type ActTemplate, type DocKind, type EmployeeOption, type SignerT } from './api';

// ═══════════════════════════════════════════════════════════
// Ombor › Dalolatnoma shabloni — ikki rejim:
//   1) «Asosiy» — faqat asosiy joylar: tasdiqlovchi rahbar, omborchi, kelishuvchilar, tashkilot, shahar, sanalar.
//      Ismlar qo'lda yozilmaydi — Xodimlar bo'limidan tanlanadi (dalolatnomada o'sha xodimning ismi chiqadi).
//   2) «To'liq matn» — dalolatnoma qog'ozda: istalgan so'zni bosib almashtirish, xatboshi qo'shish / o'chirish,
//      o'rinbosarlarni ({giver}, {receiver} …) kursor turgan joyga qo'yish, jadval ustunlari ham shu yerda.
// Hududlar uchun alohida rahbar / omborchi / kelishuvchilar — hudud hujjatlari doim o'z shabloni bilan.
// ═══════════════════════════════════════════════════════════

type Mode = 'basic' | 'full';

const KINDS: { value: DocKind; label: string }[] = [
  { value: 'ISSUE', label: 'Berish (chiqim)' },
  { value: 'RETURN', label: 'Qaytarib olish' },
  { value: 'TRANSFER', label: "Boshqaga o'tkazish" },
  { value: 'WRITE_OFF', label: 'Hisobdan chiqarish' },
  { value: 'RECEIPT', label: 'Kirim' },
];

const VARS: [string, string][] = [
  ['{giver}', 'topshiruvchi'],
  ['{receiver}', 'qabul qiluvchi'],
  ['{storekeeper}', 'omborchi'],
  ['{storekeeperTitle}', 'omborchi lavozimi'],
  ['{supplier}', 'yetkazib beruvchi'],
  ['{reason}', 'sabab'],
  ['{number}', 'hujjat raqami'],
  ['{date}', 'sana'],
  ['{city}', 'shahar'],
];

const FIELD = 'h-9 w-full rounded-(--radius-control) border border-(--color-line-strong) bg-white px-2.5 text-sm focus:border-brand-600 disabled:bg-(--color-surface-muted)';

function Field({ label, hint, children, wide }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={cn('block', wide && 'sm:col-span-2')}>
      <span className="mb-1 block text-xs font-medium text-(--color-text-muted)">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-[11px] text-(--color-text-faint)">{hint}</span>}
    </label>
  );
}

// ─────────── Ko'rinish uchun: ism qisqartirish va lotin → kirill (serverdagi bilan bir xil) ───────────

const PAIRS: [RegExp, string][] = [
  [/o['ʻ‘’`]/g, 'ў'],
  [/g['ʻ‘’`]/g, 'ғ'],
  [/sh/g, 'ш'],
  [/ch/g, 'ч'],
  [/yo/g, 'ё'],
  [/yu/g, 'ю'],
  [/ya/g, 'я'],
  [/ye/g, 'е'],
  [/ts/g, 'ц'],
];
const ONE: Record<string, string> = {
  a: 'а', b: 'б', d: 'д', e: 'е', f: 'ф', g: 'г', h: 'ҳ', i: 'и', j: 'ж', k: 'к', l: 'л', m: 'м', n: 'н', o: 'о', p: 'п',
  q: 'қ', r: 'р', s: 'с', t: 'т', u: 'у', v: 'в', x: 'х', y: 'й', z: 'з', c: 'с', w: 'в',
};
function toCyr(text: string): string {
  return text.replace(/[A-Za-zʻ‘’'`]+/g, (word) => {
    const upper = word === word.toUpperCase() && word.length > 1;
    const cap = word[0] === word[0]!.toUpperCase();
    let w = word.toLowerCase().replace(/^e/, 'э');
    for (const [re, to] of PAIRS) w = w.replace(re, to);
    w = [...w].map((ch) => ONE[ch] ?? (/['ʻ‘’`]/.test(ch) ? 'ъ' : ch)).join('');
    if (upper) return w.toUpperCase();
    return cap ? w.charAt(0).toUpperCase() + w.slice(1) : w;
  });
}
function person(t: ActTemplate, full: string): string {
  let n = full.trim();
  if (t.shortNames) {
    const parts = n.split(/\s+/);
    if (parts.length >= 2 && parts[1]!.length > 2) n = `${parts[0]!.charAt(0)}${parts[0]!.slice(1).toLowerCase()} ${parts[1]!.charAt(0)}.`;
  }
  return t.namesScript === 'cyrl' ? toCyr(n) : n;
}

function resolve(t: ActTemplate, region: string): ActTemplate {
  const o = region ? t.regions[region] : undefined;
  if (!o) return t;
  return {
    ...t,
    approverPosition: o.approverPosition || t.approverPosition,
    approverName: o.approverName || t.approverName,
    approverPinfl: o.approverPinfl ?? (o.approverName ? null : t.approverPinfl),
    company: o.company || t.company,
    city: o.city || t.city,
    storekeeperTitle: o.storekeeperTitle || t.storekeeperTitle,
    storekeeperName: o.storekeeperName || t.storekeeperName,
    storekeeperPinfl: o.storekeeperPinfl ?? (o.storekeeperName ? null : t.storekeeperPinfl),
    agreed: o.agreed?.length ? o.agreed : t.agreed,
  };
}

/** Namuna qiymatlari — ko'rinish uchun (haqiqiy dalolatnomada hujjatdagi odamlar) */
function sampleVars(t: ActTemplate, kind: DocKind): Record<string, string> {
  const store = person(t, t.storekeeperName || 'Omborchi');
  const emp = person(t, 'AKBAROV FARRUX OTABEKOVICH');
  const emp2 = person(t, 'BASHARATOV ABDUMALIK');
  return {
    giver: kind === 'RETURN' || kind === 'TRANSFER' ? emp : kind === 'RECEIPT' ? '“Техномарт” МЧЖ' : store,
    receiver: kind === 'ISSUE' ? emp : kind === 'TRANSFER' ? emp2 : kind === 'WRITE_OFF' ? person(t, 'Эргашов С.') : store,
    storekeeper: store,
    storekeeperTitle: t.storekeeperTitle,
    supplier: '“Техномарт” МЧЖ',
    reason: 'яроқсиз ҳолга келган',
    number: 'CH-2026-0001',
    date: '19.10.2026',
    city: t.city,
  };
}

// ═══════════════════════════════════════════════════════════
// Qog'oz: oddiy ko'rinish (Asosiy rejim) va tahrirlanadigan (To'liq matn)
// ═══════════════════════════════════════════════════════════

interface EditCtx {
  /** To'liq matn rejimi: qatorlar bosilsa tahrirlanadi */
  editable: boolean;
  upKind: (patch: Partial<ActKindTexts>) => void;
  up: (patch: Partial<ActTemplate>) => void;
  /** Kursor turgan maydon — o'rinbosar shu yerga qo'yiladi */
  onFocusField: (el: HTMLTextAreaElement | HTMLInputElement | null, apply: ((v: string) => void) | null) => void;
}

/** Bosilsa tahrirlanadigan matn: ko'rinishda — to'ldirilgan, tahrirda — o'rinbosarlar bilan xom matn */
function Editable({
  value,
  onChange,
  render,
  ctx,
  className,
  multiline,
  placeholder,
  onRemove,
  as = 'p',
}: {
  value: string;
  onChange: (v: string) => void;
  render: (v: string) => string;
  ctx: EditCtx;
  className?: string;
  multiline?: boolean;
  placeholder?: string;
  onRemove?: () => void;
  as?: 'p' | 'span';
}) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!editing || !ref.current) return;
    const el = ref.current;
    el.focus();
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
    ctx.onFocusField(el, onChange);
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const Tag = as;
  if (!ctx.editable) return value.trim() ? <Tag className={className}>{render(value)}</Tag> : null;
  if (editing) {
    return (
      <span className={cn('relative block', as === 'span' && 'inline-block min-w-[8rem] align-top')}>
        <textarea
          ref={ref}
          value={value}
          rows={1}
          placeholder={placeholder}
          onChange={(e) => {
            onChange(multiline ? e.target.value : e.target.value.replace(/\n/g, ' '));
            e.target.style.height = 'auto';
            e.target.style.height = `${e.target.scrollHeight}px`;
          }}
          onFocus={(e) => ctx.onFocusField(e.target, onChange)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || (e.key === 'Enter' && !multiline)) {
              e.preventDefault();
              (e.target as HTMLTextAreaElement).blur();
            }
          }}
          className={cn('block w-full resize-none rounded-sm bg-amber-50 px-1 font-serif text-[12.5px] leading-snug text-black outline-none ring-2 ring-brand-400', className)}
        />
      </span>
    );
  }
  const shown = render(value);
  return (
    <Tag
      role="button"
      tabIndex={0}
      title="Bosing — tahrirlash"
      onClick={() => setEditing(true)}
      onKeyDown={(e) => (e.key === 'Enter' ? setEditing(true) : undefined)}
      className={cn('group/ed relative cursor-text rounded-sm outline-none transition-colors hover:bg-brand-50 hover:ring-1 hover:ring-brand-200 focus-visible:ring-2 focus-visible:ring-brand-400', !shown.trim() && 'text-gray-300 italic', className)}
    >
      {shown.trim() ? shown : placeholder || '(bo‘sh)'}
      {onRemove && (
        <span
          role="button"
          tabIndex={-1}
          title="Xatboshini o'chirish"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="absolute -right-6 top-0 hidden size-5 items-center justify-center rounded bg-red-50 text-xs font-bold not-italic text-red-600 group-hover/ed:flex"
        >
          ×
        </span>
      )}
    </Tag>
  );
}

/** Ro'yxatli matn (tomonlar, yakuniy gaplar, imzolar): har qator — alohida xatboshi, qo'shish / o'chirish */
function EditableLines({
  lines,
  onChange,
  render,
  ctx,
  addLabel,
  itemClass,
  renderItem,
}: {
  lines: string[];
  onChange: (v: string[]) => void;
  render: (v: string) => string;
  ctx: EditCtx;
  addLabel: string;
  itemClass?: string;
  renderItem?: (text: string, i: number) => ReactNode;
}) {
  return (
    <>
      {lines.map((line, i) =>
        !ctx.editable && renderItem ? (
          line.trim() ? <span key={i}>{renderItem(line, i)}</span> : null
        ) : (
          <Editable
            key={i}
            value={line}
            ctx={ctx}
            render={render}
            className={itemClass}
            onChange={(v) => onChange(lines.map((x, j) => (j === i ? v : x)))}
            onRemove={() => onChange(lines.filter((_, j) => j !== i))}
            placeholder="Matn yozing…"
          />
        ),
      )}
      {ctx.editable && (
        <button type="button" onClick={() => onChange([...lines, ''])} className="my-0.5 rounded border border-dashed border-brand-300 px-2 py-0.5 font-sans text-[11px] font-semibold text-brand-700 hover:bg-brand-50">
          + {addLabel}
        </button>
      )}
    </>
  );
}

function Paper({ t, kind, ctx }: { t: ActTemplate; kind: DocKind; ctx: EditCtx }) {
  const k = t.kinds[kind];
  const v = sampleVars(t, kind);
  const f = (s: string) => s.replace(/\{(\w+)\}/g, (m, key: string) => v[key] ?? m);
  const raw = (s: string) => s;
  const sig = (text: string) => {
    const at = text.indexOf(':');
    return (
      <span className="flex justify-between gap-4">
        <b>{at > 0 ? text.slice(0, at + 1) : text}</b>
        {at > 0 && <span className="whitespace-nowrap">__________ {text.slice(at + 1).trim()}</span>}
      </span>
    );
  };
  return (
    <div className={cn('mx-auto max-w-[640px] bg-white px-8 py-7 font-serif text-[12.5px] leading-snug text-black shadow-card ring-1 ring-black/5', ctx.editable && 'pr-10')}>
      <div className="ml-auto w-[48%] space-y-0">
        <Editable value={t.approveHeading} ctx={ctx} render={raw} className="font-bold" onChange={(x) => ctx.up({ approveHeading: x })} placeholder="“ТАСДИҚЛАЙМАН”" />
        <Editable value={t.company} ctx={ctx} render={raw} onChange={(x) => ctx.up({ company: x })} placeholder="Tashkilot" />
        <Editable value={t.approverPosition} ctx={ctx} render={raw} onChange={(x) => ctx.up({ approverPosition: x })} placeholder="Rahbar lavozimi" />
        <p title={t.approverPinfl ? "Xodimlar bo'limidan — «Asosiy» rejimda almashtiriladi" : undefined}>
          ____________ {person(t, t.approverName || '…')}
          {ctx.editable && t.approverPinfl && <span className="ml-1 align-middle font-sans text-[9px] font-semibold text-emerald-600">●</span>}
        </p>
        <p>{t.approveDate === 'doc' ? '“19” октябрь 2026-йил' : '“___” _______ 20___-йил'}</p>
      </div>
      <Editable value={k.title} ctx={ctx} render={f} className="mt-4 text-center font-bold" onChange={(x) => ctx.upKind({ title: x })} placeholder="Sarlavha" />
      <Editable value={k.title2} ctx={ctx} render={f} className="text-center font-bold" onChange={(x) => ctx.upKind({ title2: x })} placeholder="ДАЛОЛАТНОМАСИ" />
      <p className="mt-2 flex justify-between">
        <span>{t.actDate === 'doc' ? '“19” октябрь 2026 йил' : '“___” _______ 2026 йил'}</span>
        <Editable as="span" value={t.city} ctx={ctx} render={raw} onChange={(x) => ctx.up({ city: x })} placeholder="Shahar" />
      </p>
      <div className="mt-2 space-y-0.5 indent-8">
        <Editable value={k.intro} ctx={ctx} render={f} onChange={(x) => ctx.upKind({ intro: x })} placeholder="Kirish gapi" />
        <EditableLines lines={k.parties} onChange={(parties) => ctx.upKind({ parties })} render={f} ctx={ctx} addLabel="tomon qo'shish" renderItem={(x) => <p>{f(x)}</p>} />
        <Editable value={k.lead} ctx={ctx} render={f} className="pt-1" onChange={(x) => ctx.upKind({ lead: x })} placeholder="Jadvaldan oldingi gap" />
      </div>
      <table className="mt-2 w-full border-collapse text-[11px]">
        <thead>
          <tr>
            {t.columns.map((c, i) => (
              <th key={i} className="border border-black px-1 py-0.5 font-bold">
                <Editable as="span" value={c} ctx={ctx} render={raw} onChange={(x) => ctx.up({ columns: t.columns.map((y, j) => (j === i ? x : y)) })} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="text-center">
            <td className="border border-black px-1">1</td>
            <td className="border border-black px-1 text-left">Моноблок-38 (HP pavilion)</td>
            <td className="border border-black px-1">00003860</td>
            <td className="border border-black px-1">
              <Editable as="span" value={t.unitDefault} ctx={ctx} render={raw} onChange={(x) => ctx.up({ unitDefault: x })} />
            </td>
            <td className="border border-black px-1">1</td>
            <td className="border border-black px-1">23 522 560</td>
            <td className="border border-black px-1">
              <Editable as="span" value={t.conditionDefault} ctx={ctx} render={raw} onChange={(x) => ctx.up({ conditionDefault: x })} />
            </td>
          </tr>
          <tr className="text-center font-bold">
            <td className="border border-black" />
            <td className="border border-black px-1 text-left">
              <Editable as="span" value={t.totalLabel} ctx={ctx} render={raw} onChange={(x) => ctx.up({ totalLabel: x })} />
            </td>
            <td className="border border-black" />
            <td className="border border-black" />
            <td className="border border-black px-1">1</td>
            <td className="border border-black px-1">23 522 560</td>
            <td className="border border-black" />
          </tr>
        </tbody>
      </table>
      <div className="mt-2 space-y-0.5 text-justify indent-8">
        <EditableLines lines={k.closing} onChange={(closing) => ctx.upKind({ closing })} render={f} ctx={ctx} addLabel="xatboshi qo'shish" renderItem={(x) => <p>{f(x)}</p>} />
        {(k.liability || ctx.editable) && (
          <Editable value={k.liability} ctx={ctx} render={f} multiline className="pt-1" onChange={(x) => ctx.upKind({ liability: x })} placeholder="Moddiy javobgarlik gapi (bo'sh — chiqmaydi)" />
        )}
      </div>
      <div className="mt-3 space-y-2">
        <EditableLines lines={k.signatures} onChange={(signatures) => ctx.upKind({ signatures })} render={f} ctx={ctx} addLabel="imzo qatori qo'shish" renderItem={(x) => <p>{sig(f(x))}</p>} />
      </div>
      {(t.agreed.length > 0 || ctx.editable) && (
        <div className="mt-3 space-y-1.5">
          <Editable value={t.agreedHeading} ctx={ctx} render={raw} className="font-bold" onChange={(x) => ctx.up({ agreedHeading: x })} />
          {t.agreed.map((a, i) => (
            <p key={i} className="flex justify-between gap-4">
              <Editable as="span" value={a.title} ctx={ctx} render={(x) => `${x}:`} onChange={(x) => ctx.up({ agreed: t.agreed.map((y, j) => (j === i ? { ...y, title: x } : y)) })} placeholder="Lavozim" />
              <span className="whitespace-nowrap">__________ {person(t, a.name || '…')}</span>
            </p>
          ))}
          {ctx.editable && t.agreed.length === 0 && <p className="font-sans text-[11px] text-gray-400">Kelishuvchilar «Asosiy» rejimda qo&apos;shiladi</p>}
        </div>
      )}
      {t.footer && <p className="mt-4 text-[9px] text-gray-400">№ {v.number} · «Korxona tahlil»</p>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Asosiy rejim: imzochilar (Xodimlar bo'limidan)
// ═══════════════════════════════════════════════════════════

const pickName = (e: EmployeeOption) => e.fullName;

function SignersEditor({ value, onChange, disabled, addLabel = "Kelishuvchi qo'shish" }: { value: SignerT[]; onChange: (v: SignerT[]) => void; disabled: boolean; addLabel?: string }) {
  return (
    <div className="space-y-1.5">
      {value.map((s, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)_auto] gap-1.5">
          <input className={FIELD} value={s.title} disabled={disabled} placeholder="Lavozim (Бош бухгалтер)" onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
          <EmployeePick
            pinfl={s.pinfl}
            name={s.name}
            disabled={disabled}
            onPick={(e) => onChange(value.map((x, j) => (j === i ? { title: x.title || e.position || '', name: pickName(e), pinfl: e.pinfl } : x)))}
          />
          {!disabled ? (
            <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="shrink-0 rounded px-2 text-(--color-text-muted) hover:bg-red-50 hover:text-red-600" aria-label="O'chirish">
              <IconTrash className="size-4" />
            </button>
          ) : (
            <span />
          )}
        </div>
      ))}
      {!disabled && (
        <button type="button" onClick={() => onChange([...value, { title: '', name: '', pinfl: null }])} className="text-xs font-semibold text-brand-700 hover:underline">
          + {addLabel}
        </button>
      )}
    </div>
  );
}

/** Ro'yxatdan tanlanmagan (qo'lda yozilgan) ismlar — eski shablondan qolgan */
function unlinked(t: ActTemplate): number {
  let n = 0;
  if (t.approverName && !t.approverPinfl) n += 1;
  if (t.storekeeperName && !t.storekeeperPinfl) n += 1;
  n += t.agreed.filter((a) => a.name && !a.pinfl).length;
  return n;
}

// ═══════════════════════════════════════════════════════════
// Muharrir
// ═══════════════════════════════════════════════════════════

export function ActTemplateEditor() {
  const { canWrite } = useAuth();
  const editable = canWrite('/ombor');
  const loaded = useAsync(() => Promise.all([warehouseApi.actTemplate(), warehouseApi.lookups()]).then(([t, l]) => ({ t: t.data, regions: l.data.regions })), []);
  const [t, setT] = useState<ActTemplate | null>(null);
  const [saved, setSaved] = useState<string>('');
  const [mode, setMode] = useState<Mode>(() => {
    try {
      return (localStorage.getItem('ombor.shablon.mode') as Mode) || 'basic';
    } catch {
      return 'basic';
    }
  });
  const [kind, setKind] = useState<DocKind>('ISSUE');
  const [region, setRegion] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  /** Tasdiqlash oynasi: saqlanadigan shablon */
  const [approveTpl, setApproveTpl] = useState<ActTemplate | null>(null);
  const approval = useAsync(() => warehouseApi.templateApproval(), []);
  /** O'rinbosar qo'yish: oxirgi tahrirlangan maydon */
  const active = useRef<{ el: HTMLTextAreaElement | HTMLInputElement; apply: (v: string) => void } | null>(null);

  useEffect(() => {
    if (loaded.data && !t) {
      setT(loaded.data.t);
      setSaved(JSON.stringify(loaded.data.t));
    }
  }, [loaded.data, t]);

  useEffect(() => {
    try {
      localStorage.setItem('ombor.shablon.mode', mode);
    } catch {
      // brauzer xotirasi yopiq
    }
  }, [mode]);

  const dirty = t ? JSON.stringify(t) !== saved : false;
  const regions = useMemo(() => (loaded.data?.regions ?? []).filter((r) => r.code !== 0), [loaded.data]);
  const regionName = (code: string) => regions.find((r) => String(r.code) === code)?.name ?? `Hudud ${code}`;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (loaded.error) return <ErrorState message={loaded.error} onRetry={loaded.reload} />;
  if (!t) return <LoadingState />;

  const up = (patch: Partial<ActTemplate>) => setT((x) => (x ? { ...x, ...patch } : x));
  const upKind = (patch: Partial<ActKindTexts>) => setT((x) => (x ? { ...x, kinds: { ...x.kinds, [kind]: { ...x.kinds[kind], ...patch } } } : x));
  const upRegion = (code: string, patch: Partial<ActRegionOverride>) => setT((x) => (x ? { ...x, regions: { ...x.regions, [code]: { ...x.regions[code], ...patch } } } : x));
  const ro = !editable;

  const ctx: EditCtx = {
    editable: mode === 'full' && editable,
    up,
    upKind,
    onFocusField: (el, apply) => {
      active.current = el && apply ? { el, apply } : null;
    },
  };

  /** O'rinbosarni kursor turgan joyga qo'yish */
  const insertVar = (code: string) => {
    const a = active.current;
    if (!a || !document.body.contains(a.el)) {
      setToast('Avval qog‘ozdagi matnni bosing — o‘rinbosar kursor turgan joyga qo‘yiladi');
      return;
    }
    const el = a.el;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const next = el.value.slice(0, start) + code + el.value.slice(end);
    a.apply(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + code.length, start + code.length);
    });
  };

  /** «Tasdiqlash»: shablon rahbar tasdiqlagandan keyin saqlanadi (QR → imzo → Saqlash) */
  const save = () => {
    setErr(null);
    {
      const clean: ActTemplate = {
        ...t,
        kinds: Object.fromEntries(
          Object.entries(t.kinds).map(([key, v]) => [key, { ...v, parties: v.parties.filter((s) => s.trim()), closing: v.closing.filter((s) => s.trim()), signatures: v.signatures.filter((s) => s.trim()) }]),
        ) as ActTemplate['kinds'],
        agreed: t.agreed.filter((a) => a.title.trim() || a.name.trim() || a.pinfl),
      };
      setApproveTpl(clean);
    }
  };

  const sample = async (sk: DocKind, rc: string) => {
    setBusy(`s:${sk}:${rc}`);
    setErr(null);
    try {
      await downloadActSample(sk, rc ? Number(rc) : null, t);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const regionCodes = Object.keys(t.regions).sort((a, b) => Number(a) - Number(b));
  const loose = unlinked(t);

  const modeSwitch = (
    <div className="inline-flex gap-0.5 rounded-xl bg-(--color-surface-sunken) p-1">
      {(
        [
          ['basic', 'Asosiy', "Ismlar va asosiy joylar"],
          ['full', "To'liq matn", "Dalolatnomani so'zma-so'z"],
        ] as const
      ).map(([value, label, hint]) => (
        <button
          key={value}
          type="button"
          onClick={() => setMode(value)}
          className={cn('rounded-lg px-4 py-2 text-left transition-colors', mode === value ? 'bg-white shadow-sm' : 'text-(--color-text-muted) hover:text-(--color-text)')}
        >
          <span className="block text-sm font-semibold">
            {value === 'basic' ? '1' : '2'}. {label}
          </span>
          <span className="block text-[11px] text-(--color-text-muted)">{hint}</span>
        </button>
      ))}
    </div>
  );

  const preview = (
    <div className={cn(mode === 'basic' && 'xl:sticky xl:top-24 xl:self-start')}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-heading">{mode === 'full' ? 'Dalolatnoma — bosib tahrirlang' : "Ko'rinishi"}</p>
        <span className="text-xs text-(--color-text-muted)">
          {KINDS.find((x) => x.value === kind)?.label}
          {region ? ` · ${regionName(region)}` : ''}
        </span>
        <Button variant="secondary" size="sm" className="ml-auto" loading={busy === `s:${kind}:${region}`} onClick={() => sample(kind, region)}>
          Namuna (Word)
        </Button>
      </div>
      {mode === 'basic' && <SubTabs value={kind} options={KINDS} onChange={setKind} className="mb-2" />}
      <div className={cn('overflow-y-auto rounded-xl bg-(--color-surface-muted) p-4', mode === 'basic' && 'max-h-[calc(100vh-11rem)]')}>
        <Paper t={resolve(t, region)} kind={kind} ctx={ctx} />
      </div>
      <p className="mt-2 text-[11px] text-(--color-text-faint)">Namunadagi oluvchi va vosita — misol. Haqiqiy dalolatnomada hujjatdagi xodim, vositalar, inventar raqamlari va holati chiqadi.</p>
    </div>
  );

  return (
    <div className="flex flex-col gap-5 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {modeSwitch}
        {loose > 0 && (
          <p className="max-w-md rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
            {loose} ta ism qo&apos;lda yozilgan (ro&apos;yxatdan tanlanmagan). «Asosiy» rejimda Xodimlar bo&apos;limidan tanlang — dalolatnomada ism o&apos;sha xodimdan olinadi.
          </p>
        )}
      </div>

      {/* Saqlash paneli (pastda yopishgan) */}
      <div className={cn('sticky bottom-3 z-20 order-last flex flex-wrap items-center gap-2 rounded-xl px-4 py-3 shadow-card backdrop-blur', dirty ? 'bg-amber-50/95 ring-1 ring-amber-200' : 'bg-white/95')}>
        <div className="mr-auto min-w-0">
          <p className="text-sm text-(--color-text-muted)">
            {dirty ? <span className="font-semibold text-(--color-warn)">Saqlanmagan o&apos;zgarishlar bor — rahbar tasdiqlagach saqlanadi</span> : "Hamma ombor dalolatnomalari shu shablon bo'yicha chiqadi"}
            {regionCodes.length > 0 && ` · ${regionCodes.length} ta hudud alohida`}
          </p>
          {approval.data?.data && (
            <p className="text-[11px] text-(--color-text-faint)">
              Oxirgi tasdiq: <span className="font-medium text-emerald-700">{approval.data.data.signerName}</span> · {formatDateTime(approval.data.data.savedAt)} · {approval.data.data.method === 'PHOTO' ? 'yuz surati' : 'imzo'} ·{' '}
              <button type="button" className="font-semibold text-brand-700 hover:underline" onClick={() => void downloadSignArchive(approval.data!.data!.id, 'Dalolatnoma shabloni - tasdiqlangan.docx').catch((e) => setErr(errorMessage(e)))}>
                Word
              </button>
            </p>
          )}
        </div>
        {editable && (
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirmReset(true)}>
              Standartga qaytarish
            </Button>
            <Button variant="secondary" size="sm" disabled={!dirty} onClick={() => setT(JSON.parse(saved) as ActTemplate)}>
              Bekor qilish
            </Button>
            <Button size="sm" disabled={!dirty} onClick={save} title="Rahbar QR kod orqali tasdiqlagach saqlanadi">
              Tasdiqlash (QR kod)
            </Button>
          </>
        )}
      </div>
      {err && <p className="rounded-(--radius-control) bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}

      {mode === 'full' ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
          <div className="space-y-3">
            <SubTabs value={kind} options={KINDS} onChange={setKind} />
            {preview}
          </div>
          <div className="space-y-4 xl:sticky xl:top-24 xl:self-start">
            <Card>
              <CardHeader title="O'rinbosarlar" description="Matnni bosing, so'ng kerakligini tanlang — kursor turgan joyga qo'yiladi" />
              <div className="flex flex-wrap gap-1.5 p-4">
                {VARS.map(([code, label]) => (
                  <button
                    key={code}
                    type="button"
                    disabled={ro}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => insertVar(code)}
                    className="rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-[11px] text-brand-800 hover:bg-brand-100 disabled:opacity-50"
                    title={code}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </Card>
            <Card>
              <CardHeader title="Qanday tahrirlanadi" />
              <ul className="list-disc space-y-1 px-8 pb-4 text-xs text-(--color-text-muted)">
                <li>Istalgan qatorni bosing — so&apos;zlarni almashtiring; Enter yoki tashqariga bosish — tayyor.</li>
                <li>Qator ustiga kelganda o&apos;ngda «×» — xatboshini o&apos;chirish; «+» tugmalar — yangi qo&apos;shish.</li>
                <li>Jadval sarlavhalari, «Жами», o&apos;lchov birligi va holat ham shu yerda bosib almashtiriladi.</li>
                <li>Ismlar (rahbar, omborchi, kelishuvchilar) — «Asosiy» rejimda, Xodimlar bo&apos;limidan.</li>
                <li>Har hujjat turi o&apos;z matniga ega — yuqoridagi yorliqlardan tanlang.</li>
              </ul>
              <div className="space-y-2 border-t border-(--color-line) px-4 py-3">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4" disabled={ro} checked={t.footer} onChange={(e) => up({ footer: e.target.checked })} />
                  Pastki belgi (hujjat raqami)
                </label>
              </div>
            </Card>
          </div>
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,600px)]">
          <div className="space-y-5">
            {/* Tasdiqlovchi */}
            <Card>
              <CardHeader title="Tasdiqlovchi rahbar" description="O'ng yuqori «ТАСДИҚЛАЙМАН» bloki — ism Xodimlar bo'limidan olinadi" />
              <div className="grid gap-3 p-5 sm:grid-cols-2">
                <Field label="Rahbar" wide>
                  <EmployeePick
                    pinfl={t.approverPinfl}
                    name={t.approverName}
                    disabled={ro}
                    onPick={(e) => up({ approverPinfl: e.pinfl, approverName: pickName(e), approverPosition: t.approverPosition || e.position || '' })}
                    onClear={() => up({ approverPinfl: null })}
                  />
                </Field>
                <Field label="Rahbar lavozimi (dalolatnomada)" hint="Masalan: «директори»">
                  <input className={FIELD} disabled={ro} value={t.approverPosition} onChange={(e) => up({ approverPosition: e.target.value })} />
                </Field>
                <Field label="Tashkilot">
                  <input className={FIELD} disabled={ro} value={t.company} onChange={(e) => up({ company: e.target.value })} />
                </Field>
                <Field label="Tasdiqlash sanasi">
                  <select className={FIELD} disabled={ro} value={t.approveDate} onChange={(e) => up({ approveDate: e.target.value as 'doc' | 'blank' })}>
                    <option value="doc">Hujjat sanasi («“06” июль 2026-йил»)</option>
                    <option value="blank">Bo&apos;sh — qo&apos;lda yoziladi</option>
                  </select>
                </Field>
              </div>
            </Card>

            {/* Omborchi va joy */}
            <Card>
              <CardHeader title="Omborchi va joy" description="Topshiruvchi omborchi, shahar, sana va ismlar yozilishi" />
              <div className="grid gap-3 p-5 sm:grid-cols-2">
                <Field label="Omborchi" hint="Tanlanmasa — hujjatni kiritgan omborchi">
                  <EmployeePick
                    pinfl={t.storekeeperPinfl}
                    name={t.storekeeperName}
                    disabled={ro}
                    onPick={(e) => up({ storekeeperPinfl: e.pinfl, storekeeperName: pickName(e) })}
                    onClear={() => up({ storekeeperPinfl: null, storekeeperName: '' })}
                  />
                </Field>
                <Field label="Omborchi lavozimi" hint="Imzolarda: «Топширувчи (омбор мудири)»">
                  <input className={FIELD} disabled={ro} value={t.storekeeperTitle} onChange={(e) => up({ storekeeperTitle: e.target.value })} />
                </Field>
                <Field label="Shahar">
                  <input className={FIELD} disabled={ro} value={t.city} onChange={(e) => up({ city: e.target.value })} />
                </Field>
                <Field label="Dalolatnoma sanasi">
                  <select className={FIELD} disabled={ro} value={t.actDate} onChange={(e) => up({ actDate: e.target.value as 'doc' | 'blank' })}>
                    <option value="blank">Bo&apos;sh — «“___” _______ 2026 йил»</option>
                    <option value="doc">Hujjat sanasi</option>
                  </select>
                </Field>
                <Field label="Ismlar">
                  <select className={FIELD} disabled={ro} value={`${t.shortNames ? 's' : 'f'}${t.namesScript}`} onChange={(e) => up({ shortNames: e.target.value.startsWith('s'), namesScript: e.target.value.endsWith('cyrl') ? 'cyrl' : 'asis' })}>
                    <option value="scyrl">Qisqa, kirillda — «Акбаров Ф.»</option>
                    <option value="sasis">Qisqa, yozilganidek — «Akbarov F.»</option>
                    <option value="fcyrl">To&apos;liq, kirillda</option>
                    <option value="fasis">To&apos;liq, yozilganidek</option>
                  </select>
                </Field>
                <Field label="Holati (standart)" hint="Vosita uchun holat yozilmasa">
                  <input className={FIELD} disabled={ro} value={t.conditionDefault} onChange={(e) => up({ conditionDefault: e.target.value })} />
                </Field>
              </div>
            </Card>

            {/* Kelishildi */}
            <Card>
              <CardHeader title="«Келишилди» — kelishuvchilar" description="Lavozim va xodim (Xodimlar bo'limidan). Lavozim bo'sh qolsa — xodimning lavozimi yoziladi." />
              <div className="space-y-3 p-5">
                <SignersEditor value={t.agreed} onChange={(agreed) => up({ agreed })} disabled={ro} />
              </div>
            </Card>

            {/* Hududlar */}
            <Card>
              <CardHeader
                title="Hududlar"
                description="Hududga berilgan / hududdan qaytgan hujjatlar shu hudud ma'lumotlari bilan chiqadi. Bo'sh maydon — umumiy shablondagisi."
                actions={
                  editable && (
                    <select
                      className="h-9 rounded-(--radius-control) border border-(--color-line-strong) bg-white px-2 text-sm"
                      value=""
                      onChange={(e) => {
                        if (!e.target.value) return;
                        upRegion(e.target.value, {});
                        setRegion(e.target.value);
                      }}
                    >
                      <option value="">+ Hudud qo&apos;shish</option>
                      {regions
                        .filter((r) => !t.regions[String(r.code)])
                        .map((r) => (
                          <option key={r.code} value={r.code}>
                            {r.name}
                          </option>
                        ))}
                    </select>
                  )
                }
              />
              <div className="divide-y divide-(--color-line)">
                {regionCodes.length === 0 && <p className="px-5 py-5 text-sm text-(--color-text-muted)">Hamma hududlar umumiy shablon bilan. Hudud rahbari yoki omborchisi boshqa bo&apos;lsa — qo&apos;shing.</p>}
                {regionCodes.map((code) => {
                  const o = t.regions[code]!;
                  return (
                    <div key={code} className={cn('space-y-3 px-5 py-4', region === code && 'bg-brand-50/40')}>
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => setRegion(region === code ? '' : code)} className="text-sm font-semibold text-heading hover:text-brand-700">
                          {regionName(code)}
                        </button>
                        <span className="text-xs text-(--color-text-muted)">{region === code ? "· o'ngda ko'rinishi" : "· bosing — ko'rinishi"}</span>
                        {editable && (
                          <button
                            type="button"
                            onClick={() => {
                              const rest = { ...t.regions };
                              delete rest[code];
                              up({ regions: rest });
                              if (region === code) setRegion('');
                            }}
                            className="ml-auto rounded p-1.5 text-(--color-text-muted) hover:bg-red-50 hover:text-red-600"
                            aria-label="Hududni olib tashlash"
                          >
                            <IconTrash className="size-4" />
                          </button>
                        )}
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Field label="Hudud rahbari">
                          <EmployeePick
                            pinfl={o.approverPinfl}
                            name={o.approverName ?? ''}
                            disabled={ro}
                            placeholder={`Umumiy: ${t.approverName}`}
                            onPick={(e) => upRegion(code, { approverPinfl: e.pinfl, approverName: pickName(e) })}
                            onClear={() => upRegion(code, { approverPinfl: undefined, approverName: undefined })}
                          />
                        </Field>
                        <Field label="Rahbar lavozimi">
                          <input className={FIELD} disabled={ro} value={o.approverPosition ?? ''} placeholder={t.approverPosition} onChange={(e) => upRegion(code, { approverPosition: e.target.value })} />
                        </Field>
                        <Field label="Hudud omborchisi">
                          <EmployeePick
                            pinfl={o.storekeeperPinfl}
                            name={o.storekeeperName ?? ''}
                            disabled={ro}
                            placeholder={`Umumiy: ${t.storekeeperName || 'hujjatni kiritgan'}`}
                            onPick={(e) => upRegion(code, { storekeeperPinfl: e.pinfl, storekeeperName: pickName(e) })}
                            onClear={() => upRegion(code, { storekeeperPinfl: undefined, storekeeperName: undefined })}
                          />
                        </Field>
                        <Field label="Omborchi lavozimi">
                          <input className={FIELD} disabled={ro} value={o.storekeeperTitle ?? ''} placeholder={t.storekeeperTitle} onChange={(e) => upRegion(code, { storekeeperTitle: e.target.value })} />
                        </Field>
                        <Field label="Tashkilot">
                          <input className={FIELD} disabled={ro} value={o.company ?? ''} placeholder={t.company} onChange={(e) => upRegion(code, { company: e.target.value })} />
                        </Field>
                        <Field label="Shahar">
                          <input className={FIELD} disabled={ro} value={o.city ?? ''} placeholder={t.city} onChange={(e) => upRegion(code, { city: e.target.value })} />
                        </Field>
                      </div>
                      <div>
                        <p className="mb-1 text-xs font-medium text-(--color-text-muted)">Kelishuvchilar (bo&apos;sh — umumiy ro&apos;yxat)</p>
                        <SignersEditor value={o.agreed ?? []} onChange={(agreed) => upRegion(code, { agreed })} disabled={ro} addLabel="Hudud kelishuvchisi" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
          {preview}
        </div>
      )}

      <ConfirmDialog
        open={confirmReset}
        title="Standart shablonga qaytarish"
        message="Hamma o'zgarishlar (hududlar ham) o'chadi va namunadagi «Солиқ-сервис» shabloni tiklanadi."
        confirmLabel="Qaytarish"
        danger
        onCancel={() => setConfirmReset(false)}
        onConfirm={async () => {
          const r = await warehouseApi.resetActTemplate();
          setT(r.data);
          setSaved(JSON.stringify(r.data));
          setConfirmReset(false);
          setToast('Standart shablon tiklandi');
        }}
      />
      <TemplateApproveDialog
        template={approveTpl}
        onClose={() => setApproveTpl(null)}
        onSaved={(nt) => {
          setT(nt);
          setSaved(JSON.stringify(nt));
          setApproveTpl(null);
          approval.reload();
          setToast('Shablon tasdiqlandi va saqlandi — nusxasi Telegramga yuborildi');
        }}
      />
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}