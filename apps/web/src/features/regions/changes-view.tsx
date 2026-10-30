'use client';

import {
  ActionButton,
  changeOf,
  DiffCell,
  ExcelButton,
  GroupTh,
  MoneyCell,
  NameCell,
  PillTabs,
  ReportCard,
  RTable,
  SearchInput,
  StatTiles,
  STICKY_NAME,
  STICKY_NO,
  TableNote,
  Td,
  Th,
  Tr,
  type StatTile,
} from '@/components/report/report';
import { count, CountCell, CountDiffCell, EmptyNote, LoadingCard } from '@/components/report/report-extra-c';
import { csvSom, downloadCsv } from '@/features/structure/stats';
import { formatDate, formatPeriod } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { changesApi, type ChangeKind, type ChangePerson } from './changes-api';
import { PinflText } from './pinfl-text';

// ═══════════════════════════════════════════════════════════
// Solishtirma › O'zgarishlar: bu oy nechta xodimga oylik hisoblandi (hududlar / Markaz),
// o'tgan oyga nisbatan — ishga olindi, qaytdi, bo'shatildi, ishlamadi, ko'chdi, oyligi keskin o'zgardi.
// Manba — ish haqi vedomostlari, xodimlar reestri (ishga kirgan / bo'shagan sana) va hudud tarixi.
// Oy — yuqoridagi asosiy «Davr» panelidan. Yagona hisobot uslubida: kartalar → hududlar jadvali → xodimlar jadvali.
// ═══════════════════════════════════════════════════════════

const KIND: Record<ChangeKind, { label: string; hint: string; cls: string; sign: string }> = {
  hired: { label: 'Ishga olindi', hint: "bu oy oylik bor, o'tgan oy yo'q — yangi xodim", cls: 'bg-emerald-50 text-emerald-700', sign: '+' },
  hiredUnpaid: { label: "Ishga olindi (oylik hali yo'q)", hint: "shu oy ishga kirgan, vedomostda hali yo'q", cls: 'bg-emerald-50/60 text-emerald-700', sign: '+' },
  returned: { label: 'Qaytdi', hint: "o'tgan oy oyligi yo'q edi (ta'til, dekret …), bu oy bor", cls: 'bg-sky-50 text-sky-700', sign: '+' },
  fired: { label: "Bo'shatildi", hint: "o'tgan oy oylik bor edi, ishdan bo'shagan", cls: 'bg-red-50 text-red-700', sign: '−' },
  idle: { label: 'Bu oy ishlamadi', hint: "o'tgan oy oylik bor edi, bu oy yo'q — lekin bo'shamagan", cls: 'bg-amber-50 text-amber-800', sign: '−' },
  moved: { label: "Ko'chdi", hint: "boshqa hudud yoki Markazga o'tgan", cls: 'bg-violet-50 text-violet-700', sign: '↔' },
  up: { label: 'Oyligi oshdi', hint: "20% dan ko'p", cls: 'bg-(--color-surface-sunken) text-heading', sign: '↑' },
  down: { label: 'Oyligi kamaydi', hint: "20% dan ko'p", cls: 'bg-(--color-surface-sunken) text-heading', sign: '↓' },
};
const ORDER: ChangeKind[] = ['hired', 'hiredUnpaid', 'returned', 'fired', 'idle', 'moved', 'up', 'down'];

/** Oy — yuqoridagi asosiy «Davr» panelidan (davr oxiri: o'sha oy yoki undan oldingi oxirgi ish haqi oyi) */
export function ChangesView({ to }: { to: string }) {
  const res = useAsync(() => changesApi.month({ to }).then((r) => r.data), [to]);
  const [kind, setKind] = useState<ChangeKind | 'all'>('all');
  // Tanlangan hudud — shu oy uchun; «Davr» o'zgarsa, filtr o'z-o'zidan bekor bo'ladi
  const [unitSel, setUnitSel] = useState<{ period: string; key: string } | null>(null);
  const [query, setQuery] = useState('');
  const data = res.data;

  if (!data) return <LoadingCard label="O'zgarishlar yuklanmoqda" error={res.error} onRetry={res.reload} />;
  const unit = unitSel?.period === data.period ? unitSel.key : null;
  const setUnit = (key: string | null) => setUnitSel(key ? { period: data.period, key } : null);

  const q = query.trim().toLowerCase();
  const people = data.people.filter(
    (p) => (kind === 'all' || p.kind === kind) && (!unit || p.unitKey === unit || p.fromUnitKey === unit) && (!q || `${p.fullName} ${p.pinfl} ${p.unitName} ${p.position ?? ''}`.toLowerCase().includes(q)),
  );
  const t = data.totals;
  const prevLabel = formatPeriod(data.previousPeriod);
  const curLabel = formatPeriod(data.period);

  const exportCsv = () =>
    downloadCsv(
      `solishtirma-ozgarishlar-${data.period}`,
      ['Holat', 'Xodim', 'JShShIR', 'Lavozim', 'Hudud / Markaz', 'Qayerdan', `${prevLabel}, so'm`, `${curLabel}, so'm`, 'Ishga kirgan', "Bo'shagan"],
      people.map((p) => [KIND[p.kind].label, p.fullName, p.pinfl, p.position ?? '', p.unitName, p.fromUnitName ?? '', csvSom(p.previousTiyin), csvSom(p.currentTiyin), p.hiredAt ? formatDate(p.hiredAt) : '', p.firedAt ? formatDate(p.firedAt) : '']),
    );

  const tiles: StatTile[] = [
    {
      label: 'Oylik hisoblandi',
      value: 0,
      text: `${count(t.currentCount)} xodim`,
      note: data.hasPrevious ? `${prevLabel}: ${count(t.previousCount)} xodim` : "o'tgan oy yuklanmagan",
      tone: 'blue',
    },
    { label: 'Hisoblangan oylik', value: Number(t.currentTiyin), previous: data.hasPrevious ? Number(t.previousTiyin) : null, growthGood: false, tone: 'red' },
    {
      label: 'Hududlardan',
      value: 0,
      text: `${count(t.regionsCount)} xodim`,
      note: `${prevLabel}: ${count(t.previousRegionsCount)}${BigInt(t.centerPartTiyin) > 0n ? ' · bayram/choraklik Markaz hisobidan' : ''}`,
      tone: 'cyan',
    },
    { label: 'Markazdan', value: 0, text: `${count(t.centerCount)} xodim`, note: `${prevLabel}: ${count(t.previousCenterCount)}`, tone: 'purple' },
    {
      label: 'Harakat',
      value: 0,
      text: `+${data.counts.hired + data.counts.returned} / −${data.counts.fired + data.counts.idle}`,
      note: `ko'chdi ${data.counts.moved} · oyligi o'zgardi ${data.counts.up + data.counts.down}`,
      tone: 'orange',
    },
  ];

  const unitName = unit ? (data.units.find((u) => u.key === unit)?.name ?? '') : '';

  return (
    <div className="space-y-4">
      {!data.hasCurrent ? (
        <div className="rounded-2xl bg-white px-5 py-8 text-center text-sm text-(--color-text-muted) shadow-card">
          {curLabel} uchun ish haqi vedomosti yuklanmagan — yuqoridagi «Davr»dan boshqa oyni tanlang yoki Xarajatlar › Ish haqidan yuklang.
        </div>
      ) : (
        <>
          <StatTiles items={tiles} compareLabel="Avval" />

          <ReportCard
            title="Hududlar va Markaz bo'yicha"
            badge={`${prevLabel} → ${curLabel}`}
            actions={
              unit ? (
                <ActionButton onClick={() => setUnit(null)}>Hammasi</ActionButton>
              ) : undefined
            }
          >
            <RTable minWidth={1080}>
              <thead>
                <tr>
                  <Th rowSpan={2} className={cn(STICKY_NO, 'z-[2]')}>
                    №
                  </Th>
                  <Th rowSpan={2} className={cn(STICKY_NAME, 'z-[2] min-w-36 text-left')}>
                    Hudud
                  </Th>
                  <GroupTh span={3}>Xodimlar soni</GroupTh>
                  <GroupTh span={5}>Harakat</GroupTh>
                  <GroupTh span={2}>Oylik</GroupTh>
                </tr>
                <tr>
                  <Th className="first:border-l">{prevLabel}</Th>
                  <Th>{curLabel}</Th>
                  <Th>Farqi</Th>
                  <Th>Ishga olindi</Th>
                  <Th>Qaytdi</Th>
                  <Th>Bo&apos;shatildi</Th>
                  <Th>Ishlamadi</Th>
                  <Th>Ko&apos;chdi (+/−)</Th>
                  <Th>{curLabel}</Th>
                  <Th>Farqi, foizda</Th>
                </tr>
              </thead>
              <tbody>
                <Tr total>
                  <Td className={STICKY_NO} />
                  <NameCell>Jami</NameCell>
                  <CountCell value={t.previousCount} />
                  <CountCell value={t.currentCount} />
                  <CountDiffCell current={t.currentCount} previous={t.previousCount} />
                  <CountCell value={data.counts.hired} />
                  <CountCell value={data.counts.returned} />
                  <CountCell value={data.counts.fired} />
                  <CountCell value={data.counts.idle} />
                  <CountCell value={data.counts.moved} />
                  <MoneyCell value={Number(t.currentTiyin)} />
                  <DiffCell value={Number(t.currentTiyin) - Number(t.previousTiyin)} pct={changeOf(Number(t.currentTiyin), Number(t.previousTiyin))} growthGood={false} />
                </Tr>
                {data.units.map((u, i) => (
                  <Tr key={u.key} onClick={() => setUnit(unit === u.key ? null : u.key)} muted={u.kind === 'center'} className={cn(unit === u.key && 'bg-brand-50')}>
                    <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{i + 1}</Td>
                    <NameCell drill className={cn(u.kind === 'center' && 'font-semibold')}>
                      {u.name}
                    </NameCell>
                    <CountCell value={u.previousCount} className="text-(--color-text-muted)" />
                    <CountCell value={u.currentCount} className="font-semibold" />
                    <CountDiffCell current={u.currentCount} previous={u.previousCount} />
                    <CountCell value={u.hired} />
                    <CountCell value={u.returned} />
                    <CountCell value={u.fired} />
                    <CountCell value={u.idle} />
                    <Td>{u.movedIn || u.movedOut ? `+${u.movedIn} / −${u.movedOut}` : <span className="text-(--color-text-faint)"></span>}</Td>
                    <MoneyCell value={Number(u.currentTiyin)} />
                    <DiffCell value={Number(u.currentTiyin) - Number(u.previousTiyin)} pct={changeOf(Number(u.currentTiyin), Number(u.previousTiyin))} growthGood={false} />
                  </Tr>
                ))}
              </tbody>
            </RTable>
            <TableNote>
              Qatorni bosing — pastdagi xodimlar ro&apos;yxati shu hudud bo&apos;yicha. {curLabel} — yuqoridagi «Davr» oxiri; {prevLabel}ga nisbatan. Manba — ish haqi vedomostlari, xodimlar reestri va hudud tarixi.
            </TableNote>
          </ReportCard>

          {data.notes.length > 0 && (
            <div className="rounded-2xl bg-white px-5 py-3.5 shadow-card">
              <p className="mb-1.5 flex items-center gap-2 text-sm font-bold text-heading">
                <span className="h-4 w-1 rounded-full bg-brand-600" aria-hidden />
                Bu oy nima o&apos;zgardi
              </p>
              <ol className="list-decimal space-y-1 pl-8 text-sm text-(--color-text)">
                {data.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ol>
            </div>
          )}

          <PillTabs
            value={kind}
            onChange={setKind}
            options={[
              { value: 'all' as const, label: `Hammasi · ${data.people.length}` },
              ...ORDER.filter((k) => data.counts[k] > 0).map((k) => ({ value: k, label: `${KIND[k].label} · ${data.counts[k]}`, hint: KIND[k].hint })),
            ]}
          />

          <ReportCard
            title={`Xodimlar${unitName ? ` · ${unitName}` : ''} — ${people.length} ta`}
            badge={`${prevLabel} → ${curLabel}`}
            actions={
              <>
                <SearchInput value={query} onChange={setQuery} placeholder="F.I.Sh, JShShIR…" />
                <ExcelButton onClick={exportCsv} />
              </>
            }
          >
            {!data.hasPrevious ? (
              <EmptyNote>{prevLabel} uchun ish haqi yuklanmagan — taqqoslab bo&apos;lmaydi.</EmptyNote>
            ) : people.length === 0 ? (
              <EmptyNote>O&apos;zgarish yo&apos;q</EmptyNote>
            ) : (
              <RTable minWidth={1000}>
                <thead>
                  <tr>
                    <Th rowSpan={2} className={cn(STICKY_NO, 'z-[2]')}>
                      №
                    </Th>
                    <Th rowSpan={2} className={cn(STICKY_NAME, 'z-[2] min-w-36 text-left')}>
                      Xodim
                    </Th>
                    <Th rowSpan={2}>Holat</Th>
                    <Th rowSpan={2} className="text-left">
                      Hudud
                    </Th>
                    <GroupTh span={3}>Oylik</GroupTh>
                    <Th rowSpan={2}>Sana</Th>
                  </tr>
                  <tr>
                    <Th className="first:border-l">{prevLabel}</Th>
                    <Th>{curLabel}</Th>
                    <Th>Farqi, foizda</Th>
                  </tr>
                </thead>
                <tbody>
                  {people.slice(0, 500).map((p: ChangePerson, i) => {
                    const cur = Number(p.currentTiyin);
                    const prev = Number(p.previousTiyin);
                    return (
                      <Tr key={`${p.kind}-${p.pinfl}`}>
                        <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{i + 1}</Td>
                        <NameCell
                          sub={
                            <>
                              <PinflText pinfl={p.pinfl} />
                              {p.position ? ` · ${p.position}` : ''}
                            </>
                          }
                          className="max-w-72"
                        >
                          <span className="font-medium text-heading">{p.fullName}</span>
                        </NameCell>
                        <Td>
                          <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold', KIND[p.kind].cls)} title={KIND[p.kind].hint}>
                            {KIND[p.kind].sign} {KIND[p.kind].label}
                          </span>
                        </Td>
                        <Td className="text-left text-(--color-text-muted)">{p.fromUnitName ? `${p.fromUnitName} → ${p.unitName}` : p.unitName}</Td>
                        <MoneyCell value={prev} className="text-(--color-text-muted)" />
                        <MoneyCell value={cur} strong />
                        <DiffCell value={cur - prev} pct={changeOf(cur, prev)} growthGood={false} />
                        <Td className="whitespace-nowrap text-xs text-(--color-text-muted)">
                          {p.kind === 'fired' && p.firedAt ? `bo'shagan ${formatDate(p.firedAt)}` : (p.kind === 'hired' || p.kind === 'hiredUnpaid') && p.hiredAt ? `ishga kirgan ${formatDate(p.hiredAt)}` : ''}
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </RTable>
            )}
            {people.length > 500 && <TableNote>Birinchi 500 tasi ko&apos;rsatildi — to&apos;liq ro&apos;yxat Excelda.</TableNote>}
          </ReportCard>
        </>
      )}
    </div>
  );
}
