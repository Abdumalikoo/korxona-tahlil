'use client';

import { formatDate, formatPeriod } from '@/lib/format';
import { cn } from '@/lib/utils';
import { changeTone, compact, KIND_TEXT, pct, TONE, type StructureKind, type StructureNode, type StructureTree } from './api';
import { ABC_COLORS, GrowthMap, HhiScale, Legend, Pareto, SectionBars, VOLATILITY_LINE, Waterfall, type MapPoint } from './charts';
import { changeText } from './explorer-views';
import { Findings, GroupTitle, ModelCard } from './parts';
import { changePct, forecastYear, lastN, toNums, trendPerMonth, variation } from './stats';

const TH = 'py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[--color-text-muted]';

function cap(text: string): string {
  return text[0]!.toUpperCase() + text.slice(1);
}

function signedCompact(value: number): string {
  if (value === 0) return '0';
  return `${value > 0 ? '+' : '−'}${compact(Math.abs(value))}`;
}

// ═══════════════════════════════════════════════════════════
// O'sganlar va kamayganlar
// ═══════════════════════════════════════════════════════════

function MoversList({
  title,
  items,
  kind,
  onOpen,
}: {
  title: string;
  items: StructureNode[];
  kind: StructureKind;
  onOpen: (node: StructureNode) => void;
}) {
  const max = Math.max(...items.map((n) => Math.abs(Number(n.amountTiyin) - Number(n.previousTiyin))), 1);
  return (
    <div>
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[--color-text-muted]">{title}</h4>
      {items.length === 0 ? (
        <p className="py-3 text-sm text-[--color-text-faint]">Yo&apos;q</p>
      ) : (
        <ul className="divide-y divide-[--color-line]">
          {items.map((node) => {
            const delta = Number(node.amountTiyin) - Number(node.previousTiyin);
            const tone = changeTone(kind, delta > 0 ? 100 : -100);
            return (
              <li key={node.key}>
                <button type="button" onClick={() => onOpen(node)} className="grid w-full grid-cols-[1fr_auto] items-center gap-x-3 py-2 text-left text-sm hover:bg-[--color-surface-muted]">
                  <span className="min-w-0">
                    <span className="block truncate" title={node.label}>{node.label}</span>
                    <span className="mt-1 block h-1 bg-[--color-surface-sunken]">
                      <span className="block h-full" style={{ width: `${(Math.abs(delta) / max) * 100}%`, background: delta > 0 === (kind === 'income') ? TONE.income : TONE.expense }} />
                    </span>
                  </span>
                  <span className="text-right">
                    <span className={cn('block font-medium tabular-nums', tone)}>{signedCompact(delta)}</span>
                    <span className="block text-xs tabular-nums text-[--color-text-muted]">{changeText(node.changePercent, node.amountTiyin)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Barcha modellar
// ═══════════════════════════════════════════════════════════

export function Models({ kind, tree, onOpen }: { kind: StructureKind; tree: StructureTree; onOpen: (node: StructureNode) => void }) {
  const insights = tree.insights;
  if (!insights || tree.nodes.length === 0) return null;
  const word = KIND_TEXT[kind].word;
  const Word = cap(word);
  const compareLabel = tree.compareLabel;
  const delta = Number(tree.totalTiyin) - Number(tree.previousTotalTiyin);
  const upWord = kind === 'expense' ? 'oshirgan (yomon)' : 'oshirgan (yaxshi)';
  const downWord = kind === 'expense' ? 'kamaytirgan (yaxshi)' : 'kamaytirgan (yomon)';
  const abcCounts = { A: 0, B: 0, C: 0 };
  insights.pareto.forEach((p) => (abcCounts[p.abc] += 1));

  // O'sganlar / kamayganlar / yangi / yo'qolgan
  const withDelta = tree.nodes.map((n) => ({ n, d: Number(n.amountTiyin) - Number(n.previousTiyin) }));
  const risers = withDelta.filter((x) => x.d > 0).sort((a, b) => b.d - a.d).slice(0, 5).map((x) => x.n);
  const fallers = withDelta.filter((x) => x.d < 0).sort((a, b) => a.d - b.d).slice(0, 5).map((x) => x.n);
  const appeared = tree.nodes.filter((n) => Number(n.previousTiyin) === 0 && Number(n.amountTiyin) > 0);
  const vanished = tree.nodes.filter((n) => Number(n.amountTiyin) === 0 && Number(n.previousTiyin) > 0);

  // Moddalar xaritasi
  const points: MapPoint[] = tree.nodes
    .map((n) => {
      const values = toNums(lastN(n.trend, 12));
      const growth = trendPerMonth(values);
      const volatility = variation(values);
      return growth === null || volatility === null || values.filter((v) => v > 0).length < 4
        ? null
        : { key: n.key, label: n.label, growth, volatility, amount: Number(n.amountTiyin) };
    })
    .filter((p): p is MapPoint => p !== null && p.amount > 0);
  const growingStable = points.filter((p) => p.growth >= 2 && p.volatility < VOLATILITY_LINE);

  // Prognoz
  const totalForecast = forecastYear(tree.months, toNums(tree.totalTrend), tree.range.to);
  const nodeForecasts = tree.nodes
    .slice(0, 8)
    .map((n) => ({ n, f: forecastYear(tree.months, toNums(n.trend), tree.range.to) }))
    .filter((x) => x.f !== null);

  let index = 0;
  const next = () => (index += 1);

  return (
    <div className="space-y-4">
      <GroupTitle title="Tahliliy modellar" description={`${tree.levelLabel} darajasida · solishtirish: ${compareLabel}`} />

      <Findings notes={insights.notes} />

      <div className="grid gap-4 xl:grid-cols-2">
        <ModelCard
          index={next()}
          title="O'zgarish omillari"
          question={`${Word} ${compareLabel}ga nisbatan nima hisobiga o'zgardi?`}
          aside={
            <>
              <p className={cn('text-base font-semibold tabular-nums', changeTone(kind, tree.changePercent))}>{signedCompact(delta)}</p>
              <p className="text-[11px] text-[--color-text-muted]">{pct(tree.changePercent, true)}</p>
            </>
          }
          howTo={
            <>
              Yuqori qator — {compareLabel} ({formatDate(tree.previousRange.from)} — {formatDate(tree.previousRange.to)}), pastki — joriy davr. Oradagi har bir modda
              summani qancha {upWord} yoki {downWord}. Ingichka vertikal chiziq — avvalgi daraja.
            </>
          }
        >
          <Waterfall kind={kind} previousTiyin={tree.previousTotalTiyin} currentTiyin={tree.totalTiyin} drivers={insights.drivers} />
        </ModelCard>

        <ModelCard
          index={next()}
          title="Eng ko'p o'sganlar va kamayganlar"
          question={`Qaysi moddalar so'mda eng ko'p o'zgardi?`}
          aside={
            <>
              <p className="text-base font-semibold tabular-nums">
                {appeared.length} / {vanished.length}
              </p>
              <p className="text-[11px] text-[--color-text-muted]">yangi / yo&apos;qolgan</p>
            </>
          }
          howTo={
            <>
              Farq — joriy davr minus {compareLabel}. Chiziq uzunligi — farqning kattaligi. «Yangi» — avval bo&apos;lmagan, «yo&apos;qolgan» — endi yo&apos;q moddalar.
              Qatorni bosing — modda kartasi ochiladi.
            </>
          }
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <MoversList title={kind === 'expense' ? "O'sganlar (xarajat oshgan)" : "O'sganlar (daromad oshgan)"} items={risers} kind={kind} onOpen={onOpen} />
            <MoversList title={kind === 'expense' ? 'Kamayganlar (tejalgan)' : 'Kamayganlar (daromad tushgan)'} items={fallers} kind={kind} onOpen={onOpen} />
          </div>
          {(appeared.length > 0 || vanished.length > 0) && (
            <p className="mt-3 border-t border-[--color-line] pt-3 text-xs leading-relaxed text-[--color-text-muted]">
              {appeared.length > 0 && (
                <>
                  <b className="text-[--color-text]">Yangi:</b> {appeared.slice(0, 4).map((n) => n.label).join(', ')}
                  {appeared.length > 4 ? ` va yana ${appeared.length - 4} ta` : ''}.{' '}
                </>
              )}
              {vanished.length > 0 && (
                <>
                  <b className="text-[--color-text]">Yo&apos;qolgan:</b> {vanished.slice(0, 4).map((n) => n.label).join(', ')}
                  {vanished.length > 4 ? ` va yana ${vanished.length - 4} ta` : ''}.
                </>
              )}
            </p>
          )}
        </ModelCard>

        <ModelCard
          index={next()}
          title="Pareto 80/20 va ABC tahlili"
          question={`${Word}ning asosiy qismi nechta moddaga to'g'ri keladi?`}
          aside={
            <>
              <p className="text-base font-semibold tabular-nums">
                {insights.paretoCount} / {tree.nodes.length}
              </p>
              <p className="text-[11px] text-[--color-text-muted]">moddada 80%</p>
            </>
          }
          howTo={
            <>
              Ustun — moddaning ulushi (chap o&apos;q), chiziq — yig&apos;ilib boruvchi ulush (o&apos;ng o&apos;q). Chiziq 80% ga yetgan joygacha bo&apos;lgan moddalar — A
              guruh: nazorat birinchi navbatda shularga qaratiladi.
            </>
          }
        >
          <Pareto items={insights.pareto} />
          <div className="mt-2">
            <Legend
              items={[
                { color: ABC_COLORS.A, label: `A — asosiy, 80% (${abcCounts.A} ta)` },
                { color: ABC_COLORS.B, label: `B — o'rta, 15% (${abcCounts.B} ta)` },
                { color: ABC_COLORS.C, label: `C — mayda, 5% (${abcCounts.C} ta)` },
                { color: TONE.ink, label: 'Jamlanma ulush', line: true },
              ]}
            />
          </div>
        </ModelCard>

        <ModelCard
          index={next()}
          title="Konsentratsiya indeksi (HHI)"
          question={`${Word} bir-ikki moddaga to'planganmi yoki teng taqsimlanganmi?`}
          aside={
            <>
              <p className="text-base font-semibold tabular-nums">{insights.hhi.toLocaleString('ru-RU')}</p>
              <p className="text-[11px] text-[--color-text-muted]">{insights.concentration}</p>
            </>
          }
          howTo={
            <>
              HHI — ulushlar kvadratlarining yig&apos;indisi (0 — to&apos;liq tarqoq, 10 000 — hammasi bitta moddada). 2 500 dan yuqori bo&apos;lsa, bitta modda
              o&apos;zgarishi umumiy natijaga kuchli ta&apos;sir qiladi.
            </>
          }
        >
          <HhiScale hhi={insights.hhi} concentration={insights.concentration} />
          <dl className="mt-5 grid grid-cols-3 gap-4 border-t border-[--color-line] pt-4 text-sm">
            <div>
              <dt className="text-xs text-[--color-text-muted]">Samarali soni</dt>
              <dd className="mt-0.5 text-lg font-semibold tabular-nums">{String(insights.effectiveCount).replace('.', ',')}</dd>
              <dd className="text-xs text-[--color-text-faint]">haqiqiy {tree.nodes.length} tadan</dd>
            </div>
            <div>
              <dt className="text-xs text-[--color-text-muted]">Eng katta ulush</dt>
              <dd className="mt-0.5 text-lg font-semibold tabular-nums">{pct(tree.nodes[0]?.sharePercent ?? 0)}</dd>
              <dd className="truncate text-xs text-[--color-text-faint]" title={tree.nodes[0]?.label}>{tree.nodes[0]?.label}</dd>
            </div>
            <div>
              <dt className="text-xs text-[--color-text-muted]">Top-3 ulushi</dt>
              <dd className="mt-0.5 text-lg font-semibold tabular-nums">{pct(tree.nodes.slice(0, 3).reduce((s, n) => s + n.sharePercent, 0))}</dd>
              <dd className="text-xs text-[--color-text-faint]">eng katta 3 modda</dd>
            </div>
          </dl>
        </ModelCard>

        <ModelCard
          index={next()}
          title="G'ayrioddiy o'zgarishlar"
          question="So'nggi 3 oyda qaysi moddalar odatdagidan keskin farq qildi?"
          aside={
            <>
              <p className="text-base font-semibold tabular-nums">{insights.anomalies.length}</p>
              <p className="text-[11px] text-[--color-text-muted]">ta topildi</p>
            </>
          }
          howTo={
            <>
              Har oy moddaning oldingi 12 oylik o&apos;rtachasi bilan solishtiriladi. z-ball — og&apos;ish necha standart chetlanishga teng; |z| ≥ 2 va farq 15% dan
              katta bo&apos;lsa, belgilanadi. Qatorni bosing — modda kartasi ochiladi.
            </>
          }
        >
          {insights.anomalies.length === 0 ? (
            <p className="py-6 text-center text-sm text-[--color-text-muted]">Keskin farq qilgan modda yo&apos;q — barcha moddalar odatdagi oraliqda.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[--color-line]">
                  <th className={cn(TH, 'text-left')}>Modda</th>
                  <th className={cn(TH, 'text-left')}>Oy</th>
                  <th className={cn(TH, 'text-right')}>Summa</th>
                  <th className={cn(TH, 'text-right')}>Odatda</th>
                  <th className={cn(TH, 'text-right')}>Necha barobar</th>
                  <th className={cn(TH, 'text-right')}>z</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[--color-line]">
                {insights.anomalies.map((a) => {
                  const bad = kind === 'expense' ? a.z > 0 : a.z < 0;
                  const node = tree.nodes.find((n) => n.key === a.key);
                  const ratio = Number(a.averageTiyin) > 0 ? Number(a.lastTiyin) / Number(a.averageTiyin) : null;
                  return (
                    <tr key={`${a.key}-${a.period}`} className={cn(node && 'cursor-pointer hover:bg-[--color-surface-muted]')} onClick={() => node && onOpen(node)}>
                      <td className="max-w-[11rem] truncate py-2 pr-2" title={a.label}>{a.label}</td>
                      <td className="whitespace-nowrap py-2 pr-2 text-[--color-text-muted]">{formatPeriod(a.period)}</td>
                      <td className="whitespace-nowrap py-2 text-right font-medium tabular-nums">{compact(a.lastTiyin)}</td>
                      <td className="whitespace-nowrap py-2 text-right tabular-nums text-[--color-text-muted]">{compact(a.averageTiyin)}</td>
                      <td className="whitespace-nowrap py-2 text-right tabular-nums">{ratio === null ? '—' : `×${ratio.toFixed(1).replace('.', ',')}`}</td>
                      <td className="whitespace-nowrap py-2 pl-2 text-right font-semibold tabular-nums" style={{ color: bad ? TONE.expense : TONE.income }}>
                        {a.z > 0 ? '+' : '−'}
                        {Math.abs(a.z).toFixed(1).replace('.', ',')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </ModelCard>

        <ModelCard
          index={next()}
          title="Moddalar xaritasi: o'sish va barqarorlik"
          question="Qaysi moddalar tez o'smoqda va qaysilari oldindan aytib bo'lmaydigan darajada sakraydi?"
          aside={
            <>
              <p className="text-base font-semibold tabular-nums">{growingStable.length}</p>
              <p className="text-[11px] text-[--color-text-muted]">barqaror o&apos;smoqda</p>
            </>
          }
          howTo={
            <>
              Gorizontal — o&apos;sish sur&apos;ati (12 oylik trend, oyiga %), vertikal — oydan oyga tebranish (CV). Doira kattaligi — summa. O&apos;ng past burchak —
              barqaror o&apos;sayotgan moddalar{kind === 'expense' ? " (xarajat uchun eng xavflisi: sekin, lekin to'xtovsiz o'sadi)" : ' (daromad uchun eng yaxshisi)'}; yuqori qism
              — {VOLATILITY_LINE}% dan ko&apos;p tebranadigan, rejalashtirish qiyin moddalar.
            </>
          }
        >
          {points.length < 2 ? (
            <p className="py-6 text-center text-sm text-[--color-text-muted]">Xarita uchun kamida 4 oylik ma&apos;lumoti bor 2 ta modda kerak.</p>
          ) : (
            <GrowthMap points={points} kind={kind} />
          )}
        </ModelCard>

        {totalForecast && (
          <ModelCard
            index={next()}
            title={`${totalForecast.year}-yil yakuni prognozi`}
            question={`Shu sur'at davom etsa, yil oxirigacha ${word} qancha bo'ladi?`}
            aside={
              <>
                <p className="text-base font-semibold tabular-nums">{compact(totalForecast.forecastTiyin)}</p>
                <p className="text-[11px] text-[--color-text-muted]">
                  {totalForecast.lastYearTiyin ? `${pct(changePct(totalForecast.forecastTiyin, totalForecast.lastYearTiyin), true)} o'tgan yilga` : 'prognoz'}
                </p>
              </>
            }
            howTo={
              <>
                Prognoz = yil boshidan to&apos;liq o&apos;tgan oylar fakti + so&apos;nggi 3 to&apos;liq oy o&apos;rtachasi × qolgan {totalForecast.remainingMonths} oy. Bu mavsumiylikni
                hisobga olmaydigan oddiy baho — yo&apos;nalishni ko&apos;rsatadi, aniq reja emas.
              </>
            }
          >
            <dl className="grid grid-cols-3 gap-4 border-b border-[--color-line] pb-4">
              <div>
                <dt className="text-xs text-[--color-text-muted]">Yil boshidan fakt</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums">{compact(totalForecast.factTiyin)}</dd>
                <dd className="text-xs text-[--color-text-faint]">
                  {totalForecast.lastYearToDateTiyin !== null ? `o'tgan yil shu vaqtgacha ${compact(totalForecast.lastYearToDateTiyin)}` : `${12 - totalForecast.remainingMonths} oy`}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[--color-text-muted]">Oylik sur&apos;at</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums">{compact(totalForecast.basisTiyin)}</dd>
                <dd className="text-xs text-[--color-text-faint]">so&apos;nggi 3 oy o&apos;rtachasi</dd>
              </div>
              <div>
                <dt className="text-xs text-[--color-text-muted]">O&apos;tgan yil jami</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums">{totalForecast.lastYearTiyin === null ? '—' : compact(totalForecast.lastYearTiyin)}</dd>
                <dd className="text-xs text-[--color-text-faint]">{totalForecast.year - 1}-yil</dd>
              </div>
            </dl>
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="border-b border-[--color-line]">
                  <th className={cn(TH, 'text-left')}>Modda</th>
                  <th className={cn(TH, 'text-right')}>Fakt</th>
                  <th className={cn(TH, 'text-right')}>Prognoz</th>
                  <th className={cn(TH, 'text-right')}>O&apos;tgan yil</th>
                  <th className={cn(TH, 'text-right')}>Farq</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[--color-line]">
                {nodeForecasts.map(({ n, f }) => {
                  const change = f!.lastYearTiyin ? changePct(f!.forecastTiyin, f!.lastYearTiyin) : null;
                  return (
                    <tr key={n.key} className="cursor-pointer hover:bg-[--color-surface-muted]" onClick={() => onOpen(n)}>
                      <td className="max-w-[12rem] truncate py-1.5 pr-2" title={n.label}>{n.label}</td>
                      <td className="whitespace-nowrap py-1.5 text-right tabular-nums text-[--color-text-muted]">{compact(f!.factTiyin)}</td>
                      <td className="whitespace-nowrap py-1.5 text-right font-medium tabular-nums">{compact(f!.forecastTiyin)}</td>
                      <td className="whitespace-nowrap py-1.5 text-right tabular-nums text-[--color-text-muted]">{f!.lastYearTiyin === null ? '—' : compact(f!.lastYearTiyin)}</td>
                      <td className={cn('whitespace-nowrap py-1.5 pl-2 text-right tabular-nums', changeTone(kind, change))}>{change === null ? '—' : pct(change, true)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ModelCard>
        )}

        {insights.sectionTrend && (
          <ModelCard
            index={next()}
            className="xl:col-span-2"
            title="Doimiy va bir martalik tarkib"
            question="So'nggi 12 oyda bir martalik (Boshqa) ulushi o'sib ketmayaptimi?"
            aside={(() => {
              const rows = lastN(insights.sectionTrend, 12);
              const prevRows = insights.sectionTrend.length >= 24 ? insights.sectionTrend.slice(-24, -12) : null;
              const share = (list: typeof rows) => {
                const d = list.reduce((s, r) => s + Number(r.doimiyTiyin), 0);
                const b = list.reduce((s, r) => s + Number(r.boshqaTiyin), 0);
                return d + b > 0 ? (b / (d + b)) * 100 : 0;
              };
              return (
                <>
                  <p className="text-base font-semibold tabular-nums">{pct(share(rows))}</p>
                  <p className="text-[11px] text-[--color-text-muted]">{prevRows ? `bir martalik · avvalgi 12 oyda ${pct(share(prevRows))}` : 'bir martalik ulush'}</p>
                </>
              );
            })()}
            howTo="To'q qism — muntazam takrorlanadigan (Doimiy), och qism — bir martalik (Boshqa). Och qism oydan oyga kattalashsa, rejalashtirilmagan summalar ko'paymoqda."
          >
            <SectionBars rows={lastN(insights.sectionTrend, 12)} />
          </ModelCard>
        )}
      </div>
    </div>
  );
}