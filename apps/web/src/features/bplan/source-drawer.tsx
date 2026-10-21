'use client';

import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { cn } from '@/lib/utils';
import { useEffect, useMemo, useState } from 'react';
import { AREA_LABEL, KIND_LABEL, type Area, type FactLine, type LineSource, type Overview, type SourceKind } from './api';

// ═══════════════════════════════════════════════════════════
// Bitta hisobot qatorini belgilash: fakt dasturdagi qaysi manbadan olinadi.
//  Daromad / xarajat moddalari (xarajatda — ichki moddalari bilan), ish haqi vedomosti, xodimlar soni yoki qo'lda.
// ═══════════════════════════════════════════════════════════

const KINDS_FOR: Record<FactLine['kind'], SourceKind[]> = {
  in: ['MANUAL', 'INCOME', 'EXPENSE'],
  out: ['MANUAL', 'EXPENSE', 'PAYROLL', 'INCOME'],
  count: ['MANUAL', 'HEADCOUNT'],
  balance: ['MANUAL'],
};

export function SourceDrawer({
  line,
  source,
  sources,
  onClose,
  onSave,
  saving,
}: {
  line: FactLine | null;
  source: LineSource | undefined;
  sources: Overview['sources'];
  onClose: () => void;
  onSave: (key: string, s: LineSource) => void;
  saving: boolean;
}) {
  const [kind, setKind] = useState<SourceKind>('MANUAL');
  const [cats, setCats] = useState<string[]>([]);
  const [area, setArea] = useState<Area>('all');
  const [deps, setDeps] = useState<string[]>([]);
  const [q, setQ] = useState('');

  useEffect(() => {
    if (!line) return;
    setKind(source?.kind ?? 'MANUAL');
    setCats(source?.categories ?? []);
    setArea(source?.area ?? (line.key.startsWith('R1') ? 'center' : 'all'));
    setDeps(source?.departments ?? []);
    setQ('');
  }, [line, source]);

  // Xarajat moddalari — daraxt (ichki moddalar chekinish bilan)
  const expenseTree = useMemo(() => {
    const list = sources.expenseCategories;
    const byParent = new Map<string | null, typeof list>();
    for (const c of list) byParent.set(c.parentCode, [...(byParent.get(c.parentCode) ?? []), c]);
    const out: { code: string; label: string; depth: number }[] = [];
    const walk = (parent: string | null, depth: number) => {
      for (const c of byParent.get(parent) ?? []) {
        out.push({ code: c.code, label: c.label, depth });
        walk(c.code, depth + 1);
      }
    };
    walk(null, 0);
    // Ota-onasi topilmaganlar ham ko'rinsin
    for (const c of list) if (!out.some((x) => x.code === c.code)) out.push({ code: c.code, label: c.label, depth: 0 });
    return out;
  }, [sources.expenseCategories]);

  if (!line) return null;
  const kinds = KINDS_FOR[line.kind];
  const options = kind === 'INCOME' ? sources.incomeCategories.map((c) => ({ code: c.code, label: c.label, depth: 0 })) : kind === 'EXPENSE' ? expenseTree : [];
  const term = q.trim().toLowerCase();
  const shown = term ? options.filter((o) => o.label.toLowerCase().includes(term) || o.code.toLowerCase().includes(term)) : options;
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const needCats = kind === 'INCOME' || kind === 'EXPENSE';
  const invalid = needCats && cats.length === 0;

  return (
    <Drawer
      open={Boolean(line)}
      onClose={onClose}
      width="lg"
      title={`Belgilash: ${line.name}`}
      description={`${line.section} · fakt qayerdan olinadi`}
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button
            loading={saving}
            disabled={invalid}
            onClick={() => onSave(line.key, kind === 'MANUAL' ? { kind } : { kind, area, categories: needCats ? cats : [], departments: kind === 'INCOME' ? [] : deps })}
          >
            Saqlash
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <p className="mb-2 text-xs font-semibold text-(--color-text-muted)">Manba</p>
          <div className="flex flex-wrap gap-2">
            {kinds.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setKind(k);
                  // Boshqa turdagi moddalar aralashmasin
                  setCats(k === source?.kind ? (source?.categories ?? []) : []);
                }}
                className={cn('rounded-(--radius-control) px-3 py-2 text-sm font-medium ring-1', kind === k ? 'bg-brand-500 text-white ring-brand-500' : 'bg-white text-heading ring-(--color-line) hover:bg-brand-50')}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          {kind === 'MANUAL' && <p className="mt-2 text-xs text-(--color-text-muted)">Fakt «Fakt va belgilash» jadvalida har chorak uchun qo&apos;lda kiritiladi.</p>}
        </div>

        {kind !== 'MANUAL' && (
          <div>
            <p className="mb-2 text-xs font-semibold text-(--color-text-muted)">Qaysi bo&apos;linmalar</p>
            <div className="inline-flex gap-0.5 rounded-(--radius-control) bg-(--color-surface-sunken) p-0.5 text-sm font-medium">
              {(['center', 'regions', 'all'] as Area[]).map((a) => (
                <button key={a} type="button" onClick={() => setArea(a)} className={area === a ? 'rounded-[calc(var(--radius-control)-2px)] bg-white px-3 py-1.5 shadow-sm' : 'px-3 py-1.5 text-(--color-text-muted)'}>
                  {AREA_LABEL[a]}
                </button>
              ))}
            </div>
          </div>
        )}

        {needCats && (
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-(--color-text-muted)">
                {kind === 'INCOME' ? 'Daromad moddalari' : 'Xarajat moddalari (ichki moddalari ham qo‘shiladi)'} · {cats.length} ta tanlangan
              </p>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Qidirish" className="h-8 w-48 rounded-(--radius-control) border border-(--color-line) px-2 text-sm" />
            </div>
            <div className="max-h-[22rem] overflow-y-auto rounded-(--radius-control) border border-(--color-line)">
              {shown.map((o) => (
                <label key={o.code} className="flex cursor-pointer items-center gap-2 border-b border-(--color-line) px-3 py-1.5 text-sm last:border-b-0 hover:bg-brand-50" style={{ paddingLeft: `${12 + o.depth * 18}px` }}>
                  <input type="checkbox" checked={cats.includes(o.code)} onChange={() => setCats((c) => toggle(c, o.code))} className="size-4 accent-brand-600" />
                  <span className={cn('min-w-0 flex-1 truncate', o.depth === 0 && kind === 'EXPENSE' && 'font-semibold text-heading')}>{o.label}</span>
                  <span className="shrink-0 font-mono text-[10px] text-(--color-text-faint)">{o.code}</span>
                </label>
              ))}
              {shown.length === 0 && <p className="px-3 py-3 text-xs text-(--color-text-muted)">Topilmadi</p>}
            </div>
          </div>
        )}

        {(kind === 'PAYROLL' || kind === 'HEADCOUNT' || kind === 'EXPENSE') && (
          <div>
            <p className="mb-2 text-xs font-semibold text-(--color-text-muted)">Bo&apos;limlar (ixtiyoriy — tanlanmasa, hammasi) · {deps.length} ta</p>
            <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
              {sources.departments.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setDeps((x) => toggle(x, d.id))}
                  className={cn('rounded-full px-2.5 py-1 text-xs ring-1', deps.includes(d.id) ? 'bg-brand-50 font-semibold text-brand-700 ring-brand-300' : 'bg-white text-(--color-text-muted) ring-(--color-line)')}
                >
                  {d.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}