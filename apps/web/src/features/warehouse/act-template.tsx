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
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { downloadActSample, warehouseApi, type ActKindTexts, type ActRegionOverride, type ActTemplate, type DocKind, type SignerT } from './api';

// ═══════════════════════════════════════════════════════════
// Ombor › Dalolatnoma shabloni.
// Hamma dalolatnomalar (berish, qaytarish, boshqaga o'tkazish, hisobdan chiqarish, kirim) shu shablon bo'yicha chiqadi:
// tasdiqlovchi, tashkilot, shahar, omborchi, «Келишилди», matnlar, jadval ustunlari, ismlar yozilishi.
// Hududlar uchun alohida tasdiqlovchi / shahar / omborchi / kelishuvchilar — hudud hujjatlari doim o'z shabloni bilan.
// O'ngda — jonli ko'rinish; «Namuna (Word)» — saqlanmagan o'zgarishlar bilan ham yuklab olinadi.
// ═══════════════════════════════════════════════════════════

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
const AREA = 'w-full rounded-(--radius-control) border border-(--color-line-strong) bg-white px-2.5 py-2 text-sm leading-relaxed focus:border-brand-600 disabled:bg-(--color-surface-muted)';

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
    company: o.company || t.company,
    city: o.city || t.city,
    storekeeperTitle: o.storekeeperTitle || t.storekeeperTitle,
    storekeeperName: o.storekeeperName || t.storekeeperName,
    agreed: o.agreed?.length ? o.agreed : t.agreed,
  };
}

/** Jonli ko'rinish — Word dalolatnomaning soddalashtirilgan nusxasi */
function Paper({ t, kind }: { t: ActTemplate; kind: DocKind }) {
  const k = t.kinds[kind];
  const store = person(t, t.storekeeperName || 'Omborchi');
  const emp = person(t, 'AKBAROV FARRUX OTABEKOVICH');
  const emp2 = person(t, 'BASHARATOV ABDUMALIK');
  const v: Record<string, string> = {
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
  const f = (s: string) => s.replace(/\{(\w+)\}/g, (m, key: string) => v[key] ?? m);
  return (
    <div className="mx-auto max-w-[620px] bg-white px-8 py-7 font-serif text-[12.5px] leading-snug text-black shadow-card ring-1 ring-black/5">
      <div className="ml-auto w-[46%]">
        <p className="font-bold">{t.approveHeading}</p>
        <p>{t.company}</p>
        <p>{t.approverPosition}</p>
        <p>____________ {t.approverName}</p>
        <p>{t.approveDate === 'doc' ? '“19” октябрь 2026-йил' : '“___” _______ 20___-йил'}</p>
      </div>
      <p className="mt-4 text-center font-bold">{f(k.title)}</p>
      <p className="text-center font-bold">{f(k.title2)}</p>
      <p className="mt-2 flex justify-between">
        <span>{t.actDate === 'doc' ? '“19” октябрь 2026 йил' : '“___” _______ 2026 йил'}</span>
        <span>{t.city}</span>
      </p>
      <div className="mt-2 space-y-0.5 indent-8">
        {k.intro && <p>{f(k.intro)}</p>}
        {k.parties.filter(Boolean).map((p, i) => (
          <p key={i}>{f(p)}</p>
        ))}
        {k.lead && <p className="pt-1">{f(k.lead)}</p>}
      </div>
      <table className="mt-2 w-full border-collapse text-[11px]">
        <thead>
          <tr>
            {t.columns.map((c, i) => (
              <th key={i} className="border border-black px-1 py-0.5 font-bold">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="text-center">
            <td className="border border-black px-1">1</td>
            <td className="border border-black px-1 text-left">Моноблок-38 (HP pavilion)</td>
            <td className="border border-black px-1">00003860</td>
            <td className="border border-black px-1">{t.unitDefault}</td>
            <td className="border border-black px-1">1</td>
            <td className="border border-black px-1">23 522 560</td>
            <td className="border border-black px-1">{t.conditionDefault}</td>
          </tr>
          <tr className="text-center font-bold">
            <td className="border border-black" />
            <td className="border border-black px-1 text-left">{t.totalLabel}</td>
            <td className="border border-black" />
            <td className="border border-black" />
            <td className="border border-black px-1">1</td>
            <td className="border border-black px-1">23 522 560</td>
            <td className="border border-black" />
          </tr>
        </tbody>
      </table>
      <div className="mt-2 space-y-0.5 text-justify indent-8">
        {k.closing.filter(Boolean).map((p, i) => (
          <p key={i}>{f(p)}</p>
        ))}
        {k.liability && <p className="pt-1">{f(k.liability)}</p>}
      </div>
      <div className="mt-3 space-y-2">
        {k.signatures.filter(Boolean).map((s, i) => {
          const text = f(s);
          const at = text.indexOf(':');
          return (
            <p key={i} className="flex justify-between gap-4">
              <b>{at > 0 ? text.slice(0, at + 1) : text}</b>
              {at > 0 && <span>__________ {text.slice(at + 1).trim()}</span>}
            </p>
          );
        })}
      </div>
      {t.agreed.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <p className="font-bold">{t.agreedHeading}</p>
          {t.agreed.map((a, i) => (
            <p key={i} className="flex justify-between gap-4">
              <span>{a.title}:</span>
              <span>__________ {a.name}</span>
            </p>
          ))}
        </div>
      )}
      {t.footer && <p className="mt-4 text-[9px] text-gray-400">№ {v.number} · «Korxona tahlil»</p>}
    </div>
  );
}

function SignersEditor({ value, onChange, disabled, placeholder }: { value: SignerT[]; onChange: (v: SignerT[]) => void; disabled: boolean; placeholder?: string }) {
  return (
    <div className="space-y-1.5">
      {value.map((s, i) => (
        <div key={i} className="flex gap-1.5">
          <input className={FIELD} value={s.title} disabled={disabled} placeholder="Lavozim (Бош бухгалтер)" onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
          <input className={FIELD} value={s.name} disabled={disabled} placeholder="F.I.Sh. (Эргашов С.)" onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          {!disabled && (
            <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="shrink-0 rounded px-2 text-(--color-text-muted) hover:bg-red-50 hover:text-red-600" aria-label="O'chirish">
              <IconTrash className="size-4" />
            </button>
          )}
        </div>
      ))}
      {!disabled && (
        <button type="button" onClick={() => onChange([...value, { title: '', name: '' }])} className="text-xs font-semibold text-brand-700 hover:underline">
          + {placeholder ?? "Kelishuvchi qo'shish"}
        </button>
      )}
    </div>
  );
}

function Lines({ value, onChange, disabled, rows = 3 }: { value: string[]; onChange: (v: string[]) => void; disabled: boolean; rows?: number }) {
  return <textarea className={AREA} rows={rows} disabled={disabled} value={value.join('\n')} onChange={(e) => onChange(e.target.value.split('\n'))} />;
}

export function ActTemplateEditor() {
  const { canWrite } = useAuth();
  const editable = canWrite('/ombor');
  const loaded = useAsync(() => Promise.all([warehouseApi.actTemplate(), warehouseApi.lookups()]).then(([t, l]) => ({ t: t.data, regions: l.data.regions })), []);
  const [t, setT] = useState<ActTemplate | null>(null);
  const [saved, setSaved] = useState<string>('');
  const [kind, setKind] = useState<DocKind>('ISSUE');
  const [region, setRegion] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (loaded.data && !t) {
      setT(loaded.data.t);
      setSaved(JSON.stringify(loaded.data.t));
    }
  }, [loaded.data, t]);

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
  const k = t.kinds[kind];
  const ro = !editable;

  const save = async () => {
    setBusy('save');
    setErr(null);
    try {
      const clean: ActTemplate = {
        ...t,
        kinds: Object.fromEntries(
          Object.entries(t.kinds).map(([key, v]) => [key, { ...v, parties: v.parties.filter((s) => s.trim()), closing: v.closing.filter((s) => s.trim()), signatures: v.signatures.filter((s) => s.trim()) }]),
        ) as ActTemplate['kinds'],
      };
      const r = await warehouseApi.saveActTemplate(clean);
      setT(r.data);
      setSaved(JSON.stringify(r.data));
      setToast('Shablon saqlandi — yangi dalolatnomalar shu bo‘yicha chiqadi');
    } catch (e) {
      setErr(errorMessage(e, "Saqlab bo'lmadi"));
    } finally {
      setBusy(null);
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

  return (
    <div className="flex flex-col gap-5">
      {/* Saqlash paneli (pastda yopishgan) */}
      <div className={cn('sticky bottom-3 z-20 order-last flex flex-wrap items-center gap-2 rounded-xl px-4 py-3 shadow-card backdrop-blur', dirty ? 'bg-amber-50/95 ring-1 ring-amber-200' : 'bg-white/95')}>
        <div className="mr-auto min-w-0">
          <p className="text-sm text-(--color-text-muted)">
            {dirty ? <span className="font-semibold text-(--color-warn)">Saqlanmagan o&apos;zgarishlar bor</span> : "Hamma ombor dalolatnomalari shu shablon bo'yicha chiqadi"}
            {regionCodes.length > 0 && ` · ${regionCodes.length} ta hudud alohida`}
          </p>
        </div>
        {editable && (
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirmReset(true)}>
              Standartga qaytarish
            </Button>
            <Button variant="secondary" size="sm" disabled={!dirty} onClick={() => setT(JSON.parse(saved) as ActTemplate)}>
              Bekor qilish
            </Button>
            <Button size="sm" loading={busy === 'save'} disabled={!dirty} onClick={save}>
              Saqlash
            </Button>
          </>
        )}
      </div>
      {err && <p className="rounded-(--radius-control) bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,600px)]">
        <div className="space-y-5">
          {/* Tasdiqlash */}
          <Card>
            <CardHeader title="«ТАСДИҚЛАЙМАН» bloki" description="O'ng yuqori burchak: tashkilot, rahbar lavozimi va ismi, sana" />
            <div className="grid gap-3 p-5 sm:grid-cols-2">
              <Field label="Sarlavha">
                <input className={FIELD} disabled={ro} value={t.approveHeading} onChange={(e) => up({ approveHeading: e.target.value })} />
              </Field>
              <Field label="Tashkilot">
                <input className={FIELD} disabled={ro} value={t.company} onChange={(e) => up({ company: e.target.value })} />
              </Field>
              <Field label="Rahbar lavozimi">
                <input className={FIELD} disabled={ro} value={t.approverPosition} onChange={(e) => up({ approverPosition: e.target.value })} />
              </Field>
              <Field label="Rahbar (imzo yonida)">
                <input className={FIELD} disabled={ro} value={t.approverName} onChange={(e) => up({ approverName: e.target.value })} />
              </Field>
              <Field label="Tasdiqlash sanasi">
                <select className={FIELD} disabled={ro} value={t.approveDate} onChange={(e) => up({ approveDate: e.target.value as 'doc' | 'blank' })}>
                  <option value="doc">Hujjat sanasi («“06” июль 2026-йил»)</option>
                  <option value="blank">Bo&apos;sh — qo&apos;lda yoziladi</option>
                </select>
              </Field>
            </div>
          </Card>

          {/* Umumiy */}
          <Card>
            <CardHeader title="Umumiy" description="Shahar, omborchi, jadval, ismlar yozilishi" />
            <div className="grid gap-3 p-5 sm:grid-cols-2">
              <Field label="Shahar (sana qatorining o'ngida)">
                <input className={FIELD} disabled={ro} value={t.city} onChange={(e) => up({ city: e.target.value })} />
              </Field>
              <Field label="Dalolatnoma sanasi">
                <select className={FIELD} disabled={ro} value={t.actDate} onChange={(e) => up({ actDate: e.target.value as 'doc' | 'blank' })}>
                  <option value="blank">Bo&apos;sh — «“___” _______ 2026 йил»</option>
                  <option value="doc">Hujjat sanasi</option>
                </select>
              </Field>
              <Field label="Omborchi lavozimi" hint="Imzolarda: «Топширувчи (омбор мудири)»">
                <input className={FIELD} disabled={ro} value={t.storekeeperTitle} onChange={(e) => up({ storekeeperTitle: e.target.value })} />
              </Field>
              <Field label="Omborchi (topshiruvchi)" hint="Bo'sh qolsa — hujjatdagi «Kim berdi»">
                <input className={FIELD} disabled={ro} value={t.storekeeperName} onChange={(e) => up({ storekeeperName: e.target.value })} />
              </Field>
              <Field label="Holati (standart)" hint="Vosita uchun holat yozilmasa">
                <input className={FIELD} disabled={ro} value={t.conditionDefault} onChange={(e) => up({ conditionDefault: e.target.value })} />
              </Field>
              <Field label="O'lchov birligi (asosiy vosita)">
                <input className={FIELD} disabled={ro} value={t.unitDefault} onChange={(e) => up({ unitDefault: e.target.value })} />
              </Field>
              <Field label="Ismlar">
                <select className={FIELD} disabled={ro} value={`${t.shortNames ? 's' : 'f'}${t.namesScript}`} onChange={(e) => up({ shortNames: e.target.value.startsWith('s'), namesScript: e.target.value.endsWith('cyrl') ? 'cyrl' : 'asis' })}>
                  <option value="scyrl">Qisqa, kirillda — «Акбаров Ф.»</option>
                  <option value="sasis">Qisqa, yozilganidek — «Akbarov F.»</option>
                  <option value="fcyrl">To&apos;liq, kirillda</option>
                  <option value="fasis">To&apos;liq, yozilganidek</option>
                </select>
              </Field>
              <Field label="Pastki belgi">
                <label className="flex h-9 items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4" disabled={ro} checked={t.footer} onChange={(e) => up({ footer: e.target.checked })} />
                  Hujjat raqami va dastur nomi (kichik, kulrang)
                </label>
              </Field>
            </div>
            <div className="border-t border-(--color-line) px-5 py-4">
              <p className="mb-2 text-xs font-medium text-(--color-text-muted)">Jadval ustunlari (7 ta, tartibi o&apos;zgarmaydi)</p>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {t.columns.map((c, i) => (
                  <input key={i} className={FIELD} disabled={ro} value={c} onChange={(e) => up({ columns: t.columns.map((x, j) => (j === i ? e.target.value : x)) })} />
                ))}
                <input className={FIELD} disabled={ro} value={t.totalLabel} title="Jami qatori" onChange={(e) => up({ totalLabel: e.target.value })} />
              </div>
            </div>
          </Card>

          {/* Kelishildi */}
          <Card>
            <CardHeader title="«Келишилди»" description="Pastdagi kelishuvchilar — hamma dalolatnomalarda" />
            <div className="space-y-3 p-5">
              <Field label="Sarlavha">
                <input className={FIELD} disabled={ro} value={t.agreedHeading} onChange={(e) => up({ agreedHeading: e.target.value })} />
              </Field>
              <SignersEditor value={t.agreed} onChange={(agreed) => up({ agreed })} disabled={ro} />
            </div>
          </Card>

          {/* Hujjat turlari */}
          <Card>
            <CardHeader title="Matnlar — hujjat turi bo'yicha" description="Har bir qator alohida xatboshi. O'rinbosarlar o'z-o'zidan to'ladi." />
            <div className="space-y-3 p-5">
              <SubTabs value={kind} options={KINDS} onChange={setKind} />
              <div className="flex flex-wrap gap-1.5 rounded-(--radius-control) bg-(--color-surface-muted) px-3 py-2 text-[11px] text-(--color-text-muted)">
                {VARS.map(([code, label]) => (
                  <span key={code}>
                    <code className="font-semibold text-brand-700">{code}</code> — {label}
                  </span>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Sarlavha (1-qator)">
                  <input className={FIELD} disabled={ro} value={k.title} onChange={(e) => upKind({ title: e.target.value })} />
                </Field>
                <Field label="Sarlavha (2-qator)">
                  <input className={FIELD} disabled={ro} value={k.title2} onChange={(e) => upKind({ title2: e.target.value })} />
                </Field>
                <Field label="Kirish" wide>
                  <input className={FIELD} disabled={ro} value={k.intro} onChange={(e) => upKind({ intro: e.target.value })} />
                </Field>
                <Field label="Tomonlar" wide hint="Har qator — bitta tomon">
                  <Lines value={k.parties} onChange={(parties) => upKind({ parties })} disabled={ro} />
                </Field>
                <Field label="Jadvaldan oldin" wide>
                  <input className={FIELD} disabled={ro} value={k.lead} onChange={(e) => upKind({ lead: e.target.value })} />
                </Field>
                <Field label="Jadvaldan keyin" wide>
                  <Lines value={k.closing} onChange={(closing) => upKind({ closing })} disabled={ro} rows={4} />
                </Field>
                <Field label="Moddiy javobgarlik gapi" wide hint="Bo'sh qolsa — chiqmaydi">
                  <textarea className={AREA} rows={2} disabled={ro} value={k.liability} onChange={(e) => upKind({ liability: e.target.value })} />
                </Field>
                <Field label="Imzolar" wide hint="«Lavozim: {ism}» — ikki nuqtagacha qalin, o'ngda imzo chizig'i bilan ism">
                  <Lines value={k.signatures} onChange={(signatures) => upKind({ signatures })} disabled={ro} />
                </Field>
              </div>
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
                      <span className="text-xs text-(--color-text-muted)">{region === code ? "· o'ngda ko'rinishi" : ''}</span>
                      <Button variant="ghost" size="sm" className="ml-auto" loading={busy === `s:${kind}:${code}`} onClick={() => sample(kind, code)}>
                        Namuna (Word)
                      </Button>
                      {editable && (
                        <button
                          type="button"
                          onClick={() => {
                            const rest = { ...t.regions };
                            delete rest[code];
                            up({ regions: rest });
                            if (region === code) setRegion('');
                          }}
                          className="rounded p-1.5 text-(--color-text-muted) hover:bg-red-50 hover:text-red-600"
                          aria-label="Hududni olib tashlash"
                        >
                          <IconTrash className="size-4" />
                        </button>
                      )}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {(
                        [
                          ['approverPosition', 'Rahbar lavozimi', t.approverPosition],
                          ['approverName', 'Rahbar', t.approverName],
                          ['company', 'Tashkilot', t.company],
                          ['city', 'Shahar', t.city],
                          ['storekeeperTitle', 'Omborchi lavozimi', t.storekeeperTitle],
                          ['storekeeperName', 'Omborchi', t.storekeeperName],
                        ] as const
                      ).map(([key, label, fallback]) => (
                        <Field key={key} label={label}>
                          <input className={FIELD} disabled={ro} value={o[key] ?? ''} placeholder={fallback} onChange={(e) => upRegion(code, { [key]: e.target.value })} />
                        </Field>
                      ))}
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-medium text-(--color-text-muted)">Kelishuvchilar (bo&apos;sh — umumiy ro&apos;yxat)</p>
                      <SignersEditor value={o.agreed ?? []} onChange={(agreed) => upRegion(code, { agreed })} disabled={ro} placeholder="Hudud kelishuvchisi" />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        {/* Jonli ko'rinish */}
        <div className="xl:sticky xl:top-24 xl:self-start">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-heading">Ko&apos;rinishi</p>
            <span className="text-xs text-(--color-text-muted)">
              {KINDS.find((x) => x.value === kind)?.label}
              {region ? ` · ${regionName(region)}` : ''}
            </span>
            <Button variant="secondary" size="sm" className="ml-auto" loading={busy === `s:${kind}:${region}`} onClick={() => sample(kind, region)}>
              Namuna (Word)
            </Button>
          </div>
          <div className="max-h-[calc(100vh-9rem)] overflow-y-auto rounded-xl bg-(--color-surface-muted) p-4">
            <Paper t={resolve(t, region)} kind={kind} />
          </div>
          <p className="mt-2 text-[11px] text-(--color-text-faint)">Namunadagi ism va vosita — misol. Haqiqiy dalolatnomada hujjatdagi xodim, vositalar, inventar raqamlari va holati chiqadi.</p>
        </div>
      </div>

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
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}