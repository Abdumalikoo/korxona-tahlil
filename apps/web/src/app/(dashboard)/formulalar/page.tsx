'use client';

import { FullOnly } from '@/components/layout/full-only';
import { PageHeader } from '@/components/layout/page-header';
import { CalcButton } from '@/components/ui/calc';
import { Card } from '@/components/ui/card';
import { GROUPS, HELP_FORMULAS, TERMS, type HelpFormula, type HelpGroup } from '@/features/help/catalog';
import { cn } from '@/lib/utils';
import { useEffect, useMemo, useState } from 'react';

/**
 * Formulalar va atamalar — dasturdagi hamma hisob bir joyda:
 * formula, ma'nosi, qayerda ishlatiladi va oddiy sonlar bilan to'liq ishlangan misol.
 * Sahifadagi istalgan raqamning «Qanday hisoblandi?» oynasidan shu yerga havola bor (/formulalar#id).
 */
function FormulalarPageFull() {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<HelpGroup | 'all' | 'terms'>('all');

  // Havola bilan kelganda (#change) — o'sha formulaga o'tiladi va ajratib ko'rsatiladi
  const [focus, setFocus] = useState<string | null>(null);
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;
    setFocus(id);
    const t = setTimeout(() => document.getElementById(`f-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150);
    return () => clearTimeout(t);
  }, []);

  const q = query.trim().toLowerCase();
  const match = (text: string) => !q || text.toLowerCase().includes(q);

  const formulas = useMemo(
    () =>
      HELP_FORMULAS.filter(
        (f) => (group === 'all' || f.group === group) && (match(f.name) || f.formula.some(match) || match(f.meaning) || match(f.where ?? '')),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [group, q],
  );
  const terms = TERMS.filter((t) => match(t.term) || match(t.text));
  const showTerms = group === 'all' || group === 'terms';
  const showFormulas = group !== 'terms';

  return (
    <>
      <PageHeader title="Formulalar va atamalar" description="Dasturdagi har bir raqam qanday hisoblanadi — formula, ma'nosi va misol" />
      <div className="space-y-5 p-4 md:p-6">
        {/* Qidiruv va bo'limlar */}
        <Card className="space-y-3 p-4">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Qidirish: masalan, rentabellik, ulush, prognoz…"
            className="h-10 w-full rounded-xl border border-(--color-line-strong) bg-white px-3 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
          />
          <div className="flex flex-wrap gap-1.5">
            {[{ key: 'all' as const, label: 'Hammasi' }, ...GROUPS, { key: 'terms' as const, label: 'Atamalar' }].map((g) => (
              <button
                key={g.key}
                type="button"
                onClick={() => setGroup(g.key)}
                className={cn(
                  'rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
                  group === g.key ? 'bg-brand-600 text-white' : 'bg-(--color-surface-muted) text-(--color-text-muted) hover:bg-brand-50 hover:text-brand-700',
                )}
              >
                {g.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-(--color-text-muted)">
            Saytdagi istalgan raqam tagidagi nuqtali chiziq yoki «ƒx» belgisini bossangiz, o&apos;sha raqamning aniq sonlar bilan ishlanishi ochiladi. Excel, slayd va
            PDF fayllarda ham xuddi shu formulalar «Hisob-kitob» qismida beriladi.
          </p>
        </Card>

        {showFormulas &&
          GROUPS.filter((g) => group === 'all' || g.key === group).map((g) => {
            const list = formulas.filter((f) => f.group === g.key);
            if (list.length === 0) return null;
            return (
              <section key={g.key} className="space-y-3">
                <div>
                  <h2 className="text-lg font-bold text-heading">{g.label}</h2>
                  <p className="text-sm text-(--color-text-muted)">{g.hint}</p>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  {list.map((f) => (
                    <FormulaCard key={f.id} f={f} focused={focus === f.id} />
                  ))}
                </div>
              </section>
            );
          })}

        {showTerms && terms.length > 0 && (
          <section className="space-y-3">
            <div>
              <h2 className="text-lg font-bold text-heading">Atamalar</h2>
              <p className="text-sm text-(--color-text-muted)">Dasturda ishlatiladigan so&apos;zlar nimani anglatadi</p>
            </div>
            <Card className="divide-y divide-(--color-line) overflow-hidden">
              {terms.map((t) => (
                <div key={t.term} className="grid gap-1 px-4 py-3 sm:grid-cols-[14rem_1fr] sm:gap-4">
                  <p className="text-sm font-semibold text-heading">{t.term}</p>
                  <p className="text-sm text-(--color-text)">{t.text}</p>
                </div>
              ))}
            </Card>
          </section>
        )}

        {formulas.length === 0 && (!showTerms || terms.length === 0) && (
          <Card className="p-8 text-center text-sm text-(--color-text-muted)">«{query}» bo&apos;yicha hech narsa topilmadi.</Card>
        )}
      </div>
    </>
  );
}

function FormulaCard({ f, focused }: { f: HelpFormula; focused: boolean }) {
  return (
    <Card id={`f-${f.id}`} className={cn('scroll-mt-28 space-y-3 p-4 transition-shadow', focused && 'ring-2 ring-brand-400')}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold text-heading">{f.name}</h3>
        {f.example && <CalcButton calc={f.example} />}
      </div>
      <div className="space-y-1.5 rounded-lg bg-(--color-surface-muted) px-3 py-2">
        {f.formula.map((line) => (
          <p key={line} className="text-sm font-medium text-heading">
            {line}
          </p>
        ))}
      </div>
      <p className="text-sm text-(--color-text)">{f.meaning}</p>
      {f.where && (
        <p className="text-xs text-(--color-text-muted)">
          <span className="font-semibold">Qayerda:</span> {f.where}
        </p>
      )}
      {f.example && (
        <div className="rounded-lg border border-dashed border-(--color-line-strong) px-3 py-2">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-(--color-text-faint)">Misol</p>
          <ol className="space-y-0.5 text-sm tabular-nums">
            {f.example.steps.map((s, i) => (
              <li key={i} className="text-heading">
                {s}
              </li>
            ))}
          </ol>
          <p className="mt-1 text-sm">
            <span className="text-(--color-text-muted)">Javob: </span>
            <span className="font-bold text-brand-700">{f.example.result}</span>
          </p>
          {f.example.note && <p className="mt-1 text-xs text-(--color-text-muted)">{f.example.note}</p>}
        </div>
      )}
    </Card>
  );
}

/** Qisqa rejimda — bu bo'lim ochilmaydi (faqat To'liq rejimda) */
export default function FormulalarPage() {
  return (
    <FullOnly title="Formulalar" what="Dasturdagi har bir ko'rsatkich qanday formula bilan hisoblanishi.">
      <FormulalarPageFull />
    </FullOnly>
  );
}