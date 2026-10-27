'use client';

import { PageHeader } from '@/components/layout/page-header';
import { MoneyCell, NameCell, ReportCard, RTable, StatTiles, STICKY_NAME, STICKY_NO, TableNote, Td, Th, Tr, sum } from '@/components/report/report';
import { Button } from '@/components/ui/button';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { MonthRangeCard, useMonthRange } from '@/features/units/month-range';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatPeriodShort } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { depPolicyApi, type DepCategoryRow, type DepView } from './api';

// ═══════════════════════════════════════════════════════════
// Xarajatlar › Foyda keltirmaydigan bo'limlar — Markazning har bir bo'limi alohida:
// qilingan xarajatlar moddalar bo'yicha (guruh → modda, oyma-oy) va har modda bo'yicha bo'limning
// XARAJATLAR SIYOSATI — kim hisobidan: shu bo'lim, Markaz (bo'limsiz), boshqa bo'lim yoki yo'nalish.
// ═══════════════════════════════════════════════════════════

const ORIGIN: Record<DepCategoryRow['effective']['origin'], string> = {
  dep: "bo'lim qoidasi",
  parent: 'guruh qoidasidan',
  unit: 'Markaz qoidasi',
  global: 'umumiy siyosat',
  none: '',
};

export function DepartmentsView({ id }: { id?: string }) {
  const range = useMonthRange('year');
  const router = useRouter();
  const list = useAsync(() => (range.error ? Promise.resolve(null) : depPolicyApi.list(range.from, range.to).then((r) => r.data)), [range.from, range.to, range.error]);
  const deps = list.data ?? [];
  const current = id ? deps.find((d) => d.id === id) : null;

  return (
    <>
      <PageHeader
        title={current ? current.name : "Foyda keltirmaydigan bo'limlar"}
        description={current ? "Foyda keltirmaydigan bo'lim: xarajat moddalari oyma-oy va bo'lim xarajatlar siyosati" : "Markaz bo'limlari (6 yo'nalishdan tashqari): har biriga qilingan xarajatlar va bo'lim siyosati"}
      />
      {/* Bo'limlar — tepada, har biriga alohida kiriladi */}
      <div className="border-b border-(--color-line) bg-white px-4 py-2.5 md:px-6">
        <div className="flex flex-wrap gap-1.5">
          <Link
            href="/xarajatlar/bolimlar"
            scroll={false}
            className={cn('rounded-full border px-3 py-1 text-xs font-semibold', !id ? 'border-brand-600 bg-brand-600 text-white' : 'border-(--color-line) bg-white text-(--color-text-muted) hover:border-brand-300 hover:text-heading')}
          >
            Hammasi{deps.length ? ` · ${deps.length}` : ''}
          </Link>
          {deps.map((d) => (
            <Link
              key={d.id}
              href={`/xarajatlar/bolimlar/${d.id}`}
              scroll={false}
              title={`${d.name}: ${sum(Number(d.resultTiyin))} so'm`}
              className={cn(
                'max-w-64 truncate rounded-full border px-3 py-1 text-xs font-medium',
                d.id === id ? 'border-brand-600 bg-brand-600 text-white' : 'border-(--color-line) bg-white text-heading hover:border-brand-300 hover:bg-brand-50',
                d.id !== id && Number(d.writtenTiyin) === 0 && 'text-(--color-text-faint)',
              )}
            >
              {d.name}
            </Link>
          ))}
        </div>
      </div>
      <div className="space-y-4 p-4 md:p-6">
        <MonthRangeCard range={range} />
        {list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : !list.data ? (
          <LoadingState />
        ) : id ? (
          <DepartmentDetail key={`${id}|${range.from}|${range.to}`} id={id} from={range.from} to={range.to} onSaved={list.reload} />
        ) : (
          <ReportCard title="Bo'limlar bo'yicha xarajat" badge={`${deps.length} ta bo'lim · ${sum(deps.reduce((s, d) => s + Number(d.resultTiyin), 0))} so'm`}>
            <div className="p-4">
              <RTable minWidth={900}>
                <thead>
                  <tr>
                    <Th className={cn(STICKY_NO, 'z-[2]')}>№</Th>
                    <Th className={cn(STICKY_NAME, 'z-[2] min-w-56 text-left')}>Bo&apos;lim</Th>
                    <Th>Yozilgan</Th>
                    <Th>Boshqa hisobga o&apos;tgan</Th>
                    <Th>Kelgan</Th>
                    <Th>Bo&apos;lim xarajati</Th>
                    <Th>Moddalar</Th>
                    <Th>Yozuvlar</Th>
                    <Th>Qoidalar</Th>
                  </tr>
                </thead>
                <tbody>
                  {[...deps]
                    .sort((a, b) => Number(b.resultTiyin) - Number(a.resultTiyin))
                    .map((d, i) => {
                      const written = Number(d.writtenTiyin);
                      const out = written - Number(d.staysTiyin);
                      return (
                        <Tr key={d.id} onClick={() => router.push(`/xarajatlar/bolimlar/${d.id}`)} muted={!d.isActive}>
                          <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{i + 1}</Td>
                          <NameCell drill sub={d.isActive ? undefined : 'nofaol'}>
                            {d.name}
                          </NameCell>
                          <MoneyCell value={written} className={written ? '' : 'text-(--color-text-faint)'} />
                          <MoneyCell value={out} className={out ? 'text-amber-700' : 'text-(--color-text-faint)'} />
                          <MoneyCell value={Number(d.incomingTiyin)} className={Number(d.incomingTiyin) ? 'text-(--color-income)' : 'text-(--color-text-faint)'} />
                          <MoneyCell value={Number(d.resultTiyin)} strong />
                          <Td>{d.categories}</Td>
                          <Td>{d.count}</Td>
                          <Td>{d.rules || ''}</Td>
                        </Tr>
                      );
                    })}
                </tbody>
              </RTable>
              <TableNote>Bo&apos;limni bosing (yoki tepadagi nomini) — ichiga kirasiz: xarajat moddalari oyma-oy va bo&apos;limning xarajatlar siyosati. Tax free, Marksheyder, Fermer xo&apos;jaligi va Buxgalteriya xizmatlari bo&apos;limlari — 6 bo&apos;lim ichida.</TableNote>
            </div>
          </ReportCard>
        )}
      </div>
    </>
  );
}

function DepartmentDetail({ id, from, to, onSaved }: { id: string; from: string; to: string; onSaved: () => void }) {
  const { isAdmin } = useAuth();
  const res = useAsync(() => depPolicyApi.view(id, from, to).then((r) => r.data), [id, from, to]);
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [all, setAll] = useState(false);
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);

  if (res.error) return <ErrorState message={res.error} onRetry={res.reload} />;
  if (!res.data) return <LoadingState label="Bo'lim hisoblanmoqda" />;
  return <DetailBody v={res.data} isAdmin={isAdmin} draft={draft} setDraft={setDraft} all={all} setAll={setAll} closed={closed} setClosed={setClosed} saving={saving} save={save} toast={toast} setToast={setToast} />;

  async function save(rules: Record<string, string>) {
    setSaving(true);
    try {
      const r = (await depPolicyApi.save(id, rules)).data;
      setToast({ message: r.changed ? `Saqlandi: ${r.changed} ta modda siyosati o'zgardi — Solishtirma va hisobotlarda shu bo'yicha` : "O'zgarish yo'q", tone: 'success' });
      setDraft(null);
      res.reload();
      onSaved();
    } catch (err) {
      setToast({ message: errorMessage(err, "Saqlab bo'lmadi"), tone: 'error' });
    } finally {
      setSaving(false);
    }
  }
}

function DetailBody({
  v,
  isAdmin,
  draft,
  setDraft,
  all,
  setAll,
  closed,
  setClosed,
  saving,
  save,
  toast,
  setToast,
}: {
  v: DepView;
  isAdmin: boolean;
  draft: Record<string, string> | null;
  setDraft: (d: Record<string, string> | null) => void;
  all: boolean;
  setAll: (b: boolean) => void;
  closed: Set<string>;
  setClosed: (s: Set<string>) => void;
  saving: boolean;
  save: (rules: Record<string, string>) => Promise<void>;
  toast: { message: string; tone: 'success' | 'error' } | null;
  setToast: (t: { message: string; tone: 'success' | 'error' } | null) => void;
}) {
  const saved = useMemo(() => Object.fromEntries(v.categories.filter((c) => c.rule).map((c) => [c.code, c.rule!])), [v.categories]);
  const rules = draft ?? saved;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(saved);
  const showMonths = v.months.length > 1 && v.months.length <= 12;

  // Daraxt: ota → bolalar (ko'rinadiganlari)
  const rows = useMemo(() => {
    const visible = v.categories.filter((c) => all || c.used);
    const byParent = new Map<string | null, DepCategoryRow[]>();
    const codes = new Set(visible.map((c) => c.code));
    for (const c of visible) {
      const p = c.parentCode && codes.has(c.parentCode) ? c.parentCode : null;
      byParent.set(p, [...(byParent.get(p) ?? []), c]);
    }
    const out: { c: DepCategoryRow; depth: number; hasKids: boolean }[] = [];
    const walk = (p: string | null, depth: number) => {
      const kids = (byParent.get(p) ?? []).sort((a, b) => Number(BigInt(b.totalTiyin) - BigInt(a.totalTiyin)) || a.label.localeCompare(b.label));
      for (const c of kids) {
        const hasKids = (byParent.get(c.code) ?? []).length > 0;
        out.push({ c, depth, hasKids });
        if (hasKids && !closed.has(c.code)) walk(c.code, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [v.categories, all, closed]);

  const total = Number(v.totals.writtenTiyin);
  const setRule = (code: string, t: string) => {
    const next = { ...rules };
    if (!t) delete next[code];
    else next[code] = t;
    setDraft(next);
  };
  const toggle = (code: string) => {
    const s = new Set(closed);
    if (s.has(code)) s.delete(code);
    else s.add(code);
    setClosed(s);
  };

  return (
    <div className="space-y-4">
      <StatTiles
        items={[
          { label: 'Yozilgan xarajat', value: total, tone: 'red' },
          { label: "Shu bo'limda qoladi", value: Number(v.totals.staysTiyin), tone: 'blue' },
          { label: 'Boshqa hisobga o‘tadi', value: Number(v.totals.movedOutTiyin), tone: 'orange', note: v.totals.outBy.map((o) => `${o.label}: ${sum(Number(o.totalTiyin))}`).join(' · ') || "yo'q" },
          { label: "Boshqa bo'limlardan kelgan", value: Number(v.totals.incomingTiyin), tone: 'purple' },
          { label: "Bo'lim xarajati (siyosat bilan)", value: Number(v.totals.resultTiyin), tone: 'green' },
        ]}
      />

      <ReportCard
        title={`${v.department.name}: xarajat moddalari va siyosati`}
        badge={`${v.categories.filter((c) => c.used && !c.group).length} ta modda · ${v.rulesCount} ta bo'lim qoidasi`}
        actions={
          <div className="flex items-center gap-3">
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-(--color-text-muted)">
              <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} className="size-3.5" />
              Hamma moddalar
            </label>
            {isAdmin && dirty && (
              <>
                <Button size="sm" variant="secondary" onClick={() => setDraft(null)} disabled={saving}>
                  Bekor
                </Button>
                <Button size="sm" onClick={() => void save(rules)} loading={saving}>
                  Siyosatni saqlash
                </Button>
              </>
            )}
          </div>
        }
      >
        <div className="p-4">
          <RTable minWidth={showMonths ? 760 + v.months.length * 110 : 900}>
            <thead>
              <tr>
                <Th className={cn(STICKY_NO, 'z-[2]')}>№</Th>
                <Th className={cn(STICKY_NAME, 'z-[2] min-w-56 text-left')}>Modda</Th>
                <Th>Jami</Th>
                <Th>Ulushi</Th>
                <Th className="min-w-64 text-left">Kim hisobidan (siyosat)</Th>
                {showMonths && v.months.map((m) => <Th key={m}>{formatPeriodShort(m)}</Th>)}
              </tr>
            </thead>
            <tbody>
              <Tr total>
                <Td className={STICKY_NO} />
                <NameCell>Jami</NameCell>
                <MoneyCell value={total} strong />
                <Td>100%</Td>
                <Td />
                {showMonths && v.months.map((m) => <MoneyCell key={m} value={v.categories.filter((c) => !c.parentCode).reduce((s, c) => s + Number(c.months[m] ?? 0), 0)} />)}
              </Tr>
              {rows.map(({ c, depth, hasKids }, i) => {
                const amount = Number(c.totalTiyin);
                const value = rules[c.code] ?? '';
                return (
                  <Tr key={c.code} onClick={hasKids ? () => toggle(c.code) : undefined} className={cn(depth === 0 && hasKids && 'bg-[#f5f8ff]', !c.used && 'opacity-70')}>
                    <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{i + 1}</Td>
                    <NameCell
                      before={
                        <span style={{ width: depth * 16 }} className="inline-flex shrink-0 justify-end">
                          {hasKids ? <span className={cn('inline-block w-3 text-xs text-(--color-text-faint) transition-transform', !closed.has(c.code) && 'rotate-90')}>▸</span> : <span className="inline-block w-3" />}
                        </span>
                      }
                      className={cn(hasKids ? 'font-semibold text-heading' : 'text-heading')}
                      sub={c.count ? `${c.count} ta yozuv` : undefined}
                    >
                      {c.label}
                    </NameCell>
                    <MoneyCell value={amount} strong={hasKids} className={amount ? '' : 'text-(--color-text-faint)'} />
                    <Td className="whitespace-nowrap text-xs text-(--color-text-muted)">{total && amount ? `${((amount / total) * 100).toFixed(1).replace('.', ',')}%` : ''}</Td>
                    <td className="border-b border-l border-(--color-line) px-2 py-1.5 text-left text-xs" onClick={(e) => e.stopPropagation()}>
                      {isAdmin ? (
                        <select
                          value={value}
                          onChange={(e) => setRule(c.code, e.target.value)}
                          className={cn('h-7 w-full max-w-72 rounded-md border bg-white px-1.5 text-xs', value ? 'border-brand-500 font-semibold text-brand-800' : 'border-(--color-line-strong) text-(--color-text-muted)')}
                        >
                          <option value="">{c.effective.origin === 'dep' ? 'Avtomatik (guruh / umumiy siyosat)' : `Avtomatik: ${c.effective.label}`}</option>
                          {v.targets.map((t) => (
                            <option key={t.code} value={t.code}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="font-medium text-heading">{c.effective.label}</span>
                      )}
                      {!dirty && (
                        <span className="mt-0.5 block text-[10.5px] text-(--color-text-faint)">
                          amalda: {c.effective.label}
                          {ORIGIN[c.effective.origin] ? ` · ${ORIGIN[c.effective.origin]}` : ''}
                        </span>
                      )}
                    </td>
                    {showMonths && v.months.map((m) => <MoneyCell key={m} value={Number(c.months[m] ?? 0)} className={cn('text-xs', c.months[m] ? '' : 'text-(--color-text-faint)')} />)}
                  </Tr>
                );
              })}
            </tbody>
          </RTable>
          <TableNote>
            Guruh qatorini bosing — ichidagi moddalar yopiladi / ochiladi. «Kim hisobidan»: shu bo&apos;lim, Markaz (bo&apos;limga biriktirilmagan), boshqa bo&apos;lim yoki
            yo&apos;nalish (Tax free, Marksheyder … — Markaz xarajatidan chiqadi). Guruhga berilgan qoida ichidagi moddalarga ham o&apos;tadi; «Avtomatik» — Markaz qoidalari va
            umumiy Xarajatlar siyosati bo&apos;yicha. Yozuvlar joyida qoladi — faqat Solishtirma, hisobotlar va tahlilda hisobga olinadi.
          </TableNote>
        </div>
      </ReportCard>

      {v.incoming.length > 0 && (
        <ReportCard title={`Boshqa bo'limlardan ${v.department.name} hisobiga`} badge={`${sum(Number(v.totals.incomingTiyin))} so'm`}>
          <ul className="divide-y divide-(--color-line) text-sm">
            {v.incoming.map((g) => (
              <li key={`${g.from}|${g.code}`} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                <span className="min-w-0 flex-1">
                  <b className="text-heading">{g.label}</b> <span className="text-(--color-text-muted)">· {g.fromLabel} · {g.count} ta yozuv</span>
                </span>
                <span className="font-semibold tabular-nums">{sum(Number(g.totalTiyin))} so&apos;m</span>
              </li>
            ))}
          </ul>
        </ReportCard>
      )}
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}
    </div>
  );
}
