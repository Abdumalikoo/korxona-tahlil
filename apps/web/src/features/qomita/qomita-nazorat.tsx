'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { errorMessage } from '@/lib/error-message';
import { formatPeriod, formatPeriodShort, formatTiyin } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useState, type ReactNode } from 'react';
import { nazorat3802Api, type NzLink, type NzLinkCode, type NzMonth, type NzStatus } from './api';

// ═══════════════════════════════════════════════════════════
// 3802 › Nazorat zanjiri: oylar × halqalar jadvali (qaysi oyda qaysi halqa uzilgan) va tanlangan oy:
//  1) Vedomost ↔ Ish haqi tarkibi — har xodim, topilmaganini qo'lda bog'lash yoki «tarkibda yo'q» deb tasdiqlash;
//  2) Vedomost ↔ Shtat — bo'limlar bog'lanishi (o'zgartirish mumkin), lavozimlar: birlik va maosh;
//  3) Vedomost ↔ 23106 — ta'til puli va moddiy yordam to'langanmi (qo'lga tegadigan summa — hisoblanganning 80–100% i);
//  4) Qoplanishi kerak ↔ Qo'mitadan kelgan — bo'limlar, oy farqi va yil boshidan qoldiq.
// Har farqqa izoh yozish mumkin — «tushuntirildi», ogohlantirishga kirmaydi. 5-halqa — alohida ruxsatdan keyin.
// ═══════════════════════════════════════════════════════════

type ToastFn = (t: { message: string; tone: 'success' | 'error' } | null) => void;

const LINK_SHORT: Record<NzLinkCode, string> = { TARKIB: 'Tarkib', SHTAT: 'Shtat', D23106: '23106', QOPLASH: 'Qoplash', AJRATISH: 'Ajratish' };
const STATUS: Record<NzStatus, { icon: string; label: string; cls: string; tone: 'income' | 'warn' | 'neutral' }> = {
  OK: { icon: '✓', label: 'mos', cls: 'bg-(--color-income-soft) text-(--color-income)', tone: 'income' },
  WARN: { icon: '!', label: 'farq bor', cls: 'bg-(--color-warn-soft) text-(--color-warn)', tone: 'warn' },
  NONE: { icon: '○', label: "ma'lumot yo'q", cls: 'bg-(--color-surface-sunken) text-(--color-text-muted)', tone: 'neutral' },
  LATER: { icon: '…', label: 'keyingi bosqich', cls: 'bg-(--color-surface-sunken) text-(--color-text-faint)', tone: 'neutral' },
};
const n = (s: string | null | undefined) => BigInt(s ?? '0');

function Dot({ status, warn }: { status: NzStatus; warn?: number }) {
  const s = STATUS[status];
  return (
    <span className={cn('inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-bold', s.cls)} title={s.label}>
      {status === 'WARN' && warn ? warn : s.icon}
    </span>
  );
}

function Money({ v, signed = false }: { v: string; signed?: boolean }) {
  const x = n(v);
  return <span className={cn('money whitespace-nowrap', signed && x < 0n && 'text-(--color-expense)', signed && x > 0n && 'text-(--color-income)')}>{signed && x > 0n ? '+' : ''}{formatTiyin(v)}</span>;
}

/** Izoh: bosilganda — matn maydoni; saqlangan izoh — «tushuntirildi» */
function NoteEditor({ value, editable, onSave }: { value: string | null; editable: boolean; onSave: (text: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value ?? '');
  const [busy, setBusy] = useState(false);
  if (!open)
    return value ? (
      <button type="button" disabled={!editable} onClick={() => setOpen(true)} className="max-w-64 truncate rounded bg-(--color-income-soft) px-1.5 py-0.5 text-left text-[11px] text-(--color-income)" title={value}>
        ✓ {value}
      </button>
    ) : editable ? (
      <button type="button" onClick={() => setOpen(true)} className="rounded px-1.5 py-0.5 text-[11px] text-(--color-text-faint) hover:bg-brand-50 hover:text-brand-700">
        + izoh
      </button>
    ) : null;
  return (
    <span className="flex items-center gap-1">
      <input autoFocus value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Nega farq bor (masalan: yarim oy ishlagan)" className="h-7 w-64 rounded border border-(--color-line-strong) px-2 text-xs" />
      <Button
        size="sm"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onSave(text.trim());
            setOpen(false);
          } finally {
            setBusy(false);
          }
        }}
      >
        Saqlash
      </Button>
      <button type="button" className="px-1 text-xs text-(--color-text-faint)" onClick={() => setOpen(false)}>
        ✕
      </button>
    </span>
  );
}

export function NazoratSection({ isAdmin, onToast }: { isAdmin: boolean; onToast: ToastFn }) {
  const ov = useAsync(() => nazorat3802Api.overview().then((r) => r.data), []);
  const [picked, setPicked] = useState<string | null>(null);
  const [tol, setTol] = useState<string | null>(null);
  const months = ov.data?.months ?? [];
  const period = picked ?? months[0]?.period ?? null;

  async function saveTol() {
    if (tol === null) return;
    try {
      await nazorat3802Api.config(tol.replace(/\s+/g, ''));
      onToast({ message: 'Farq chegarasi saqlandi', tone: 'success' });
      setTol(null);
      ov.reload();
    } catch (err) {
      onToast({ message: errorMessage(err, "Saqlab bo'lmadi"), tone: 'error' });
    }
  }

  if (ov.error) return <ErrorState message={ov.error} onRetry={ov.reload} />;
  if (!ov.data) return <LoadingState label="Nazorat zanjiri hisoblanmoqda" />;
  const tolSom = String(Number(ov.data.toleranceTiyin) / 100);
  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <CardHeader
          title="Nazorat zanjiri"
          description="Har oy: vedomost ↔ ish haqi tarkibi ↔ shtat ↔ Qo'mitadan kelgan pul. Oyni bosing — tafsilot pastda."
          actions={
            <span className="flex items-center gap-2 text-xs text-(--color-text-muted)">
              Farq chegarasi:
              {tol === null ? (
                <button type="button" disabled={!isAdmin} onClick={() => setTol(tolSom)} className="rounded border border-(--color-line) px-2 py-1 font-semibold text-heading hover:border-brand-300" title="Bundan kichik farq — «mos»">
                  {Number(tolSom).toLocaleString('ru-RU').replace(/,/g, ' ')} so&apos;m
                </button>
              ) : (
                <>
                  <input autoFocus value={tol} onChange={(e) => setTol(e.target.value)} inputMode="numeric" className="h-7 w-24 rounded border border-(--color-line-strong) px-2 text-xs" />
                  <Button size="sm" onClick={() => void saveTol()}>
                    Saqlash
                  </Button>
                  <button type="button" className="text-(--color-text-faint)" onClick={() => setTol(null)}>
                    ✕
                  </button>
                </>
              )}
            </span>
          }
        />
        {!months.length ? (
          <CardBody className="text-sm text-(--color-text-muted)">Hali 3802 vedomosti qabul qilinmagan — «Har oylik real bajarilgan ishlar» bo&apos;limida yuklang.</CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-(--color-surface-muted) text-[11px] tracking-wide text-(--color-text-muted) uppercase">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Oy</th>
                  <th className="px-2 py-2 text-right font-semibold">Xodim</th>
                  {(Object.keys(LINK_SHORT) as NzLinkCode[]).map((c) => (
                    <th key={c} className="px-2 py-2 text-center font-semibold">
                      {LINK_SHORT[c]}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right font-semibold">Qoplanishi kerak</th>
                  <th className="px-3 py-2 text-right font-semibold">Qo&apos;mitadan kelgan</th>
                  <th className="px-3 py-2 text-right font-semibold">Yil boshidan qoldiq</th>
                </tr>
              </thead>
              <tbody>
                {months.map((m) => (
                  <tr key={m.period} onClick={() => setPicked(m.period)} className={cn('cursor-pointer border-t border-(--color-line) hover:bg-(--color-surface-muted)', m.period === period && 'bg-brand-50/60')}>
                    <td className="px-3 py-1.5 font-medium whitespace-nowrap text-heading">{formatPeriod(m.period)}</td>
                    <td className="money px-2 py-1.5 text-right">{m.employees}</td>
                    {m.links.map((l) => (
                      <td key={l.code} className="px-2 py-1.5 text-center">
                        <Dot status={l.status} warn={l.warn} />
                      </td>
                    ))}
                    <td className="px-3 py-1.5 text-right">
                      <Money v={m.neededTiyin} />
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <Money v={m.incomeTiyin} />
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <Money v={m.ytdBalanceTiyin} signed />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-4 py-2 text-[11px] text-(--color-text-muted)">✓ mos · raqam — tushuntirilmagan farqlar soni · ○ ma&apos;lumot yo&apos;q · … keyingi bosqich. Qoldiq: + ortib qoldi, − yetmadi (3802 ga kirmaydigan tushumsiz).</p>
          </div>
        )}
      </Card>
      {period && <MonthView key={period} period={period} isAdmin={isAdmin} onToast={onToast} onChanged={ov.reload} />}
    </div>
  );
}

function MonthView({ period, isAdmin, onToast, onChanged }: { period: string; isAdmin: boolean; onToast: ToastFn; onChanged: () => void }) {
  const res = useAsync(() => nazorat3802Api.detail(period).then((r) => r.data), [period]);
  const [open, setOpen] = useState<NzLinkCode | null>(null);
  const reload = () => {
    res.reload();
    onChanged();
  };
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      onToast({ message: ok, tone: 'success' });
      reload();
    } catch (err) {
      onToast({ message: errorMessage(err, "Saqlab bo'lmadi"), tone: 'error' });
      throw err;
    }
  };
  const note = (link: NzLinkCode, item: string) => (text: string) => act(() => nazorat3802Api.note(period, link, item, text), text ? 'Izoh saqlandi' : "Izoh o'chirildi");

  if (res.error) return <ErrorState message={res.error} onRetry={res.reload} />;
  if (!res.data) return <LoadingState label={`${formatPeriod(period)} — hisoblanmoqda`} />;
  const m = res.data;
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={`${formatPeriod(period)} — zanjir`}
        description="Halqani bosing — farqlar ro'yxati"
        actions={
          <Button size="sm" variant="secondary" onClick={() => void nazorat3802Api.export(period).catch((err) => onToast({ message: errorMessage(err, "Yuklab bo'lmadi"), tone: 'error' }))}>
            Excel
          </Button>
        }
      />
      <div className="divide-y divide-(--color-line) border-t border-(--color-line)">
        {m.links.map((l, i) => (
          <div key={l.code}>
            <LinkHead index={i + 1} link={l} open={open === l.code} onClick={() => setOpen(open === l.code ? null : l.code)} />
            {open === l.code && (
              <div className="bg-(--color-surface-muted)/40 px-4 py-3">
                {l.code === 'TARKIB' && <TarkibLink m={m} isAdmin={isAdmin} act={act} note={note} />}
                {l.code === 'SHTAT' && <ShtatLink m={m} isAdmin={isAdmin} act={act} note={note} />}
                {l.code === 'QOPLASH' && <QoplashLink m={m} isAdmin={isAdmin} note={note} />}
                {l.code === 'D23106' && <D23106Link m={m} isAdmin={isAdmin} note={note} />}
                {l.code === 'AJRATISH' && (
                  <p className="text-sm text-(--color-text-muted)">
                    Qoplanadigan qism Markaz ish haqidan Qo&apos;mita hisobiga o&apos;tkazilishi — biznes formulasini o&apos;zgartiradi, shuning uchun alohida reja va ruxsatdan keyin ulanadi.
                    Hozircha «Qoplanishi kerak» summasi (4-halqa) — o&apos;tkaziladigan miqdor.
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function LinkHead({ index, link, open, onClick }: { index: number; link: NzLink; open: boolean; onClick: () => void }) {
  const s = STATUS[link.status];
  return (
    <button type="button" onClick={onClick} className={cn('flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-(--color-surface-muted)', open && 'bg-brand-50/40')} aria-expanded={open}>
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">{index}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-heading">{link.title}</span>
        <span className="block text-xs text-(--color-text-muted)">{link.summary}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {link.explained > 0 && <Badge tone="income">tushuntirildi: {link.explained}</Badge>}
        <Badge tone={s.tone}>{link.status === 'WARN' ? `${s.label}: ${link.warn}` : s.label}</Badge>
        <span className="text-(--color-text-faint)">{open ? '▾' : '▸'}</span>
      </span>
    </button>
  );
}

type Act = (fn: () => Promise<unknown>, ok: string) => Promise<void>;
type NoteFn = (link: NzLinkCode, item: string) => (text: string) => Promise<void>;

function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-(--color-line) bg-white">
      <table className="w-full text-xs">
        <thead className="bg-(--color-surface-muted) text-[10.5px] tracking-wide text-(--color-text-muted) uppercase">{head}</thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
const th = 'px-2 py-1.5 text-left font-semibold';
const thr = 'px-2 py-1.5 text-right font-semibold';
const td = 'border-t border-(--color-line) px-2 py-1.5 align-top';

// ─────────── 1) Vedomost ↔ Tarkib ───────────

function TarkibLink({ m, isAdmin, act, note }: { m: NzMonth; isAdmin: boolean; act: Act; note: NoteFn }) {
  const [view, setView] = useState<'PROBLEM' | 'REGION' | 'ALL'>('PROBLEM');
  if (!m.tarkib.loaded) return <p className="text-sm text-(--color-text-muted)">Shu oy ish haqi tarkibi yuklanmagan — Xarajatlar › Ish haqi tarkibi.</p>;
  const items = m.tarkib.items.filter((x) => (view === 'ALL' ? true : view === 'REGION' ? x.regional && x.status === 'NOT_FOUND' : x.status === 'DIFF' || (x.status === 'NOT_FOUND' && !x.regional)));
  const STL: Record<string, string> = { OK: 'mos', DIFF: 'farq', NOT_FOUND: 'topilmadi', CONFIRMED_NONE: "tarkibda yo'q (tasdiqlangan)" };
  const HOW: Record<string, string> = { EXACT: "to'liq ism", FIRST2: 'familiya va ism', FUZZY: 'o‘xshash ism', LINK: "qo'lda bog'langan" };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5 text-xs">
        {(
          [
            ['PROBLEM', `Farqlar (${m.tarkib.items.filter((x) => x.status === 'DIFF' || (x.status === 'NOT_FOUND' && !x.regional)).length})`],
            ['REGION', `Hudud xodimlari (${m.tarkib.items.filter((x) => x.regional && x.status === 'NOT_FOUND').length})`],
            ['ALL', `Hammasi (${m.tarkib.items.length})`],
          ] as const
        ).map(([v, label]) => (
          <button key={v} type="button" onClick={() => setView(v)} className={cn('rounded-full border px-2.5 py-1', view === v ? 'border-brand-300 bg-brand-50 font-semibold text-brand-700' : 'border-(--color-line) bg-white text-(--color-text-muted)')}>
            {label}
          </button>
        ))}
      </div>
      {view === 'REGION' && <p className="text-xs text-(--color-text-muted)">Hudud xodimlari Markaz ish haqi tarkibida bo&apos;lmasligi tabiiy — ular ogohlantirishga kirmaydi.</p>}
      {items.length === 0 ? (
        <p className="text-sm text-(--color-income)">Farq yo&apos;q.</p>
      ) : (
        <Table
          head={
            <tr>
              <th className={th}>Xodim (vedomost)</th>
              <th className={th}>Holat</th>
              <th className={thr}>Oklad: ved. / tarkib</th>
              <th className={thr}>40%: ved. / tarkib</th>
              <th className={th}>Izoh</th>
            </tr>
          }
        >
          {items.map((x) => (
            <tr key={`${x.section}|${x.key}`}>
              <td className={td}>
                <span className="font-medium text-heading">{x.fullName}</span>
                <span className="block text-[10.5px] text-(--color-text-faint)">
                  {x.section} · {x.position}
                </span>
              </td>
              <td className={td}>
                <Badge tone={x.status === 'OK' ? 'income' : x.status === 'DIFF' ? 'warn' : 'neutral'}>{STL[x.status]}</Badge>
                {x.tarkibName && HOW[x.how] && (
                  <span className="block text-[10.5px] text-(--color-text-faint)" title={x.tarkibName}>
                    {HOW[x.how]}
                    {x.how === 'LINK' && isAdmin && (
                      <button type="button" className="ml-1 underline" onClick={() => void act(() => nazorat3802Api.link(x.fullName), "Bog'lash bekor qilindi").catch(() => undefined)}>
                        bekor
                      </button>
                    )}
                  </span>
                )}
                {x.status === 'NOT_FOUND' && isAdmin && (
                  <span className="mt-1 flex flex-wrap items-center gap-1">
                    <select
                      defaultValue=""
                      onChange={(e) => e.target.value && void act(() => nazorat3802Api.link(x.fullName, e.target.value), "Bog'landi").catch(() => undefined)}
                      className="h-7 max-w-52 rounded border border-(--color-line-strong) bg-white px-1 text-[11px]"
                    >
                      <option value="">Tarkibdan tanlash…</option>
                      {(x.candidates ?? []).map((c) => (
                        <option key={c.pinfl} value={c.pinfl}>
                          {c.fullName}
                        </option>
                      ))}
                    </select>
                    <button type="button" className="rounded px-1 text-[11px] text-(--color-text-faint) hover:text-heading" onClick={() => void act(() => nazorat3802Api.link(x.fullName, null), "«Tarkibda yo'q» deb belgilandi").catch(() => undefined)}>
                      tarkibda yo&apos;q
                    </button>
                  </span>
                )}
                {x.status === 'CONFIRMED_NONE' && isAdmin && (
                  <button type="button" className="mt-1 block text-[10.5px] text-(--color-text-faint) underline" onClick={() => void act(() => nazorat3802Api.link(x.fullName), 'Bekor qilindi').catch(() => undefined)}>
                    bekor qilish
                  </button>
                )}
              </td>
              <td className={cn(td, 'text-right')}>
                <Money v={x.vedOklad} />
                <span className="block text-(--color-text-muted)">{x.tarkibOklad === null ? '—' : <Money v={x.tarkibOklad} />}</span>
              </td>
              <td className={cn(td, 'text-right')}>
                <Money v={x.vedUstama} />
                <span className="block text-(--color-text-muted)">{x.tarkibUstama === null ? '—' : <Money v={x.tarkibUstama} />}</span>
              </td>
              <td className={td}>{x.status !== 'OK' && <NoteEditor value={x.note} editable={isAdmin} onSave={note('TARKIB', x.key)} />}</td>
            </tr>
          ))}
        </Table>
      )}
      {m.tarkib.tarkibOnly.length > 0 && view !== 'REGION' && (
        <>
          <p className="text-xs font-semibold text-heading">Tarkibda 40% ustama bor, vedomostda yo&apos;q ({m.tarkib.tarkibOnly.length})</p>
          <Table
            head={
              <tr>
                <th className={th}>Xodim (tarkib)</th>
                <th className={thr}>Oklad</th>
                <th className={thr}>40% ustama</th>
                <th className={th}>Izoh</th>
              </tr>
            }
          >
            {m.tarkib.tarkibOnly.map((x) => (
              <tr key={x.key}>
                <td className={td}>{x.fullName}</td>
                <td className={cn(td, 'text-right')}>
                  <Money v={x.okladTiyin} />
                </td>
                <td className={cn(td, 'text-right')}>
                  <Money v={x.ustamaTiyin} />
                </td>
                <td className={td}>
                  <NoteEditor value={x.note} editable={isAdmin} onSave={note('TARKIB', x.key)} />
                </td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </div>
  );
}

// ─────────── 3) Vedomost ↔ 23106 ───────────

function D23106Link({ m, isAdmin, note }: { m: NzMonth; isAdmin: boolean; note: NoteFn }) {
  const [view, setView] = useState<'PROBLEM' | 'ALL'>('PROBLEM');
  if (!m.d23106.loaded) return <p className="text-sm text-(--color-text-muted)">Shu oy 23106 ko&apos;chirmasi yuklanmagan — Xarajatlar › 23106.</p>;
  const ST: Record<string, { label: string; tone: 'income' | 'warn' | 'neutral' | 'brand' }> = {
    PAID: { label: "to'langan", tone: 'income' },
    DIFF: { label: 'summa farqi', tone: 'warn' },
    WITH_SALARY: { label: 'ish haqi bilan birga', tone: 'brand' },
    NOT_PAID: { label: 'topilmadi', tone: 'warn' },
    REGIONAL: { label: 'hudud', tone: 'neutral' },
  };
  const KIND: Record<string, string> = { TATIL: "ta'til", MODDIY: 'moddiy yordam', ISH_HAQI: 'ish haqi' };
  const problem = m.d23106.items.filter((x) => x.status === 'DIFF' || x.status === 'NOT_PAID');
  const items = view === 'ALL' ? m.d23106.items : problem;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5 text-xs">
        {(
          [
            ['PROBLEM', `Farqlar (${problem.length})`],
            ['ALL', `Hammasi (${m.d23106.items.length})`],
          ] as const
        ).map(([v, label]) => (
          <button key={v} type="button" onClick={() => setView(v)} className={cn('rounded-full border px-2.5 py-1', view === v ? 'border-brand-300 bg-brand-50 font-semibold text-brand-700' : 'border-(--color-line) bg-white text-(--color-text-muted)')}>
            {label}
          </button>
        ))}
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-(--color-income)">{m.d23106.items.length ? "Farq yo'q." : "Vedomostda shu oy ta'til puli va moddiy yordam yo'q."}</p>
      ) : (
        <Table
          head={
            <tr>
              <th className={th}>Xodim (vedomost)</th>
              <th className={thr}>Ta&apos;til / moddiy yordam</th>
              <th className={thr}>23106 da to&apos;langan</th>
              <th className={th}>Holat</th>
              <th className={th}>To&apos;lovlar</th>
              <th className={th}>Izoh</th>
            </tr>
          }
        >
          {items.map((x) => (
            <tr key={`${x.section}|${x.key}`}>
              <td className={td}>
                <span className="font-medium text-heading">{x.fullName}</span>
                <span className="block text-[10.5px] text-(--color-text-faint)">{x.section}</span>
              </td>
              <td className={cn(td, 'text-right')}>
                <Money v={x.vedTatilTiyin} />
                {n(x.vedModdiyTiyin) > 0n && (
                  <span className="block text-(--color-text-muted)">
                    + <Money v={x.vedModdiyTiyin} />
                  </span>
                )}
              </td>
              <td className={cn(td, 'text-right')}>
                {x.status === 'WITH_SALARY' ? '—' : <Money v={x.paidTiyin} />}
                {x.ratio !== null && <span className="block text-[10.5px] text-(--color-text-faint)">{x.ratio}%</span>}
              </td>
              <td className={td}>
                <Badge tone={ST[x.status]!.tone}>{ST[x.status]!.label}</Badge>
                {x.how && <span className="block text-[10.5px] text-(--color-text-faint)">{x.how === 'PINFL' ? 'JShShIR bo‘yicha' : 'ism bo‘yicha'}</span>}
              </td>
              <td className={cn(td, 'text-[11px] text-(--color-text-muted)')}>
                {x.paid.map((p, i) => (
                  <span key={i} className="block whitespace-nowrap">
                    {p.docDate.split('-').reverse().join('.')} · {KIND[p.kind]} · <Money v={p.amountTiyin} />
                  </span>
                ))}
              </td>
              <td className={td}>{(x.status === 'DIFF' || x.status === 'NOT_PAID' || x.note) && <NoteEditor value={x.note} editable={isAdmin} onSave={note('D23106', x.key)} />}</td>
            </tr>
          ))}
        </Table>
      )}
      <p className="text-[11px] text-(--color-text-faint)">
        23106 da qo&apos;lga tegadigan summa (soliq ushlangan): hisoblanganning 80–100% i — «to&apos;langan». To&apos;lov sanasi — shu oy ±1. «Ish haqi bilan birga» — alohida ta&apos;til
        to&apos;lovi yo&apos;q, lekin shu oylarda xodimga ish haqi o&apos;tkazmasi bor (ta&apos;til puli u bilan birga to&apos;langan bo&apos;lishi mumkin) — ogohlantirishga kirmaydi.
      </p>
    </div>
  );
}

// ─────────── 2) Vedomost ↔ Shtat ───────────

function ShtatLink({ m, isAdmin, act, note }: { m: NzMonth; isAdmin: boolean; act: Act; note: NoteFn }) {
  const PS: Record<string, string> = { OK: 'mos', OVER_UNITS: 'birlikdan ortiq', OVER_SALARY: 'maoshdan ortiq', BOTH: 'birlik va maosh' };
  const shtatName = new Map(m.shtatSections.map((s) => [s.key, s.name]));
  const bySec = new Map<string, typeof m.shtat.positions>();
  for (const p of m.shtat.positions) bySec.set(p.shtatKey, [...(bySec.get(p.shtatKey) ?? []), p]);
  return (
    <div className="space-y-3">
      <p className="flex flex-wrap items-center gap-2 text-xs font-semibold text-heading">
        Bo&apos;limlar: vedomost → shtat
        {isAdmin && m.shtat.sections.some((s) => s.mode === 'SUGGESTED') && (
          <Button
            size="sm"
            variant="secondary"
            className="ml-auto"
            onClick={() =>
              void act(async () => {
                for (const s of m.shtat.sections.filter((x) => x.mode === 'SUGGESTED')) await nazorat3802Api.section(s.name, s.shtatKey);
              }, 'Hamma takliflar tasdiqlandi').catch(() => undefined)
            }
          >
            Hamma takliflarni tasdiqlash ({m.shtat.sections.filter((s) => s.mode === 'SUGGESTED').length})
          </Button>
        )}
      </p>
      <Table
        head={
          <tr>
            <th className={th}>Vedomost bo&apos;limi</th>
            <th className={thr}>Xodim</th>
            <th className={th}>Shtat bo&apos;limi</th>
            <th className={th}>Izoh</th>
          </tr>
        }
      >
        {m.shtat.sections.map((s) => (
          <tr key={s.key}>
            <td className={cn(td, 'font-medium text-heading')}>{s.name}</td>
            <td className={cn(td, 'text-right')}>{s.employees}</td>
            <td className={td}>
              <select
                value={s.shtatKey ?? ''}
                disabled={!isAdmin}
                onChange={(e) => void act(() => nazorat3802Api.section(s.name, e.target.value || null), "Bo'lim bog'landi").catch(() => undefined)}
                className={cn('h-7 w-full max-w-md rounded border bg-white px-1 text-[11px]', s.shtatKey ? 'border-(--color-line-strong)' : 'border-(--color-warn) text-(--color-warn)')}
              >
                <option value="">— shtatda yo&apos;q —</option>
                {m.shtatSections.map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.kind === 'OLMAYDI' ? '(olmaydi) ' : ''}
                    {x.name}
                  </option>
                ))}
              </select>
              <span className="text-[10.5px] text-(--color-text-faint)">
                {s.mode === 'SAVED' ? 'siz tanlagansiz' : s.mode === 'SUGGESTED' ? 'nom bo‘yicha taklif' : 'topilmadi'}
                {s.mode === 'SUGGESTED' && isAdmin && (
                  <button type="button" className="ml-1 font-semibold text-brand-700 underline" onClick={() => void act(() => nazorat3802Api.section(s.name, s.shtatKey), 'Tasdiqlandi').catch(() => undefined)}>
                    tasdiqlash
                  </button>
                )}
                {s.mode === 'SAVED' && isAdmin && (
                  <button type="button" className="ml-1 underline" onClick={() => void act(() => nazorat3802Api.section(s.name), 'Taklifga qaytarildi').catch(() => undefined)}>
                    taklifga qaytarish
                  </button>
                )}
              </span>
            </td>
            <td className={td}>{!s.shtatKey && <NoteEditor value={s.note} editable={isAdmin} onSave={note('SHTAT', `sec:${s.key}`)} />}</td>
          </tr>
        ))}
      </Table>
      <p className="text-xs font-semibold text-heading">Lavozimlar: xodimlar soni va Oklad</p>
      <Table
        head={
          <tr>
            <th className={th}>Shtat lavozimi</th>
            <th className={thr}>Birlik</th>
            <th className={thr}>Xodim</th>
            <th className={thr}>Shtat maoshi</th>
            <th className={thr}>Eng katta Oklad</th>
            <th className={th}>Holat</th>
            <th className={th}>Izoh</th>
          </tr>
        }
      >
        {[...bySec.entries()].flatMap(([sk, list]) => [
          <tr key={`h:${sk}`}>
            <td colSpan={7} className="border-t border-(--color-line) bg-brand-50/40 px-2 py-1 text-[11px] font-semibold text-brand-800">
              {shtatName.get(sk) ?? sk}
            </td>
          </tr>,
          ...list.map((p) => (
            <tr key={p.key} className={cn(p.status !== 'OK' && 'bg-(--color-warn-soft)/30')}>
              <td className={td} title={p.people.map((x) => `${x.fullName} — ${x.section}`).join('\n')}>
                {p.position}
              </td>
              <td className={cn(td, 'text-right')}>{p.units}</td>
              <td className={cn(td, 'text-right font-semibold', p.heads > Math.ceil(p.units) && 'text-(--color-warn)')}>{p.heads}</td>
              <td className={cn(td, 'text-right')}>
                <Money v={p.salaryTiyin} />
              </td>
              <td className={cn(td, 'text-right', p.people.some((x) => x.over) && 'text-(--color-warn)')}>
                <Money v={p.maxOkladTiyin} />
              </td>
              <td className={td}>
                <Badge tone={p.status === 'OK' ? 'income' : 'warn'}>{PS[p.status]}</Badge>
              </td>
              <td className={td}>{p.status !== 'OK' && <NoteEditor value={p.note} editable={isAdmin} onSave={note('SHTAT', p.key)} />}</td>
            </tr>
          )),
        ])}
      </Table>
      {m.shtat.noPosition.length > 0 && (
        <>
          <p className="text-xs font-semibold text-heading">Lavozimi shtatda topilmagan xodimlar ({m.shtat.noPosition.length})</p>
          <Table
            head={
              <tr>
                <th className={th}>Xodim</th>
                <th className={th}>Lavozimi (vedomost)</th>
                <th className={th}>Shtat bo&apos;limi</th>
                <th className={th}>Izoh</th>
              </tr>
            }
          >
            {m.shtat.noPosition.map((x) => (
              <tr key={`${x.section}|${x.key}`}>
                <td className={td}>
                  {x.fullName}
                  <span className="block text-[10.5px] text-(--color-text-faint)">{x.section}</span>
                </td>
                <td className={td}>{x.position}</td>
                <td className={td}>{x.shtatName}</td>
                <td className={td}>
                  <NoteEditor value={x.note} editable={isAdmin} onSave={note('SHTAT', x.key)} />
                </td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </div>
  );
}

// ─────────── 4) Qoplash ↔ Qo'mita ───────────

function QoplashLink({ m, isAdmin, note }: { m: NzMonth; isAdmin: boolean; note: NoteFn }) {
  const COV: Record<string, string> = { OKLAD_40: 'Oklad + 40%', FULL: "to'liq", NONE: 'qoplanmaydi' };
  const items3802 = m.qoplash.items.filter((x) => x.in3802);
  const other = m.qoplash.items.filter((x) => !x.in3802 && n(x.incomeTiyin) !== 0n);
  return (
    <div className="space-y-3">
      <Table
        head={
          <tr>
            <th className={th}>Bo&apos;lim</th>
            <th className={thr}>Qoplanishi kerak</th>
            <th className={thr}>Qo&apos;mitadan kelgan</th>
            <th className={thr}>Farq (oy)</th>
            <th className={thr}>Yil boshidan qoldiq</th>
          </tr>
        }
      >
        {items3802.map((x) => (
          <tr key={x.key}>
            <td className={td}>
              <span className="font-medium text-heading">{x.label}</span>
              <span className="block text-[10.5px] text-(--color-text-faint)">
                {x.sections.map((s) => `${s.name} — ${COV[s.coverage]}${s.rule === 'DEFAULT' ? ' (shtatda topilmadi, sukut)' : ''}`).join('; ')}
              </span>
            </td>
            <td className={cn(td, 'text-right')}>
              <Money v={x.neededTiyin} />
            </td>
            <td className={cn(td, 'text-right')}>
              <Money v={x.incomeTiyin} />
            </td>
            <td className={cn(td, 'text-right')}>
              <Money v={x.diffTiyin} signed />
            </td>
            <td className={cn(td, 'text-right')}>
              <Money v={x.ytdBalanceTiyin} signed />
            </td>
          </tr>
        ))}
        <tr className="font-semibold">
          <td className={td}>Jami (3802)</td>
          <td className={cn(td, 'text-right')}>
            <Money v={m.qoplash.neededTiyin} />
          </td>
          <td className={cn(td, 'text-right')}>
            <Money v={m.qoplash.incomeTiyin} />
          </td>
          <td className={cn(td, 'text-right')}>
            <Money v={(n(m.qoplash.incomeTiyin) - n(m.qoplash.neededTiyin)).toString()} signed />
          </td>
          <td className={td} />
        </tr>
      </Table>
      {other.length > 0 && (
        <p className="text-xs text-(--color-text-muted)">
          3802 ga kirmaydigan tushum (alohida, solishtirilmaydi): {other.map((x) => `${x.label} — ${formatTiyin(x.incomeTiyin)}`).join('; ')}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 text-xs text-(--color-text-muted)">
        Oy bo&apos;yicha izoh (masalan, «ajratma keyingi oyda keladi»):
        <NoteEditor value={m.qoplash.note} editable={isAdmin} onSave={note('QOPLASH', 'oy')} />
      </div>
      <p className="text-[11px] text-(--color-text-faint)">
        Qoplanishi kerak — vedomost bo&apos;yicha: shtat qoidasi (Oklad + 40% yoki to&apos;liq); shtatda topilmagan bo&apos;lim — Oklad + 40%. Kelgan — Daromadlar › Qo&apos;mita mablag&apos;lari
        («qaysi oy uchun» bo&apos;yicha). Depozit kiritilmaydi. {formatPeriodShort(m.period)} uchun.
      </p>
    </div>
  );
}
