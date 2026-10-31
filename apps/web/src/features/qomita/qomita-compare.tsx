'use client';

import { ExcelButton, MoneyCell, NameCell, PctCell, PillTabs, ReportCard, RTable, SearchInput, StatTiles, STICKY_NAME, STICKY_NO, TableNote, Td, Th, ToggleAllButton, Tr, sum } from '@/components/report/report';
import { ExpandBox, NestedRow, nestHead } from '@/components/report/nested';
import { EmptyNote, LoadingCard } from '@/components/report/report-extra-c';
import { csvSom, downloadCsv } from '@/features/structure/stats';
import { formatPeriod } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useState, type ReactNode } from 'react';
import { hisobApi, type Compare3802, type CompareEmployee, type CompareSum } from './api';

// ═══════════════════════════════════════════════════════════
// Qo'mita pullari sarfi › Solishtirma: Qo'mitadan pul oladigan xodimlar — to'liq oyligi, shundan Qo'mita qoplagani
// va korxona to'lagani. Ichma-ich: hisob (3802 / Marksheyder) → oy → bo'lim → xodim.
//   To'liq oylik — ish haqi tarkibi (hudud xodimlari tarkibda bo'lmaydi — reestr + shu oy vedomosti);
//   Qo'mita qoplagani — oylik «3802 dan olingan pullar» shabloni («Jami»); korxona to'lagani — ayirma.
// ═══════════════════════════════════════════════════════════

const n = (s: string | null) => (s === null ? 0 : Number(s));
const share = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null);
const SOURCE: Record<NonNullable<CompareEmployee['source']>, string> = { TARKIB: 'ish haqi tarkibi', VEDOMOST: 'ish haqi vedomosti (hudud)' };
const HOW: Record<CompareEmployee['how'], string> = { LINK: "qo'lda bog'langan", EXACT: "ism bo'yicha", FIRST2: 'familiya va ism bo‘yicha', FUZZY: 'yaqin yozilish bo‘yicha', NONE: 'topilmadi', CONFIRMED_NONE: "tarkibda yo'q (tasdiqlangan)" };

export function ComparePanel({ from, to }: { from: string; to: string }) {
  const res = useAsync(() => hisobApi.compare(from, to).then((r) => r.data), [from, to]);
  if (!res.data) return <LoadingCard label="Oyliklar solishtirilmoqda" error={res.error} onRetry={res.reload} />;
  return <Body d={res.data} loading={res.loading} />;
}

function Body({ d, loading }: { d: Compare3802; loading: boolean }) {
  const [side, setSide] = useState<'pool' | 'marksheyder'>('pool');
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState('');
  const s = d[side];
  const q = query.trim().toLowerCase();
  const toggle = (k: string) =>
    setOpen((x) => {
      const nx = new Set(x);
      if (nx.has(k)) nx.delete(k);
      else nx.add(k);
      return nx;
    });
  const expandAll = () => {
    const keys = new Set<string>();
    for (const m of s.months) {
      keys.add(m.period);
      for (const sec of m.sections) keys.add(`${m.period}|${sec.name}`);
    }
    setOpen(keys);
  };
  const full = n(s.fullTiyin);
  const qom = n(s.qomitaTiyin);
  const comp = n(s.companyTiyin);
  const over = s.months.flatMap((m) => m.sections.flatMap((x) => x.list)).filter((e) => e.companyTiyin !== null && n(e.companyTiyin) < 0).length;

  // ─────────── Daraxt ───────────
  const cells = (x: CompareSum | null, strong = false) =>
    x ? (
      <>
        <MoneyCell value={n(x.fullTiyin)} strong={strong} />
        <MoneyCell value={n(x.qomitaTiyin)} className="text-(--color-income)" strong={strong} />
        <MoneyCell value={n(x.companyTiyin)} className="text-(--color-expense)" strong={strong} />
        <PctCell value={share(n(x.qomitaTiyin), n(x.fullTiyin))} plain className="font-normal text-(--color-text-muted)" />
      </>
    ) : (
      <>
        <Td />
        <Td />
        <Td />
        <Td />
      </>
    );
  // Har pog'ona — alohida panel (o'z sarlavhasi va raqamlashi bilan): oy → bo'lim → xodim → oylik qismlari
  type Line = { id: string; label: ReactNode; body: ReactNode; sub?: ReactNode; tone?: string; head?: boolean; openKey?: string; kids?: () => Line[] };
  const LEVEL_LABEL = ['Oy', "Bo'lim", 'Xodim', 'Oylik qismi'];
  const level = (list: Line[], depth: number): ReactNode[] => {
    const out: ReactNode[] = [];
    list.forEach((x, i) => {
      const isOpen = x.openKey ? open.has(x.openKey) : false;
      out.push(
        <Tr key={x.id} onClick={x.openKey ? () => toggle(x.openKey!) : undefined} className={cn(x.head && 'bg-brand-50/60')}>
          <Td className={cn(depth === 0 && STICKY_NO, 'w-12 text-center text-(--color-text-faint)')}>{i + 1}</Td>
          <NameCell sticky={depth === 0} sub={x.sub} className={cn(x.head && 'font-semibold text-heading', x.tone)} before={<ExpandBox open={isOpen} hidden={!x.openKey} onClick={() => toggle(x.openKey!)} />}>
            {x.label}
          </NameCell>
          {x.body}
        </Tr>,
      );
      if (isOpen && x.kids)
        out.push(
          <NestedRow key={`${x.id}|panel`} colSpan={6} level={depth + 1}>
            <table className="w-full">
              <thead>
                <tr>
                  <th className={cn(nestHead(depth + 1), 'w-12 text-center')}>№</th>
                  <th className={cn(nestHead(depth + 1), 'min-w-72 text-left')}>{LEVEL_LABEL[depth + 1]}</th>
                  <th className={cn(nestHead(depth + 1), 'text-right')}>To&apos;liq oylik</th>
                  <th className={cn(nestHead(depth + 1), 'text-right')}>Qo&apos;mita qoplagan</th>
                  <th className={cn(nestHead(depth + 1), 'text-right')}>Korxona to&apos;lagan</th>
                  <th className={cn(nestHead(depth + 1), 'text-right')}>Qo&apos;mita ulushi</th>
                </tr>
              </thead>
              <tbody>{level(x.kids(), depth + 1)}</tbody>
            </table>
          </NestedRow>,
        );
    });
    return out;
  };

  const tree: Line[] = [];
  for (const m of s.months) {
    const secs = m.sections
      .map((sec) => ({ ...sec, list: q ? sec.list.filter((e) => e.fullName.toLowerCase().includes(q)) : sec.list }))
      .filter((sec) => sec.list.length || !q);
    if (q && !secs.length) continue;
    const sub = [`${m.employees} xodim`, m.unmatched ? `${m.unmatched} tasining to'liq oyligi topilmadi` : null, !m.tarkib ? "ish haqi tarkibi yuklanmagan" : null].filter(Boolean).join(' · ');
    tree.push({
      id: m.period,
      label: formatPeriod(m.period),
      body: cells(m, true),
      openKey: m.period,
      sub,
      head: true,
      kids: () =>
        secs.map((sec): Line => {
          const k = `${m.period}|${sec.name}`;
          return {
            id: k,
            label: sec.name,
            body: cells(sec),
            openKey: k,
            sub: `${sec.employees} xodim${sec.unmatched ? ` · ${sec.unmatched} topilmadi` : ''}`,
            kids: () =>
              sec.list.map((e, i): Line => {
                const neg = e.companyTiyin !== null && n(e.companyTiyin) < 0;
                const subE = e.fullTiyin === null ? `to'liq oyligi topilmadi (${HOW[e.how]}) — faqat Qo'mita qismi ko'rsatilgan` : `${e.position ? `${e.position} · ` : ''}oylik — ${SOURCE[e.source!]}${neg ? " · Qo'mita qismi to'liq oylikdan ko'p — tarkib yoki shablonni tekshiring" : ''}`;
                const ek = `${k}|${i}`;
                return {
                  id: ek,
                  label: e.fullName,
                  body:
                    e.fullTiyin === null ? (
                      <>
                        <Td className="text-xs text-(--color-text-faint)">—</Td>
                        <MoneyCell value={n(e.qomitaTiyin)} className="text-(--color-income)" />
                        <Td className="text-xs text-(--color-text-faint)">—</Td>
                        <Td />
                      </>
                    ) : (
                      <>
                        <MoneyCell value={n(e.fullTiyin)} />
                        <MoneyCell value={n(e.qomitaTiyin)} className="text-(--color-income)" />
                        <MoneyCell value={n(e.companyTiyin)} className={neg ? 'font-semibold text-red-700' : 'text-(--color-expense)'} />
                        <PctCell value={share(n(e.qomitaTiyin), n(e.fullTiyin))} plain className="font-normal text-(--color-text-muted)" />
                      </>
                    ),
                  sub: subE,
                  tone: e.fullTiyin === null || neg ? 'text-amber-800' : undefined,
                  openKey: e.parts.length ? ek : undefined,
                  // Xodim qismlari: nimaga qancha — to'liq oylikda, Qo'mita qoplagani, korxona to'lagani
                  kids: () =>
                    e.parts.map((p): Line => {
                      const pNeg = p.companyTiyin !== null && n(p.companyTiyin) < 0;
                      return {
                        id: `${ek}|${p.key}`,
                        label: p.label,
                        body: (
                          <>
                            {p.fullTiyin === null ? <Td className="text-xs text-(--color-text-faint)">—</Td> : <MoneyCell value={n(p.fullTiyin)} className="text-(--color-text-muted)" />}
                            {n(p.qomitaTiyin) ? <MoneyCell value={n(p.qomitaTiyin)} className="text-(--color-income)" /> : <Td className="text-xs text-(--color-text-faint)">—</Td>}
                            {p.companyTiyin === null ? <Td className="text-xs text-(--color-text-faint)">—</Td> : <MoneyCell value={n(p.companyTiyin)} className={pNeg ? 'text-red-700' : 'text-(--color-expense)'} />}
                            {p.fullTiyin === null || !n(p.qomitaTiyin) ? <Td /> : <PctCell value={share(n(p.qomitaTiyin), n(p.fullTiyin))} plain className="font-normal text-(--color-text-muted)" />}
                          </>
                        ),
                        sub: p.fullTiyin === null ? "to'liq oylikda bu qism alohida ko'rinmaydi — faqat Qo'mita qoplagani" : n(p.qomitaTiyin) ? undefined : "Qo'mita qoplamagan — to'liq korxona hisobidan",
                        tone: 'text-(--color-text-muted) font-normal',
                      };
                    }),
                };
              }),
          };
        }),
    });
  }
  const rows = level(tree, 0);

  const exportCsv = () =>
    downloadCsv(
      `qomita-solishtirma-${side === 'pool' ? '3802' : 'marksheyder'}-${d.from}_${d.to}`,
      ['Oy', "Bo'lim", 'Xodim', "To'liq oylik, so'm", "Qo'mita qoplagani, so'm", "Korxona to'lagani, so'm", 'Oylik manbai'],
      s.months.flatMap((m) => m.sections.flatMap((sec) => sec.list.map((e) => [m.period, sec.name, e.fullName, e.fullTiyin === null ? '' : csvSom(n(e.fullTiyin)), csvSom(n(e.qomitaTiyin)), e.companyTiyin === null ? '' : csvSom(n(e.companyTiyin)), e.source ? SOURCE[e.source] : 'topilmadi']))),
    );

  return (
    <div className={cn('space-y-4', loading && 'opacity-70')}>
      <PillTabs
        value={side}
        onChange={(v) => {
          setSide(v);
          setOpen(new Set());
        }}
        options={[
          { value: 'pool', label: '3802', hint: "«Call markaz» deb kelgan pul — hamma bo'limlar xodimlari" },
          { value: 'marksheyder', label: 'Marksheyder', hint: "«Marksheyder uchun» kelgan pul" },
        ]}
      />
      <StatTiles
        compareLabel="Avval"
        items={[
          { label: "Xodimlarning to'liq oyligi", value: full, tone: 'blue', note: `${s.employees - s.unmatched} xodim-oy (oyligi topilgan)` },
          { label: "Qo'mita qoplagan", value: qom, tone: 'green', note: share(qom, full) === null ? '' : `to'liq oylikning ${share(qom, full)!.toFixed(1).replace('.', ',')}%` },
          { label: "Korxona to'lagan", value: comp, tone: 'red', note: share(comp, full) === null ? '' : `to'liq oylikning ${share(comp, full)!.toFixed(1).replace('.', ',')}%` },
          { label: "Oyligi topilmagan", value: n(s.unmatchedQomitaTiyin), tone: 'orange', note: `${s.unmatched} xodim-oy — faqat Qo'mita qismi ma'lum` },
        ]}
      />
      <ReportCard
        title={`${side === 'pool' ? '3802' : 'Marksheyder'}: to'liq oylik = Qo'mita qoplagani + korxona to'lagani`}
        badge={`${formatPeriod(d.from)} — ${formatPeriod(d.to)}${d.excluded.length ? ` · hisobga olinmaydi: ${d.excluded.map(formatPeriod).join(', ')}` : ''}`}
        actions={
          <>
            <SearchInput value={query} onChange={setQuery} placeholder="Xodim qidirish…" />
            <ExcelButton onClick={exportCsv} />
            <ToggleAllButton open={open.size > 0} onClick={() => (open.size ? setOpen(new Set()) : expandAll())} />
          </>
        }
      >
        {s.months.length ? (
          <RTable minWidth={980}>
            <thead>
              <tr>
                <Th className={cn(STICKY_NO, 'z-[2]')}>№</Th>
                <Th className={cn(STICKY_NAME, 'z-[2] min-w-80 text-left')}>Oy</Th>
                <Th>To&apos;liq oylik</Th>
                <Th>Qo&apos;mita qoplagan</Th>
                <Th>Korxona to&apos;lagan</Th>
                <Th>Qo&apos;mita ulushi</Th>
              </tr>
            </thead>
            <tbody>
              <Tr total>
                <Td className={STICKY_NO} />
                <NameCell>Jami</NameCell>
                {cells(s, true)}
              </Tr>
              {rows}
            </tbody>
          </RTable>
        ) : (
          <EmptyNote>Bu davrda shablon bo&apos;yicha Qo&apos;mita olgan xodim yo&apos;q</EmptyNote>
        )}
        <TableNote>
          Qatorni bosing — ichi ochiladi; xodimni bossangiz — oylik qismlari (oklad, ustama, ta&apos;til, ovqat…): har birining qanchasini Qo&apos;mita, qanchasini korxona
          to&apos;lagani. To&apos;liq oylik — ish haqi tarkibi bo&apos;yicha hisoblangan oylik (hudud xodimlari tarkibda bo&apos;lmaydi — xodimlar reestri va
          shu oy ish haqi vedomosti); Qo&apos;mita qoplagani — oylik «3802 dan olingan pullar» shablonining «Jami» ustuni; korxona to&apos;lagani = to&apos;liq oylik −
          Qo&apos;mita qoplagani. Ism bo&apos;yicha topilmagan xodimlar jamiga kirmaydi (ular «Oyligi topilmagan»da) — 3802 › Nazorat zanjiri › Tarkib bog&apos;lanishida
          qo&apos;lda bog&apos;lash mumkin.
          {over > 0 && ` ${over} ta xodim-oyda Qo'mita qismi to'liq oylikdan ko'p (qizil) — shu oy ish haqi tarkibi yoki shablon to'liq emasligini tekshiring.`}
        </TableNote>
      </ReportCard>
      <p className="text-xs text-(--color-text-muted)">Jami: {sum(full)} so&apos;m = {sum(qom)} (Qo&apos;mita) + {sum(comp)} (korxona).</p>
    </div>
  );
}
