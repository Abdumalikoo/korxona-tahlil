'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconSearch } from '@/components/ui/icons';
import { ErrorState } from '@/components/ui/states';
import { compositionApi, type PlaceOption, type PlacesAnalysis, type PlacesChoice, type PlacesSync } from '@/features/salary-composition/api';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime, formatPeriod } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useMemo, useState } from 'react';

// ═══════════════════════════════════════════════════════════
// Ish haqi tarkibi › «Tarkibdagi bo'limlar»: xodim shu oy qaysi bo'limda ishlagani (tarkib faylidan).
//  1) Tarkibdagi nom → bizdagi bo'lim (taklif; tasdiqlash yoki o'zgartirish; eslab qolinadi);
//  2) «Miya»dagi joyi tarkibdan farq qiladiganlar — belgilanganlarning joyi FAQAT SHU OY uchun tarkibdagidek bo'ladi.
// ═══════════════════════════════════════════════════════════

/** Ekrandagi tanlov: nom kaliti → bo'lim id yoki 'SKIP' ('' — tanlanmagan); belgidan olinganlar */
export interface PlaceState {
  map: Record<string, string>;
  excluded: string[];
}

const SKIP = 'SKIP';

export function initialPlaceState(p: PlacesAnalysis | null | undefined): PlaceState {
  const map: Record<string, string> = {};
  for (const d of p?.departments ?? []) map[d.key] = d.departmentId ?? (d.source === 'SKIPPED' ? SKIP : '');
  return { map, excluded: [] };
}

/** Miyadagi joyi tarkibdan farq qiladiganlar (tanlangan moslik bo'yicha) */
export function placeMismatches(p: PlacesAnalysis, st: PlaceState) {
  const opt = new Map(p.options.map((o) => [o.id, o]));
  return p.rows
    .map((r) => {
      const id = st.map[r.deptKey];
      const target = id && id !== SKIP ? opt.get(id) : undefined;
      if (!target) return null;
      const unitChange = target.unit !== r.miya.unit;
      const deptChange = !unitChange && target.unit === 'CENTER' && target.id !== r.miya.departmentId;
      if (!unitChange && !deptChange) return null;
      return { ...r, target, unitChange };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

/** Saqlash uchun: moslik (faqat tanlanganlar) va joyi o'zgartiriladigan xodimlar */
export function placesPayload(p: PlacesAnalysis | null | undefined, st: PlaceState | null): PlacesChoice | null {
  if (!p || !st || !p.rows.length) return null;
  const byKey = new Map(p.departments.map((d) => [d.key, d.name]));
  const map: Record<string, string> = {};
  for (const [k, v] of Object.entries(st.map)) if (v && byKey.has(k)) map[byKey.get(k)!] = v;
  const ex = new Set(st.excluded);
  return { map, apply: placeMismatches(p, st).filter((m) => !ex.has(m.pinfl)).map((m) => m.pinfl) };
}

const placeText = (unitLabel: string | null, unit: string | null, dept: string | null) => (unit === 'CENTER' ? `Markaz › ${dept ?? 'bo‘limsiz'}` : (unitLabel ?? 'miyada yo‘q'));

function OptionSelect({ value, options, onChange }: { value: string; options: PlaceOption[]; onChange: (v: string) => void }) {
  const groups = [...new Map(options.map((o) => [o.unitLabel, options.filter((x) => x.unitLabel === o.unitLabel)])).entries()].sort((a, b) => (a[0] === 'Markaz' ? -1 : b[0] === 'Markaz' ? 1 : a[0].localeCompare(b[0])));
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={cn('h-8 w-full max-w-[22rem] rounded-(--radius-control) border bg-white px-2 text-xs focus:border-brand-600 focus:outline-none', value ? 'border-(--color-line-strong)' : 'border-brand-600')}>
      <option value="">Bo‘limni tanlang…</option>
      <option value={SKIP}>— hisobga olinmasin (joyi o‘zgartirilmaydi)</option>
      {groups.map(([label, list]) => (
        <optgroup key={label} label={label}>
          {list.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

/** Tahlil ekrani: bo'limlar mosligi va farqlar (hali hech narsa saqlanmagan) */
export function PlacesCard({ places, period, value, onChange }: { places: PlacesAnalysis; period: string; value: PlaceState; onChange: (v: PlaceState) => void }) {
  const [q, setQ] = useState('');
  const mism = useMemo(() => placeMismatches(places, value), [places, value]);
  const ex = new Set(value.excluded);
  const chosen = mism.filter((m) => !ex.has(m.pinfl));
  const optBy = new Map(places.options.map((o) => [o.id, o]));
  const unset = places.departments.filter((d) => !value.map[d.key]);
  const shown = mism.filter((m) => {
    const t = q.trim().toLowerCase();
    return !t || m.fullName.toLowerCase().includes(t) || m.pinfl.includes(t) || m.deptName.toLowerCase().includes(t);
  });

  return (
    <>
      <Card className="overflow-hidden">
        <CardHeader
          title={`Tarkibdagi bo‘limlar · «${places.column?.label ?? 'Bo‘lim'}» ustuni (${places.column?.letter ?? ''})`}
          description={`${places.departments.length} ta nom, ${places.rows.length} xodim. Har nomga bizdagi bo‘limni tasdiqlang yoki o‘zgartiring — moslik eslab qolinadi${unset.length ? ` · ${unset.length} tasi hali tanlanmagan` : ''}`}
        />
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-[1] bg-(--color-surface-muted) text-[11px] uppercase tracking-wide text-(--color-text-muted)">
              <tr>
                <th className="px-5 py-2 text-left font-semibold">Tarkibdagi nom</th>
                <th className="w-24 px-2 py-2 text-right font-semibold">Xodimlar</th>
                <th className="px-2 py-2 text-left font-semibold">Bizdagi bo‘lim</th>
                <th className="w-40 px-5 py-2 text-left font-semibold">Holat</th>
              </tr>
            </thead>
            <tbody>
              {places.departments.map((d) => {
                const v = value.map[d.key] ?? '';
                const o = v && v !== SKIP ? optBy.get(v) : undefined;
                const changed = v !== (d.departmentId ?? (d.source === 'SKIPPED' ? SKIP : ''));
                return (
                  <tr key={d.key} className={cn('border-t border-(--color-line)', !v && 'bg-(--color-warn-soft)/30')}>
                    <td className="px-5 py-2 font-medium text-heading">{d.name}</td>
                    <td className="money px-2 py-2 text-right">{d.count}</td>
                    <td className="px-2 py-2">
                      <OptionSelect value={v} options={places.options} onChange={(x) => onChange({ ...value, map: { ...value.map, [d.key]: x } })} />
                      {o && o.unit !== 'CENTER' && <span className="mt-0.5 block text-[11px] text-(--color-text-muted)">yo‘nalish: {o.unitLabel}</span>}
                    </td>
                    <td className="px-5 py-2">
                      {!v ? (
                        <Badge tone="warn">tanlang</Badge>
                      ) : changed ? (
                        <Badge tone="brand">siz tanladingiz</Badge>
                      ) : d.source === 'LEARNED' ? (
                        <Badge tone="income">eslab qolingan</Badge>
                      ) : d.source === 'SKIPPED' ? (
                        <Badge tone="neutral">hisobga olinmaydi</Badge>
                      ) : d.exact ? (
                        <Badge tone="income">aynan mos</Badge>
                      ) : (
                        <Badge tone="warn">taxminiy — tekshiring</Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader
          title={mism.length ? `Miyadagi joyi tarkibdan farq qiladi — ${mism.length} xodim` : 'Miyadagi joylar tarkibga mos'}
          description={
            mism.length
              ? `Belgilanganlarning joyi FAQAT ${formatPeriod(period)} uchun tarkibdagidek bo‘ladi (keyingi oydan — hozirgi joyida). Shu oy ish haqi saqlangan bo‘lsa — xarajat ham to‘g‘ri bo‘limga o‘tadi`
              : 'Tarkibdagi bo‘limlar bilan «miya» bir xil — o‘zgartiriladigan joy yo‘q'
          }
        />
        {mism.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-3 border-y border-(--color-line) px-5 py-2.5 text-sm">
              <label className="flex items-center gap-2 font-medium text-heading">
                <input
                  type="checkbox"
                  className="size-4 accent-brand-600"
                  checked={chosen.length === mism.length}
                  ref={(el) => {
                    if (el) el.indeterminate = chosen.length > 0 && chosen.length < mism.length;
                  }}
                  onChange={() => onChange({ ...value, excluded: chosen.length === mism.length ? mism.map((m) => m.pinfl) : [] })}
                />
                Hammasini belgilash
              </label>
              <span className="text-xs text-(--color-text-muted)">
                belgilangan {chosen.length} / {mism.length} · yo‘nalishi o‘zgaradi: {chosen.filter((m) => m.unitChange).length} · Markaz ichida: {chosen.filter((m) => !m.unitChange).length}
              </span>
              <label className="relative ml-auto">
                <IconSearch className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-(--color-text-faint)" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="F.I.Sh., PINFL, bo‘lim" className="h-8 w-52 rounded-(--radius-control) border border-(--color-line-strong) bg-white pr-3 pl-8 text-sm focus:border-brand-600 focus:outline-none" />
              </label>
            </div>
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-[1] bg-(--color-surface-muted) text-[11px] uppercase tracking-wide text-(--color-text-muted)">
                  <tr>
                    <th className="w-10 px-3 py-2" />
                    <th className="px-2 py-2 text-left font-semibold">Xodim</th>
                    <th className="px-2 py-2 text-left font-semibold">Miyada (hozir)</th>
                    <th className="px-2 py-2 text-left font-semibold">Tarkibda ({formatPeriod(period)})</th>
                    <th className="w-36 px-3 py-2 text-left font-semibold" />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((m) => (
                    <tr key={m.pinfl} className="border-t border-(--color-line) align-top">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          aria-label="Joyini tarkibdagidek qilish"
                          className="size-4 accent-brand-600"
                          checked={!ex.has(m.pinfl)}
                          onChange={() => onChange({ ...value, excluded: ex.has(m.pinfl) ? value.excluded.filter((x) => x !== m.pinfl) : [...value.excluded, m.pinfl] })}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <span className="block font-medium text-heading">{m.fullName}</span>
                        <span className="money text-[11px] text-(--color-text-muted)">{m.pinfl}</span>
                      </td>
                      <td className="px-2 py-2 text-(--color-text-muted)">
                        {placeText(m.miya.unitLabel, m.miya.unit, m.miya.departmentName)}
                        {m.miya.fixed && <span className="block text-[11px] text-(--color-income)">shu oy avval tarkib bo‘yicha o‘zgartirilgan</span>}
                      </td>
                      <td className="px-2 py-2 font-medium text-heading">
                        {placeText(m.target.unitLabel, m.target.unit, m.target.name)}
                        <span className="block text-[11px] font-normal text-(--color-text-muted)">tarkibda: «{m.deptName}»</span>
                      </td>
                      <td className="px-3 py-2">{m.unitChange ? <Badge tone="warn">yo‘nalish o‘zgaradi</Badge> : <Badge tone="brand">Markaz ichida</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </>
  );
}

/** Saqlangan tarkib: shu oy tarkib bo'yicha o'zgartirilgan joylar (bekor qilish bilan) */
export function SavedPlacesCard({ period, isAdmin, stamp, onChanged, onToast }: { period: string; isAdmin: boolean; stamp: unknown; onChanged: () => void; onToast: (t: { message: string; tone: 'success' | 'error' }) => void }) {
  const data = useAsync(() => compositionApi.places(period).then((r) => r.data), [period, stamp]);
  const [target, setTarget] = useState<{ pinfls: string[]; label: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const v = data.data;
  if (data.error)
    return (
      <Card>
        <ErrorState message={`Tarkib bo‘yicha joy o‘zgarishlari o‘qilmadi: ${data.error}`} onRetry={data.reload} />
      </Card>
    );
  if (!v) return null;
  const sync = <SyncPlaces period={period} isAdmin={isAdmin} onChanged={() => { data.reload(); onChanged(); }} onToast={onToast} />;
  if (!v.fixes.length && !v.departments.length) return <Card className="overflow-hidden">{sync}</Card>;

  async function doRevert() {
    if (!target) return;
    setBusy(true);
    try {
      const r = (await compositionApi.revertPlaces(period, target.pinfls)).data;
      onToast({ message: `${r.reverted} xodimning joyi avvalgi holatiga qaytarildi${r.redistributed ? ' · ish haqi qayta taqsimlandi' : ''}`, tone: 'success' });
      data.reload();
      onChanged();
    } catch (err) {
      onToast({ message: errorMessage(err, 'Qaytarishda xatolik'), tone: 'error' });
    } finally {
      setBusy(false);
      setTarget(null);
    }
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={`Tarkib bo‘yicha shu oy joyi o‘zgartirilganlar — ${v.fixes.length} xodim`}
        description={`${formatPeriod(period)} uchun (keyingi oydan — hozirgi joyida)${v.at ? ` · ${formatDateTime(v.at)}` : ''} · tarkibda ${v.departments.length} ta bo‘lim`}
      />
      {v.departments.length > 0 && (
        <CardBody className="flex flex-wrap gap-1.5 text-xs">
          {v.departments.map((d) => (
            <span key={d.name} className="rounded-full border border-(--color-line) bg-white px-2.5 py-0.5">
              {d.name} <span className="money text-(--color-text-muted)">{d.count}</span>
            </span>
          ))}
        </CardBody>
      )}
      {sync}
      {v.fixes.length > 0 && (
        <ul className="divide-y divide-(--color-line) border-t border-(--color-line) text-sm">
          {v.fixes.map((f) => (
            <li key={f.pinfl} className="flex flex-wrap items-center gap-3 px-5 py-2">
              <span className="min-w-0 flex-1">
                <b className="text-heading">{f.fullName}</b>{' '}
                <span className="text-(--color-text-muted)">
                  {placeText(f.fromUnitLabel, f.fromUnit, f.fromDepartmentName)} → <b className="text-heading">{placeText(f.unitLabel, f.unit, f.departmentName)}</b>
                </span>
              </span>
              {f.unit !== f.fromUnit ? <Badge tone="warn">yo‘nalish</Badge> : <Badge tone="brand">Markaz ichida</Badge>}
              {isAdmin && (
                <Button size="sm" variant="ghost" className="text-(--color-text-muted) hover:text-(--color-expense)" onClick={() => setTarget({ pinfls: [f.pinfl], label: f.fullName })}>
                  Qaytarish
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {isAdmin && v.fixes.length > 1 && (
        <div className="flex justify-end border-t border-(--color-line) px-5 py-2.5">
          <Button size="sm" variant="ghost" className="text-(--color-text-muted) hover:text-(--color-expense)" onClick={() => setTarget({ pinfls: v.fixes.map((f) => f.pinfl), label: `${v.fixes.length} xodim` })}>
            Hammasini qaytarish
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={target !== null}
        title="Avvalgi joyiga qaytarish"
        message={`${target?.label ?? ''}: ${formatPeriod(period)} uchun joyi «miya»dagi avvalgi holatiga qaytadi; ish haqi xarajati ham qayta taqsimlanadi.`}
        confirmLabel="Qaytarish"
        danger
        loading={busy}
        onConfirm={() => void doRevert()}
        onCancel={() => setTarget(null)}
      />
    </Card>
  );
}

/**
 * Tarkib bo'yicha HAMMA xodimni joylashtirish: shu oy «miya»dagi joyi tarkibdagidan farq qiladiganlar — oldindan ko'rish,
 * so'ng tasdiqlash. Saqlanganda ish haqi xarajati bo'limlar bo'yicha qayta guruhlanadi (qaytarish — yuqoridagi ro'yxatdan).
 */
function SyncPlaces({ period, isAdmin, onChanged, onToast }: { period: string; isAdmin: boolean; onChanged: () => void; onToast: (t: { message: string; tone: 'success' | 'error' }) => void }) {
  const [preview, setPreview] = useState<PlacesSync | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [all, setAll] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setPreview((await compositionApi.syncPlacesPreview(period)).data);
    } catch (err) {
      onToast({ message: errorMessage(err, "Tarkibni o'qib bo'lmadi"), tone: 'error' });
    } finally {
      setLoading(false);
    }
  }

  async function apply() {
    setBusy(true);
    try {
      const r = (await compositionApi.syncPlaces(period)).data;
      onToast({
        message:
          `${r.fixed} xodim ${formatPeriod(period)} uchun tarkibdagi bo'limiga joylashtirildi${r.redistributed ? ' · ish haqi qayta taqsimlandi' : ' · ish haqi xarajati bo‘limlar bo‘yicha qayta guruhlandi'}` +
          (r.warnings.length ? ` · diqqat: ${r.warnings[0]}` : ''),
        tone: 'success',
      });
      setPreview(null);
      onChanged();
    } catch (err) {
      onToast({ message: errorMessage(err, 'Joylashtirishda xatolik'), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  if (!preview)
    return (
      <div className="flex flex-wrap items-center gap-3 border-t border-(--color-line) bg-[#f7f9fc] px-5 py-3">
        <p className="min-w-0 flex-1 text-sm text-(--color-text-muted)">
          <b className="text-heading">Tarkib bo&apos;yicha joylashtirish:</b> tarkibdagi har xodim {formatPeriod(period)} uchun tarkibda yozilgan bo&apos;limga o&apos;tadi, ish haqi
          xarajati ham shu bo&apos;limlar bo&apos;yicha bo&apos;linadi. Avval nima o&apos;zgarishi ko&apos;rsatiladi.
        </p>
        <Button size="sm" variant="secondary" loading={loading} onClick={() => void load()}>
          Nima o&apos;zgaradi — ko&apos;rish
        </Button>
      </div>
    );

  const shown = all ? preview.items : preview.items.slice(0, 30);
  return (
    <div className="border-t border-(--color-line) bg-[#f7f9fc] px-5 py-3 text-sm">
      {!preview.hasTarkib ? (
        <p className="text-(--color-text-muted)">{formatPeriod(period)} uchun ish haqi tarkibida bo&apos;limlar yo&apos;q — tarkib faylini bo&apos;lim ustuni («Hududi», «Bo&apos;lim») bilan yuklang.</p>
      ) : (
        <>
          <p className="font-semibold text-heading">
            {preview.items.length ? `${preview.items.length} xodimning joyi o‘zgaradi` : 'Hamma xodim tarkibdagi bo‘limida — o‘zgarish yo‘q'}{' '}
            <span className="font-normal text-(--color-text-muted)">
              · tarkibda {preview.total} xodim{preview.manual ? ` · ${preview.manual} tasi qo‘lda tanlangan (tegilmaydi)` : ''}
            </span>
          </p>
          {preview.byTarget.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
              {preview.byTarget.map((t) => (
                <span key={t.label} className="rounded-full border border-brand-200 bg-white px-2.5 py-0.5">
                  → {t.label} <b>{t.count}</b>
                </span>
              ))}
            </div>
          )}
          {preview.unmapped.length > 0 && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Bizdagi bo&apos;limga bog&apos;lanmagan nomlar (bu xodimlar joylashtirilmaydi): {preview.unmapped.map((u) => `«${u.name}» (${u.count})`).join(', ')}. Bo&apos;lim sahifasida
              (masalan, Markaz › bo&apos;lim) nomni tanlang va qayta bosing.
            </p>
          )}
          {preview.guessed.length > 0 && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Taxminiy moslik — tekshiring: {preview.guessed.map((g) => `«${g.name}» → ${g.departmentName}`).join('; ')}
            </p>
          )}
          {shown.length > 0 && (
            <ul className="mt-2 max-h-80 divide-y divide-(--color-line) overflow-y-auto rounded-lg border border-(--color-line) bg-white text-xs">
              {shown.map((i) => (
                <li key={i.pinfl} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                  <b className="min-w-48 text-heading">{i.fullName}</b>
                  <span className="text-(--color-text-muted)">{i.from}</span>
                  <span>→</span>
                  <b className="text-heading">{i.to}</b>
                  {i.unitChange && <Badge tone="warn">yo‘nalish o‘zgaradi</Badge>}
                </li>
              ))}
            </ul>
          )}
          {preview.items.length > 30 && (
            <button type="button" className="mt-1 text-xs font-semibold text-brand-700" onClick={() => setAll(!all)}>
              {all ? 'Qisqartirish' : `Hammasini ko‘rsatish (${preview.items.length})`}
            </button>
          )}
        </>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setPreview(null)} disabled={busy}>
          Yopish
        </Button>
        {isAdmin && preview.items.length > 0 && (
          <Button size="sm" loading={busy} onClick={() => void apply()}>
            Joylashtirish ({preview.items.length} xodim)
          </Button>
        )}
      </div>
    </div>
  );
}
