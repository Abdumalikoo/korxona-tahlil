'use client';

import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/error-message';
import { cn } from '@/lib/utils';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { AREA_LABEL, bplanApi, KIND_LABEL, mln, type BplanMap, type FactLine, type LineSource, type Overview } from './api';
import { SourceDrawer } from './source-drawer';

// ═══════════════════════════════════════════════════════════
// «Fakt va belgilash»: har bir hisobot qatori — qayerdan olinadi (belgilash) va 4 chorak fakti.
// Avtomatik qiymat dasturdan; katakka yozilsa — qo'lda (sariq), × — avtomatikka qaytadi.
// Pastda: hududiy daromad moddalari → xizmat guruhlari va guruh → «Умумий объем» qatori.
// ═══════════════════════════════════════════════════════════

/** qator → chorak indeksi → yozilgan matn (null — avtomatikka qaytarish) */
type Draft = Record<string, Record<number, string | null>>;

function parse(v: string | null): number | null {
  if (v === null) return null;
  const t = v.replace(/\s/g, '').replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function FactEditor({ data, canEdit, onChanged, notify }: { data: Overview; canEdit: boolean; onChanged: () => void; notify: (m: string, tone?: 'success' | 'error') => void }) {
  const [draft, setDraft] = useState<Draft>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [edit, setEdit] = useState<FactLine | null>(null);
  const [map, setMap] = useState<BplanMap>(data.map);

  useEffect(() => {
    setMap(data.map);
    setDraft({});
  }, [data]);

  const dirty = Object.keys(draft).length > 0;
  const sections = useMemo(() => {
    const out: { name: string; lines: FactLine[] }[] = [];
    for (const l of data.lines) {
      const last = out[out.length - 1];
      if (last && last.name === l.section) last.lines.push(l);
      else out.push({ name: l.section, lines: [l] });
    }
    return out;
  }, [data.lines]);

  const derivedQ = (key: string): number[] => {
    const row = Number(key.slice(1));
    const code = data.uoCodes[[23, 24, 25, 26, 27].indexOf(row)]?.code;
    return [0, 1, 2, 3].map((qi) => {
      let s = 0;
      data.groups.forEach((_, gi) => {
        if ((map.groupMap[gi] ?? '') !== code) return;
        for (const reg of data.regionCells.final[qi] ?? []) s += reg?.[gi] ?? 0;
      });
      return s;
    });
  };

  const saveManual = async () => {
    setBusy('manual');
    try {
      const lines: Record<string, (number | null)[]> = {};
      for (const [key, cell] of Object.entries(data.cells)) lines[key] = [...cell.manual];
      for (const [key, vals] of Object.entries(draft)) {
        const base = lines[key] ?? [null, null, null, null];
        lines[key] = base.map((b, i) => (i in vals ? parse(vals[i] ?? null) : b));
      }
      await bplanApi.saveManual(data.year, { lines, regions: data.regionCells.manual });
      setDraft({});
      notify("Fakt saqlandi — hisobot va Excel yangilandi");
      onChanged();
    } catch (e) {
      notify(errorMessage(e, "Saqlab bo'lmadi"), 'error');
    } finally {
      setBusy(null);
    }
  };

  const persistMap = async (next: BplanMap, msg: string) => {
    setBusy('map');
    try {
      const r = await bplanApi.saveMap(next);
      setMap(r.data);
      setEdit(null);
      notify(msg);
      onChanged();
    } catch (e) {
      notify(errorMessage(e, "Saqlab bo'lmadi"), 'error');
    } finally {
      setBusy(null);
    }
  };

  const sourceText = (key: string): string => {
    const s = map.lines[key];
    if (!s || s.kind === 'MANUAL') return "Qo'lda";
    const n = data.notes[key];
    return n ?? `${KIND_LABEL[s.kind]} · ${AREA_LABEL[s.area ?? 'all']}`;
  };

  const incomeUsed = data.sources.incomeCategories;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 rounded-(--radius-card) border border-(--color-line) bg-white px-4 py-3">
        <p className="min-w-0 flex-1 text-sm text-(--color-text-muted)">
          {map.saved ? 'Belgilash saqlangan.' : "Belgilash hali saqlanmagan — moddalar nomi bo'yicha taklif ko'rsatilmoqda."} Fakt (млн.сўм) har chorak uchun shu belgilash bo&apos;yicha dasturdan hisoblanadi;
          katakka yozsangiz — qo&apos;lda (sariq) qiymat ustun bo&apos;ladi.
        </p>
        {canEdit && !map.saved && (
          <Button size="sm" variant="secondary" loading={busy === 'map'} onClick={() => void persistMap(map, 'Taklif qilingan belgilash saqlandi')}>
            Taklifni saqlash
          </Button>
        )}
        {canEdit && (
          <Button size="sm" disabled={!dirty} loading={busy === 'manual'} onClick={() => void saveManual()}>
            Faktni saqlash
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-(--radius-card) border border-(--color-line) bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-(--color-surface-muted) text-[11px] uppercase tracking-wide text-(--color-text-muted)">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Qator</th>
                <th className="w-[19rem] px-3 py-2 text-left font-semibold">Manba (belgilash)</th>
                {[1, 2, 3, 4].map((q) => (
                  <th key={q} className="w-28 px-2 py-2 text-right font-semibold">
                    {q}-chorak
                  </th>
                ))}
                <th className="w-24 px-3 py-2 text-right font-semibold">Jami</th>
              </tr>
            </thead>
            <tbody>
              {sections.map((sec) => (
                <Fragment key={sec.name}>
                  <tr className="border-t border-(--color-line) bg-brand-50/50">
                    <td colSpan={7} className="px-3 py-1.5 text-xs font-semibold text-heading">
                      {sec.name}
                    </td>
                  </tr>
                  {sec.lines.map((l) => {
                    const cell = data.cells[l.key];
                    const vals = l.derived ? derivedQ(l.key) : (cell?.final ?? [null, null, null, null]);
                    const total = l.kind === 'balance' ? vals[3] : l.kind === 'count' ? null : vals.reduce((s: number, v) => s + (v ?? 0), 0);
                    return (
                      <tr key={l.key} className="border-t border-(--color-line)">
                        <td className="px-3 py-1">
                          <span className="text-heading">{l.name}</span>
                        </td>
                        <td className="px-3 py-1">
                          {l.derived ? (
                            <span className="text-xs text-(--color-text-muted)">«Hududlar fakti»dan (guruhlar bo&apos;yicha)</span>
                          ) : (
                            <button
                              type="button"
                              disabled={!canEdit}
                              onClick={() => setEdit(l)}
                              title={canEdit ? 'Bosing — qayerdan olinishini belgilash' : undefined}
                              className={cn(
                                'max-w-full truncate rounded-full px-2.5 py-0.5 text-left text-xs ring-1',
                                map.lines[l.key] && map.lines[l.key]!.kind !== 'MANUAL' ? 'bg-brand-50 text-brand-700 ring-brand-200' : 'bg-white text-(--color-text-muted) ring-(--color-line)',
                                canEdit && 'hover:ring-brand-400',
                              )}
                            >
                              {sourceText(l.key)}
                            </button>
                          )}
                        </td>
                        {[0, 1, 2, 3].map((i) => {
                          const manual = cell?.manual[i] ?? null;
                          const drafted = draft[l.key] && i in draft[l.key]! ? draft[l.key]![i] : undefined;
                          const text = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(Math.round(v * 1000) / 1000).replace('.', ','));
                          const value = drafted === undefined ? text(vals[i]) : drafted === null ? text(cell?.auto[i]) : drafted;
                          const isManual = drafted === undefined ? manual !== null : drafted !== null && drafted.trim() !== '';
                          if (l.derived || !canEdit)
                            return (
                              <td key={i} className={cn('money px-2 py-1 text-right', manual !== null && 'bg-amber-50')}>
                                {mln(vals[i] ?? null, l.kind === 'count' ? 1 : 1)}
                              </td>
                            );
                          return (
                            <td key={i} className="px-1 py-0.5">
                              <div className="relative">
                                <input
                                  value={value}
                                  inputMode="decimal"
                                  onChange={(e) => setDraft((d) => ({ ...d, [l.key]: { ...(d[l.key] ?? {}), [i]: e.target.value } }))}
                                  title={cell?.auto[i] !== null && cell?.auto[i] !== undefined ? `Dasturdan: ${mln(cell.auto[i], 3)}` : 'Dasturdan qiymat yo‘q'}
                                  className={cn(
                                    'money h-8 w-full rounded-md border px-2 text-right text-sm focus:border-brand-500',
                                    isManual ? 'border-amber-300 bg-amber-50' : 'border-transparent bg-transparent hover:border-(--color-line)',
                                  )}
                                />
                                {isManual && (
                                  <button
                                    type="button"
                                    title="Dasturdagi qiymatga qaytarish"
                                    onClick={() => setDraft((d) => ({ ...d, [l.key]: { ...(d[l.key] ?? {}), [i]: null } }))}
                                    className="absolute top-1/2 left-1 -translate-y-1/2 text-[11px] text-amber-700 hover:text-red-600"
                                  >
                                    ×
                                  </button>
                                )}
                              </div>
                            </td>
                          );
                        })}
                        <td className="money px-3 py-1 text-right font-semibold text-heading">{l.kind === 'count' ? '' : mln(total as number | null)}</td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Hududiy daromad moddalari → guruh; guruh → «Умумий объем» qatori */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <div className="overflow-hidden rounded-(--radius-card) border border-(--color-line) bg-white">
          <div className="border-b border-(--color-line) px-4 py-3">
            <p className="text-sm font-semibold text-heading">Hududiy daromad moddalari → xizmat guruhi</p>
            <p className="text-xs text-(--color-text-muted)">Hududlar daromadi (service_report) shu guruhlarga yig&apos;iladi — «Hududlar fakti» va 4-илова ijrosi</p>
          </div>
          <div className="max-h-[26rem] overflow-y-auto">
            {incomeUsed.map((c) => {
              const gi = map.incomeGroups[c.code];
              return (
                <div key={c.code} className="flex items-center gap-3 border-b border-(--color-line) px-4 py-1.5 text-sm last:border-b-0">
                  <span className="min-w-0 flex-1 truncate">{c.label}</span>
                  <select
                    disabled={!canEdit}
                    value={gi === undefined ? '' : String(gi)}
                    onChange={(e) => {
                      const v = e.target.value;
                      const next = { ...map.incomeGroups };
                      if (v === '') delete next[c.code];
                      else next[c.code] = Number(v);
                      setMap({ ...map, incomeGroups: next });
                    }}
                    className="h-8 w-60 rounded-md border border-(--color-line) bg-white px-2 text-xs"
                  >
                    <option value="">— hisobga olinmaydi —</option>
                    {data.groups.map((g, i) => (
                      <option key={g} value={i}>
                        {g}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </div>
        <div className="overflow-hidden rounded-(--radius-card) border border-(--color-line) bg-white">
          <div className="border-b border-(--color-line) px-4 py-3">
            <p className="text-sm font-semibold text-heading">Guruh → «Умумий объем» qatori</p>
            <p className="text-xs text-(--color-text-muted)">«Boshqa» va «Yangi» xizmatlar rejada alohida qator emas — qaysiga qo&apos;shilishini tanlang</p>
          </div>
          {data.groups.map((g, i) => (
            <div key={g} className="flex items-center gap-3 border-b border-(--color-line) px-4 py-1.5 text-sm last:border-b-0">
              <span className="min-w-0 flex-1 truncate">{g}</span>
              <select
                disabled={!canEdit}
                value={map.groupMap[i] ?? ''}
                onChange={(e) => setMap({ ...map, groupMap: map.groupMap.map((x, k) => (k === i ? e.target.value : x)) })}
                className="h-8 w-48 rounded-md border border-(--color-line) bg-white px-2 text-xs"
              >
                {data.uoCodes.map((u) => (
                  <option key={u.code} value={u.code}>
                    {u.code} {u.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
          {canEdit && (
            <div className="flex justify-end gap-2 px-4 py-3">
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  try {
                    const r = await bplanApi.suggest();
                    setMap({ ...map, incomeGroups: r.data.incomeGroups });
                  } catch (e) {
                    notify(errorMessage(e), 'error');
                  }
                }}
              >
                Nomlar bo&apos;yicha taklif
              </Button>
              <Button size="sm" loading={busy === 'map'} onClick={() => void persistMap(map, 'Guruhlar saqlandi')}>
                Guruhlarni saqlash
              </Button>
            </div>
          )}
        </div>
      </div>
      {data.unmatchedRegions.length > 0 && (
        <p className="rounded-(--radius-control) bg-(--color-warn-soft) px-3 py-2 text-xs text-(--color-warn)">
          Hisobotdagi 14 hududga moslanmagan hududlar (daromadi hisobga olinmaydi): {data.unmatchedRegions.join(', ')}
        </p>
      )}

      <SourceDrawer
        line={edit}
        source={edit ? map.lines[edit.key] : undefined}
        sources={data.sources}
        saving={busy === 'map'}
        onClose={() => setEdit(null)}
        onSave={(key, s: LineSource) => {
          const lines = { ...map.lines };
          if (s.kind === 'MANUAL') delete lines[key];
          else lines[key] = s;
          void persistMap({ ...map, lines }, 'Belgilash saqlandi — fakt qayta hisoblandi');
        }}
      />
    </div>
  );
}