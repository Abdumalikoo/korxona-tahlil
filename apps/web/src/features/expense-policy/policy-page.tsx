'use client';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Toast } from '@/components/ui/toast';
import { compact, pct, TONE } from '@/features/structure/api';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatDate, formatPeriodShort } from '@/lib/format';
import { usePeriod } from '@/lib/period';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { policyApi, type CenterPart, type PolicyCategory } from './api';

// ═══════════════════════════════════════════════════════════
// Xarajatlar › Xarajatlar siyosati.
//   Hudud xodimlari uchun bo'lsa ham MARKAZ hisobidan qilinadigan xarajatlar (bayram puli, choraklik mukofot,
//   xizmat safari, internet …) — qaysi hududda yozilgan bo'lsa ham Markaz xarajatiga o'tadi.
//   Ish haqi: hudud xodimining sof oyligi hududga; ish haqi tarkibidagi bayram va choraklik pullar — Markazga.
//   Markaz xarajati ikki guruh: 1) joriy xarajatlar (o'ziniki + hududlar uchun); 2) asosiy vositalar sarfi.
//   Siyosat Solishtirma, tumanlar, Markazni qoplash va Katta modellarda bir xil qo'llanadi.
// ═══════════════════════════════════════════════════════════

const OWN_COLOR = '#475569';
const REG_COLOR = '#3b5bdb';
const AV_COLOR = '#b7791f';

function monthEndIso(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  return end > today ? today : end;
}

function PartList({ parts, total, color, empty }: { parts: CenterPart[]; total: number; color: string; empty: string }) {
  if (!parts.length) return <p className="px-5 py-6 text-center text-sm text-(--color-text-muted)">{empty}</p>;
  return (
    <ul className="divide-y divide-(--color-line)">
      {parts.map((p) => {
        const v = Number(p.amountTiyin);
        const share = total > 0 ? (v / total) * 100 : null;
        return (
          <li key={p.key} className="px-5 py-2.5">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="truncate text-heading">{p.label}</span>
              <span className="whitespace-nowrap tabular-nums">
                <b className="font-semibold">{compact(v)}</b> <span className="text-xs text-(--color-text-muted)">{pct(share)}</span>
              </span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-(--color-surface-sunken)">
              <div className="h-1.5 rounded-full" style={{ width: `${Math.max(0, Math.min(100, share ?? 0))}%`, background: color }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Guruhlar oylar bo'yicha (ustunlar) */
function TrendBars({ months, own, reg, av }: { months: string[]; own: string[]; reg: string[]; av: string[] }) {
  const max = Math.max(...months.map((_, i) => Number(own[i] ?? 0) + Number(reg[i] ?? 0) + Number(av[i] ?? 0)), 1);
  return (
    <div className="flex h-36 items-end gap-1.5 px-5 pb-2 pt-4">
      {months.map((m, i) => {
        const o = Number(own[i] ?? 0);
        const r = Number(reg[i] ?? 0);
        const a = Number(av[i] ?? 0);
        const t = o + r + a;
        return (
          <div key={m} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${formatPeriodShort(m)}: o'ziniki ${compact(o)}, hududlar uchun ${compact(r)}, asosiy vositalar sarfi ${compact(a)}`}>
            <div className="flex w-full max-w-9 flex-col justify-end overflow-hidden rounded-t" style={{ height: `${(t / max) * 100}%` }}>
              <div style={{ height: `${t > 0 ? (a / t) * 100 : 0}%`, background: AV_COLOR }} />
              <div style={{ height: `${t > 0 ? (r / t) * 100 : 0}%`, background: REG_COLOR }} />
              <div className="flex-1" style={{ background: OWN_COLOR, opacity: 0.75 }} />
            </div>
            <span className="text-[10px] text-(--color-text-muted)">{formatPeriodShort(m)}</span>
          </div>
        );
      })}
    </div>
  );
}

function CategoryRow({ c, depth, on, inherited, disabled, onToggle }: { c: PolicyCategory; depth: number; on: boolean; inherited: boolean; disabled: boolean; onToggle: () => void }) {
  return (
    <label
      className={cn('flex cursor-pointer items-center gap-3 px-5 py-2 text-sm hover:bg-brand-50/50', disabled && 'cursor-default opacity-80', !c.isActive && 'opacity-50')}
      style={{ paddingLeft: 20 + depth * 22 }}
    >
      <input type="checkbox" className="size-4 accent-brand-600" checked={on || inherited || !!c.locked} disabled={disabled || inherited || !!c.locked} onChange={onToggle} />
      <span className={cn('flex-1', !c.isLeaf ? 'font-semibold text-heading' : 'text-heading')}>{c.label}</span>
      <span className="font-mono text-[11px] text-(--color-text-faint)">{c.code}</span>
      {c.locked ? (
        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800" title="Ish haqi qo'shimchalari va asosiy vositalar sarfi — har doim Markaz hisobidan">
          Har doim Markaz hisobidan
        </span>
      ) : (
        (on || inherited) && (
          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">{inherited ? 'Markaz hisobidan (ota modda orqali)' : 'Markaz hisobidan'}</span>
        )
      )}
    </label>
  );
}

export function ExpensePolicyPage() {
  const { isAdmin } = useAuth();
  const { month } = usePeriod();
  const [scope, setScope] = useState<'month' | 'ytd'>('month');
  const from = scope === 'month' ? `${month}-01` : `${month.slice(0, 4)}-01-01`;
  const to = monthEndIso(month);
  const policy = useAsync(() => policyApi.get().then((r) => r.data), []);
  const summary = useAsync(() => policyApi.summary(from, to).then((r) => r.data), [from, to]);
  const [sel, setSel] = useState<Set<string> | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone?: 'success' | 'error' } | null>(null);

  const [comps, setComps] = useState<Set<string> | null>(null);

  useEffect(() => {
    if (policy.data) {
      setSel(new Set(policy.data.centerCategories));
      setComps(new Set((policy.data.payrollComponents ?? []).filter((c) => c.selected).map((c) => c.code)));
    }
  }, [policy.data]);

  const cats = policy.data?.categories ?? [];
  const children = useMemo(() => {
    const m = new Map<string | null, PolicyCategory[]>();
    const known = new Set(cats.map((c) => c.code));
    for (const c of cats) {
      const k = c.parentCode && known.has(c.parentCode) ? c.parentCode : null;
      const list = m.get(k) ?? [];
      list.push(c);
      m.set(k, list);
    }
    return m;
  }, [cats]);
  const parentOf = useMemo(() => new Map(cats.map((c) => [c.code, c.parentCode])), [cats]);
  const inheritedOf = (code: string): boolean => {
    let p = parentOf.get(code) ?? null;
    let guard = 0;
    while (p && guard++ < 20) {
      if (sel?.has(p)) return true;
      p = parentOf.get(p) ?? null;
    }
    return false;
  };
  const dirty = !!policy.data && !!sel && (sel.size !== policy.data.centerCategories.length || policy.data.centerCategories.some((c) => !sel.has(c)));

  const save = async () => {
    if (!sel) return;
    setSaving(true);
    try {
      await policyApi.save([...sel]);
      setToast({ message: "Siyosat saqlandi — Solishtirma va hisob-kitoblar yangilandi" });
      policy.reload();
      summary.reload();
    } catch (e) {
      setToast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setSaving(false);
    }
  };
  const compsDirty = !!policy.data?.payrollComponents && !!comps && (policy.data.payrollComponents.some((c) => c.selected !== comps.has(c.code)));
  const savePayroll = async () => {
    if (!comps) return;
    setSaving(true);
    try {
      const r = await policyApi.savePayroll([...comps]);
      const rep = r.data.report;
      setToast({ message: `Saqlandi — ${rep.periods} oy qayta hisoblandi; Markazga o'tgan: ${compact(rep.centerTiyin)}` });
      policy.reload();
      summary.reload();
    } catch (e) {
      setToast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setSaving(false);
    }
  };
  const recompute = async () => {
    setSaving(true);
    try {
      const r = await policyApi.recompute();
      setToast({ message: `${r.data.periods} oy qayta hisoblandi (${r.data.changedBatches} vedomost o'zgardi); Markazga o'tgan: ${compact(r.data.centerTiyin)}` });
      summary.reload();
    } catch (e) {
      setToast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setSaving(false);
    }
  };
  const seed = async () => {
    setSaving(true);
    try {
      const r = await policyApi.seed();
      setToast({ message: r.data.created ? `${r.data.created} ta modda qo'shildi va siyosatga kiritildi` : "Tavsiya etilgan moddalar allaqachon bor — siyosatga kiritildi" });
      policy.reload();
      summary.reload();
    } catch (e) {
      setToast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const tree = (parent: string | null, depth: number): ReactNode[] =>
    (children.get(parent) ?? []).flatMap((c) => [
      <CategoryRow
        key={c.code}
        c={c}
        depth={depth}
        on={!!sel?.has(c.code)}
        inherited={inheritedOf(c.code)}
        disabled={!isAdmin}
        onToggle={() => {
          if (!sel) return;
          const next = new Set(sel);
          if (next.has(c.code)) next.delete(c.code);
          else next.add(c.code);
          setSel(next);
        }}
      />,
      ...tree(c.code, depth + 1),
    ]);

  const s = summary.data;
  const total = s ? Number(s.totalTiyin) : 0;
  const own = s ? Number(s.ownTiyin) : 0;
  const reg = s ? Number(s.regionalTiyin) : 0;
  const av = s ? Number(s.assetsTiyin ?? 0) : 0;
  const current = own + reg;

  return (
    <>
      <PageHeader title="Xarajatlar siyosati" description="Qaysi xarajatlar Markaz hisobidan — hudud xodimlari uchun bo'lsa ham" />
      <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
        <Card className="space-y-3 p-5 text-sm leading-relaxed text-(--color-text-muted)">
          <p>
            Hudud xodimlariga <b className="text-heading">bayram puli, choraklik mukofot, xizmat safari (komandirovka), internet to&apos;lovlari</b> kabi xarajatlar —
            qaysi hududda yozilgan bo&apos;lsa ham — <b className="text-heading">Markaz xarajatiga</b> o&apos;tadi. Hudud xodimining ish haqidan hududga faqat{' '}
            <b className="text-heading">sof oylik</b> (bayram va choraklik pullarsiz) yoziladi. Markaz xarajati ikki guruhga bo&apos;linadi:
          </p>
          <div className="grid gap-2 lg:grid-cols-2">
            <div className="rounded-lg border border-(--color-line) bg-white px-3 py-2.5">
              <b className="text-heading">1. Joriy xarajatlar</b> — hamma xarajatlar shu guruhda yuritiladi:
              <ul className="mt-1.5 space-y-1 text-xs">
                <li>
                  <span className="mr-1.5 inline-block size-2.5 rounded-sm" style={{ background: OWN_COLOR }} />
                  <b className="text-heading">O&apos;ziniki</b> — Markaz xodimlari ish haqi, ijara, ofis va Markazda yozilgan boshqa xarajatlar;
                </li>
                <li>
                  <span className="mr-1.5 inline-block size-2.5 rounded-sm" style={{ background: REG_COLOR }} />
                  <b className="text-heading">Hududlar uchun</b> — bayram, choraklik pullar (ish haqi tarkibidan avtomatik) va quyida belgilangan moddalar; qaysi hudud uchun ekani saqlanadi.
                </li>
              </ul>
            </div>
            <div className="rounded-lg border border-(--color-line) bg-white px-3 py-2.5">
              <span className="mr-1.5 inline-block size-2.5 rounded-sm" style={{ background: AV_COLOR }} />
              <b className="text-heading">2. Asosiy vositalar</b> — kompyuter, mebel, mashina, bino kabi xaridlar xarajatga birdaniga yozilmaydi: <b className="text-heading">balansda turadi</b>,
              xarajatga har oy faqat <b className="text-heading">sarfi (eskirishi)</b> o&apos;tadi.{' '}
              <Link href="/xarajatlar/asosiy-vositalar" className="font-semibold text-brand-700 underline">
                Asosiy vositalar
              </Link>
            </div>
          </div>
          <p className="text-xs">
            Siyosat hamma joyda bir xil qo&apos;llanadi: Solishtirma (viloyat va tuman xarajatiga kirmaydi), Markazni qoplash, Katta modellar.{' '}
            <Link href="/solishtirma" className="font-semibold text-brand-700 underline">
              Solishtirmaga o&apos;tish
            </Link>
          </p>
        </Card>

        {/* ── Markaz xarajati: ikki guruh ── */}
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-bold text-heading">Markaz xarajati</h2>
          <span className="text-xs text-(--color-text-muted)">
            {formatDate(from)} — {formatDate(to)}
          </span>
          <div className="ml-auto flex gap-1 rounded-lg bg-white p-1 shadow-card">
            {(
              [
                ['month', 'Tanlangan oy'],
                ['ytd', 'Yil boshidan'],
              ] as const
            ).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setScope(k)} className={cn('rounded-md px-3 py-1.5 text-xs font-semibold', scope === k ? 'bg-brand-600 text-white' : 'text-heading hover:bg-brand-50')}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {!s ? (
          <Card className="p-6 text-center text-sm text-(--color-text-muted)">{summary.error ? `Yuklab bo'lmadi: ${summary.error}` : 'Yuklanmoqda…'}</Card>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Card className="p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">Markaz jami</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-heading">{compact(total)}</p>
                <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-(--color-surface-sunken)">
                  <div style={{ width: `${total > 0 ? (own / total) * 100 : 0}%`, background: OWN_COLOR }} />
                  <div style={{ width: `${total > 0 ? (reg / total) * 100 : 0}%`, background: REG_COLOR }} />
                  <div style={{ width: `${total > 0 ? (av / total) * 100 : 0}%`, background: AV_COLOR }} />
                </div>
                <p className="mt-1.5 text-xs text-(--color-text-muted)">
                  1. joriy {compact(current)} · 2. asosiy vositalar {compact(av)}
                </p>
              </Card>
              <Card className="p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">1a. O&apos;ziniki</p>
                <p className="mt-1 text-2xl font-bold tabular-nums" style={{ color: OWN_COLOR }}>
                  {compact(own)}
                </p>
                <p className="text-xs text-(--color-text-muted)">Markaz xarajatining {pct(total > 0 ? (own / total) * 100 : null)}</p>
              </Card>
              <Card className="p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">1b. Hududlar uchun</p>
                <p className="mt-1 text-2xl font-bold tabular-nums" style={{ color: REG_COLOR }}>
                  {compact(reg)}
                </p>
                <p className="text-xs text-(--color-text-muted)">
                  Markaz xarajatining {pct(total > 0 ? (reg / total) * 100 : null)} · bayram, choraklik va {s.policyCount ? `${s.policyCount} ta modda` : 'siyosatdagi moddalar'}
                </p>
              </Card>
              <Link href="/xarajatlar/asosiy-vositalar" className="block">
                <Card className="h-full p-4 transition hover:shadow-md">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">2. Asosiy vositalar sarfi</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums" style={{ color: AV_COLOR }}>
                    {compact(av)}
                  </p>
                  <p className="text-xs text-(--color-text-muted)">Xarid balansda · xarajatga faqat oylik sarf · batafsil →</p>
                </Card>
              </Link>
            </div>

            <Card className="overflow-hidden">
              <div className="flex items-center gap-4 border-b border-(--color-line) px-5 py-3 text-xs text-(--color-text-muted)">
                <span className="text-sm font-semibold text-heading">Oylar bo&apos;yicha</span>
                <span className="inline-flex items-center gap-1">
                  <i className="inline-block size-2.5 rounded-sm" style={{ background: OWN_COLOR, opacity: 0.75 }} /> o&apos;ziniki
                </span>
                <span className="inline-flex items-center gap-1">
                  <i className="inline-block size-2.5 rounded-sm" style={{ background: REG_COLOR }} /> hududlar uchun
                </span>
                <span className="inline-flex items-center gap-1">
                  <i className="inline-block size-2.5 rounded-sm" style={{ background: AV_COLOR }} /> asosiy vositalar sarfi
                </span>
              </div>
              <TrendBars months={s.months} own={s.ownTrend} reg={s.regionalTrend} av={s.assetsTrend ?? []} />
            </Card>

            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="overflow-hidden">
                <p className="border-b border-(--color-line) px-5 py-3 text-sm font-semibold text-heading">1a. O&apos;ziniki — tarkibi</p>
                <PartList parts={s.ownParts} total={own} color={OWN_COLOR} empty="Bu davrda Markazning o'z xarajati yo'q" />
              </Card>
              <Card className="overflow-hidden">
                <p className="border-b border-(--color-line) px-5 py-3 text-sm font-semibold text-heading">1b. Hududlar uchun — moddalar</p>
                <PartList parts={s.regionalParts} total={reg} color={REG_COLOR} empty="Bu davrda siyosatdagi moddalar bo'yicha xarajat yo'q" />
              </Card>
              <Card className="overflow-hidden">
                <p className="border-b border-(--color-line) px-5 py-3 text-sm font-semibold text-heading">1b. Hududlar uchun — qaysi hududga</p>
                <PartList
                  parts={s.byRegion.map((g) => ({ key: String(g.code ?? '-'), label: g.name, amountTiyin: g.amountTiyin }))}
                  total={reg}
                  color={TONE.income}
                  empty="—"
                />
              </Card>
            </div>
          </>
        )}

        {/* ── Ish haqi: Markaz hisobidan komponentlar ── */}
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b border-(--color-line) px-5 py-3">
            <div>
              <p className="text-sm font-semibold text-heading">Ish haqi: Markaz hisobidagi qo&apos;shimchalar</p>
              <p className="text-xs text-(--color-text-muted)">
                Hudud xodimining ish haqi tarkibidagi shu komponentlar Markaz xarajatiga o&apos;tadi; hududda <b>sof oylik</b> qoladi (to&apos;liq − belgilanganlar).
                Ish haqi tarkibi yuklanmagan oyda — hammasi hududda.
              </p>
            </div>
            {isAdmin && (
              <Button variant="secondary" size="sm" className="ml-auto" onClick={() => void recompute()} loading={saving}>
                Hamma oylarni qayta hisoblash
              </Button>
            )}
          </div>
          {!policy.data ? (
            <p className="px-5 py-6 text-center text-sm text-(--color-text-muted)">Yuklanmoqda…</p>
          ) : !(policy.data.payrollComponents ?? []).length ? (
            <p className="px-5 py-6 text-center text-sm text-(--color-text-muted)">
              Ish haqi komponentlari yo&apos;q —{' '}
              <Link href="/xarajatlar/tarkib" className="font-semibold text-brand-700 underline">
                Ish haqi tarkibi
              </Link>
            </p>
          ) : (
            <div className="grid gap-x-6 px-5 py-3 sm:grid-cols-2 lg:grid-cols-3">
              {(policy.data.payrollComponents ?? []).map((c) => (
                <label key={c.code} className={cn('flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-2 text-sm hover:bg-brand-50/50', !isAdmin && 'cursor-default')}>
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-brand-600"
                    checked={!!comps?.has(c.code)}
                    disabled={!isAdmin}
                    onChange={() => {
                      if (!comps) return;
                      const next = new Set(comps);
                      if (next.has(c.code)) next.delete(c.code);
                      else next.add(c.code);
                      setComps(next);
                    }}
                  />
                  <span className="flex-1">
                    <span className="font-medium text-heading">{c.name}</span>
                    <span className="block text-[11px] text-(--color-text-muted)">
                      {c.categoryLabel}
                      {comps?.has(c.code) ? ` → Markaz: «${c.target}»` : ' · hududda qoladi'}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
          {isAdmin && (
            <div className="flex items-center gap-3 border-t border-(--color-line) bg-(--color-surface-muted) px-5 py-3">
              <span className="text-xs text-(--color-text-muted)">Saqlansa, ish haqi yuklangan hamma oylar qayta hisoblanadi (jami summa o&apos;zgarmaydi)</span>
              <Button className="ml-auto" onClick={() => void savePayroll()} loading={saving} disabled={!compsDirty}>
                Saqlash
              </Button>
            </div>
          )}
        </Card>

        {/* ── Siyosat: moddalar ── */}
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b border-(--color-line) px-5 py-3">
            <div>
              <p className="text-sm font-semibold text-heading">Markaz hisobidagi moddalar</p>
              <p className="text-xs text-(--color-text-muted)">Belgilangan modda (va uning ichidagilari) — hudud xodimlari uchun bo&apos;lsa ham Markaz xarajati.</p>
            </div>
            {isAdmin && policy.data && policy.data.recommended.missing > 0 && (
              <Button variant="secondary" size="sm" className="ml-auto" onClick={() => void seed()} loading={saving}>
                Tavsiya etilgan moddalarni qo&apos;shish ({policy.data.recommended.missing})
              </Button>
            )}
          </div>
          {policy.data && policy.data.recommended.missing > 0 && (
            <p className="border-b border-(--color-line) bg-sky-50 px-5 py-2.5 text-xs text-sky-900">
              Tavsiya: «{policy.data.recommended.parent.label}» guruhi — {policy.data.recommended.items.map((i) => i.label).join(', ')}. Qo&apos;shilsa, bu guruh avtomatik Markaz
              hisobiga o&apos;tadi va hududlar xarajatini kiritishda shu moddalarni tanlaysiz.
            </p>
          )}
          {!policy.data ? (
            <p className="px-5 py-6 text-center text-sm text-(--color-text-muted)">{policy.error ? `Yuklab bo'lmadi: ${policy.error}` : 'Yuklanmoqda…'}</p>
          ) : (
            <div className="max-h-[520px] divide-y divide-(--color-line) overflow-y-auto">{tree(null, 0)}</div>
          )}
          {isAdmin && (
            <div className="flex items-center gap-3 border-t border-(--color-line) bg-(--color-surface-muted) px-5 py-3">
              <span className="text-xs text-(--color-text-muted)">{sel ? `${sel.size} ta modda belgilangan` : ''}</span>
              <Button className="ml-auto" onClick={() => void save()} loading={saving} disabled={!dirty}>
                Siyosatni saqlash
              </Button>
            </div>
          )}
        </Card>
      </div>
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} duration={toast.tone === 'error' ? 6000 : 4000} />}
    </>
  );
}