'use client';

import { DiffCell, MoneyCell, NameCell, PctCell, ReportCard, RTable, Td, Th, Tr, changeOf } from '@/components/report/report';
import { EmptyNote, MiniButton, NotesList, pctPlain, StatusBadge } from '@/components/report/report-extra-b';
import { formatPeriod } from '@/lib/format';
import { cn, cap } from '@/lib/utils';
import { KIND_TEXT, type StructureKind, type StructureNode, type StructureTree } from './api';
import { forecastYear, toNums } from './stats';

// ═══════════════════════════════════════════════════════════
// Tahliliy jadvallar (avvalgi «modellar» — grafiklarsiz):
//  o'zgarish omillari, yangi va yo'qolgan moddalar, ABC (Pareto), g'ayrioddiy oylar, yil prognozi.
// ═══════════════════════════════════════════════════════════


export function Models({ kind, tree, onOpen }: { kind: StructureKind; tree: StructureTree; onOpen: (node: StructureNode) => void }) {
  const insights = tree.insights;
  const word = KIND_TEXT[kind].word;
  const growthGood = kind === 'income';
  const byKey = new Map(tree.nodes.map((n) => [n.key, n]));
  const open = (key: string) => {
    const node = byKey.get(key);
    if (node) onOpen(node);
  };

  // O'zgarish omillari: eng ko'p o'sgan va kamaygan moddalar (so'mda)
  const withDelta = tree.nodes.map((n) => ({ n, d: Number(n.amountTiyin) - Number(n.previousTiyin) }));
  const risers = withDelta.filter((x) => x.d > 0).sort((a, b) => b.d - a.d).slice(0, 7);
  const fallers = withDelta.filter((x) => x.d < 0).sort((a, b) => a.d - b.d).slice(0, 7);
  const totalDelta = Number(tree.totalTiyin) - Number(tree.previousTotalTiyin);
  const appeared = tree.nodes.filter((n) => Number(n.previousTiyin) === 0 && Number(n.amountTiyin) > 0);
  const vanished = tree.nodes.filter((n) => Number(n.amountTiyin) === 0 && Number(n.previousTiyin) > 0);

  // Prognoz: jami va eng katta 8 modda
  const totalForecast = forecastYear(tree.months, toNums(tree.totalTrend), tree.range.to);
  const nodeForecasts = tree.nodes
    .slice(0, 8)
    .map((n) => ({ n, f: forecastYear(tree.months, toNums(n.trend), tree.range.to) }))
    .filter((x): x is { n: StructureNode; f: NonNullable<typeof x.f> } => x.f !== null);

  if (tree.nodes.length === 0) return null;

  const driverRows = [...risers, ...fallers];
  const pareto = insights?.pareto.slice(0, 15) ?? [];
  const abcCounts = { A: 0, B: 0, C: 0 };
  insights?.pareto.forEach((p) => (abcCounts[p.abc] += 1));

  return (
    <div className="space-y-4">
      {insights && insights.notes.length > 0 && (
        <ReportCard title="Asosiy xulosalar" badge={`${tree.levelLabel} darajasida · ${tree.compareLabel}ga nisbatan`}>
          <NotesList notes={insights.notes} />
        </ReportCard>
      )}

      <ReportCard title="O'zgarish omillari" badge={`${cap(word)} ${tree.compareLabel}ga nisbatan ${totalDelta >= 0 ? '+' : ''}${Math.round(totalDelta / 100).toLocaleString('ru-RU')} so'm`}>
        {driverRows.length === 0 ? (
          <EmptyNote>O&apos;zgargan modda yo&apos;q</EmptyNote>
        ) : (
          <RTable minWidth={880}>
            <thead>
              <tr>
                <Th className="text-left">Modda</Th>
                <Th>{cap(tree.compareLabel)}</Th>
                <Th>Joriy davr</Th>
                <Th>Farqi, foizda</Th>
                <Th>Umumiy o&apos;zgarishdagi hissasi</Th>
                <Th className="w-24" />
              </tr>
            </thead>
            <tbody>
              {driverRows.map(({ n, d }) => (
                <Tr key={n.key} onClick={() => onOpen(n)}>
                  <NameCell sticky={false} sub={d > 0 ? "o'sgan" : 'kamaygan'}>
                    {n.label}
                  </NameCell>
                  <MoneyCell value={Number(n.previousTiyin)} />
                  <MoneyCell value={Number(n.amountTiyin)} strong />
                  <DiffCell value={d} pct={Number(n.previousTiyin) === 0 ? null : changeOf(Number(n.amountTiyin), Number(n.previousTiyin))} growthGood={growthGood} />
                  <Td className="text-(--color-text-muted)">{totalDelta !== 0 ? pctPlain((d / Math.abs(totalDelta)) * 100) : ''}</Td>
                  <Td>
                    <MiniButton onClick={() => onOpen(n)}>Batafsil</MiniButton>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </RTable>
        )}
      </ReportCard>

      {(appeared.length > 0 || vanished.length > 0) && (
        <ReportCard title="Yangi va yo'qolgan moddalar" badge={`yangi ${appeared.length} ta · yo'qolgan ${vanished.length} ta`}>
          <RTable minWidth={700}>
            <thead>
              <tr>
                <Th className="text-left">Modda</Th>
                <Th>Holat</Th>
                <Th>{cap(tree.compareLabel)}</Th>
                <Th>Joriy davr</Th>
              </tr>
            </thead>
            <tbody>
              {[...appeared.map((n) => ({ n, s: 'new' as const })), ...vanished.map((n) => ({ n, s: 'gone' as const }))].map(({ n, s }) => (
                <Tr key={n.key} onClick={() => onOpen(n)}>
                  <NameCell sticky={false}>{n.label}</NameCell>
                  <Td>
                    <StatusBadge tone={s === 'new' ? 'blue' : 'muted'}>{s === 'new' ? 'yangi paydo bo‘lgan' : 'bu davrda yo‘q'}</StatusBadge>
                  </Td>
                  <MoneyCell value={Number(n.previousTiyin)} />
                  <MoneyCell value={Number(n.amountTiyin)} strong />
                </Tr>
              ))}
            </tbody>
          </RTable>
        </ReportCard>
      )}

      {insights && pareto.length > 0 && (
        <ReportCard
          title="ABC tahlili (Pareto)"
          badge={`A — ${abcCounts.A} ta, B — ${abcCounts.B} ta, C — ${abcCounts.C} ta · jamlanish: ${insights.concentration} (samarali ${insights.effectiveCount.toFixed(1).replace('.', ',')} ta modda)`}
        >
          <RTable minWidth={760}>
            <thead>
              <tr>
                <Th className="w-12">№</Th>
                <Th className="text-left">Modda</Th>
                <Th>Ulushi</Th>
                <Th>Jamlanma ulush</Th>
                <Th>Guruh</Th>
              </tr>
            </thead>
            <tbody>
              {pareto.map((p, i) => (
                <Tr key={p.key} onClick={() => open(p.key)}>
                  <Td className="text-(--color-text-faint)">{i + 1}</Td>
                  <NameCell sticky={false}>{p.label}</NameCell>
                  <Td className="font-semibold">{pctPlain(p.sharePercent)}</Td>
                  <Td className="text-(--color-text-muted)">{pctPlain(p.cumulativePercent)}</Td>
                  <Td>
                    <StatusBadge tone={p.abc === 'A' ? 'blue' : p.abc === 'B' ? 'amber' : 'muted'}>{p.abc}</StatusBadge>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </RTable>
          <p className="px-5 pb-4 text-xs text-(--color-text-muted)">
            A — {word}ning ~80% ini beradigan moddalar (asosiy e&apos;tibor), B — keyingi ~15%, C — qolgan mayda moddalar. {insights.paretoCount} ta modda {word}ning 80% ini tashkil qiladi.
          </p>
        </ReportCard>
      )}

      {insights && insights.anomalies.length > 0 && (
        <ReportCard title="G'ayrioddiy oylar" badge="oy summasi odatdagidan keskin farq qilgan moddalar">
          <RTable minWidth={760}>
            <thead>
              <tr>
                <Th className="text-left">Modda</Th>
                <Th>Oy</Th>
                <Th>Shu oy</Th>
                <Th>O&apos;rtacha oy</Th>
                <Th>Farqi, foizda</Th>
              </tr>
            </thead>
            <tbody>
              {insights.anomalies.map((a) => (
                <Tr key={`${a.key}-${a.period}`} onClick={() => open(a.key)}>
                  <NameCell sticky={false} sub={`z = ${a.z.toFixed(1).replace('.', ',')}`}>
                    {a.label}
                  </NameCell>
                  <Td className="whitespace-nowrap">{formatPeriod(a.period)}</Td>
                  <MoneyCell value={Number(a.lastTiyin)} strong />
                  <MoneyCell value={Number(a.averageTiyin)} />
                  <DiffCell value={Number(a.lastTiyin) - Number(a.averageTiyin)} pct={changeOf(Number(a.lastTiyin), Number(a.averageTiyin))} growthGood={growthGood} />
                </Tr>
              ))}
            </tbody>
          </RTable>
        </ReportCard>
      )}

      {totalForecast && (
        <ReportCard title={`${totalForecast.year}-yil yakuni prognozi`} badge="yil boshidan fakt + so'nggi 3 oy o'rtachasi × qolgan oylar">
          <RTable minWidth={900}>
            <thead>
              <tr>
                <Th className="text-left">Modda</Th>
                <Th>Yil boshidan fakt</Th>
                <Th>Oylik sur&apos;at</Th>
                <Th>Yil yakuni prognozi</Th>
                <Th>O&apos;tgan yil</Th>
                <Th>O&apos;zgarish</Th>
              </tr>
            </thead>
            <tbody>
              {[{ n: null as StructureNode | null, f: totalForecast }, ...nodeForecasts].map(({ n, f }) => (
                <Tr key={n?.key ?? '__total'} total={n === null} onClick={n ? () => onOpen(n) : undefined}>
                  <NameCell sticky={false}>{n ? n.label : `Jami ${word}`}</NameCell>
                  <MoneyCell value={f.factTiyin} />
                  <MoneyCell value={f.basisTiyin} />
                  <MoneyCell value={f.forecastTiyin} strong />
                  <MoneyCell value={f.lastYearTiyin ?? 0} className={cn(f.lastYearTiyin === null && 'text-(--color-text-faint)')} />
                  <PctCell value={f.lastYearTiyin ? changeOf(f.forecastTiyin, f.lastYearTiyin) : null} growthGood={growthGood} />
                </Tr>
              ))}
            </tbody>
          </RTable>
          <p className="px-5 pb-4 text-xs text-(--color-text-muted)">Mavsumiylik hisobga olinmaydi — bu yo&apos;nalishni ko&apos;rsatuvchi taxmin, aniq reja emas.</p>
        </ReportCard>
      )}
    </div>
  );
}
