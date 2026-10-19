'use client';

import { Button } from '@/components/ui/button';
import { IconClose } from '@/components/ui/icons';
import { errorMessage } from '@/lib/error-message';
import { useAsync } from '@/lib/use-async';
import Link from 'next/link';
import { useState } from 'react';
import { assetsApi } from './api';

// ═══════════════════════════════════════════════════════════
// Excel'dan yuklangan partiyani omborga ulash: har dona — ombor ro'yxatida «foydalanishda»,
// qabul qiluvchi xodim nomida (Xodimlardan topiladi). Balans va rejim o'zgarmaydi.
// Shundan keyin qaytarib olish, boshqaga o'tkazish, hisobdan chiqarish — dalolatnoma bilan, Ombor bo'limida.
// ═══════════════════════════════════════════════════════════

export function AdoptDialog({ batch, onClose, onDone }: { batch: string; onClose: () => void; onDone: (msg: string) => void }) {
  const pv = useAsync(() => assetsApi.adoptPreview(batch).then((r) => r.data), [batch]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const p = pv.data;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start gap-3 border-b border-(--color-line) px-5 py-4">
          <div className="min-w-0">
            <p className="text-base font-bold text-heading">Omborga ulash</p>
            <p className="text-xs text-(--color-text-muted)">Partiya: {batch}</p>
          </div>
          <button type="button" onClick={onClose} className="ml-auto rounded p-1 text-(--color-text-muted) hover:bg-(--color-surface-muted)" aria-label="Yopish">
            <IconClose className="size-5" />
          </button>
        </div>
        <div className="space-y-4 overflow-y-auto px-5 py-4 text-sm">
          <ul className="list-disc space-y-1 pl-5 text-(--color-text-muted)">
            <li>Har bir vosita (dona) ombor ro&apos;yxatiga «foydalanishda» bo&apos;lib kiradi — o&apos;sha joyda va qabul qiluvchi xodim nomida.</li>
            <li>Balans va rejim o&apos;zgarmaydi: xarajatga yozilmaydi (xarajat rejimidagilar — o&apos;sha holicha Markazda).</li>
            <li>Keyin qaytarib olish, boshqa xodimga o&apos;tkazish, hisobdan chiqarish — Ombor bo&apos;limida, dalolatnoma bilan.</li>
          </ul>
          {!p ? (
            <p className="py-6 text-center text-(--color-text-muted)">{pv.error ? `Yuklab bo'lmadi: ${pv.error}` : 'Tekshirilmoqda…'}</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(
                  [
                    ['Qatorlar', p.total],
                    ['Dona (vosita)', p.pieces],
                    ['Xodimga bog‘lanadi', p.matched],
                    ['Yangi inventar №', p.renumbered],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-(--color-surface-muted) px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">{k}</p>
                    <p className="text-lg font-bold tabular-nums text-heading">{v}</p>
                  </div>
                ))}
              </div>
              {p.alreadyLinked > 0 && <p className="text-xs text-(--color-text-muted)">{p.alreadyLinked} tasi allaqachon omborda — tegilmaydi.</p>}
              {p.renumbered > 0 && (
                <p className="text-xs text-(--color-text-muted)">
                  Faylda inventar raqami bo&apos;sh («0») yoki takrorlangan vositalarga raqam beriladi: takrorlanganiga «raqam-2», bo&apos;shiga «INV-000001» tartibida.
                </p>
              )}
              {p.unmatched.length > 0 && (
                <div>
                  <p className="mb-1 font-semibold text-heading">Xodimlar ro&apos;yxatidan topilmadi — ism bilan yoziladi ({p.pieces - p.matched} dona)</p>
                  <p className="mb-2 text-xs text-(--color-text-muted)">
                    Bular ham omborga ulanadi va «Kimda nima bor»da ism bo&apos;yicha ko&apos;rinadi. Xodim keyin qo&apos;shilsa — «Boshqaga o&apos;tkazish» bilan to&apos;g&apos;ri xodimga o&apos;tkazing.
                  </p>
                  <div className="max-h-48 overflow-y-auto rounded-(--radius-control) border border-(--color-line)">
                    {p.unmatched.map((u) => (
                      <div key={u.name} className="flex items-center gap-3 border-b border-(--color-line) px-3 py-1.5 text-xs last:border-b-0">
                        <span className="font-medium text-heading">{u.name}</span>
                        <span className="text-(--color-text-muted)">{u.reason}</span>
                        <span className="ml-auto tabular-nums">{u.count} dona</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {p.holders.some((h) => h.employee) && (
                <details className="text-xs">
                  <summary className="cursor-pointer font-semibold text-brand-700">Topilgan xodimlar ({p.holders.filter((h) => h.employee).length})</summary>
                  <div className="mt-2 max-h-48 overflow-y-auto rounded-(--radius-control) border border-(--color-line)">
                    {p.holders
                      .filter((h) => h.employee)
                      .map((h) => (
                        <div key={h.name} className="flex items-center gap-3 border-b border-(--color-line) px-3 py-1.5 last:border-b-0">
                          <span className="text-(--color-text-muted)">{h.name}</span>
                          <span>→</span>
                          <span className="font-medium text-heading">{h.employee}</span>
                          <span className="ml-auto tabular-nums">{h.count} dona</span>
                        </div>
                      ))}
                  </div>
                </details>
              )}
            </>
          )}
          {err && <p className="rounded-(--radius-control) bg-red-50 px-3 py-2 text-red-700">{err}</p>}
        </div>
        <div className="flex items-center gap-2 border-t border-(--color-line) px-5 py-3">
          <Link href="/ombor/shablon" className="text-xs text-brand-700 hover:underline">
            Dalolatnoma shabloni
          </Link>
          <Button variant="secondary" className="ml-auto" onClick={onClose}>
            Yopish
          </Button>
          <Button
            loading={busy}
            disabled={!p || p.total === 0}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                const r = await assetsApi.adopt(batch);
                onDone(`Omborga ulandi: ${r.data.created} ta vosita, ${r.data.matched} tasi xodim nomida`);
              } catch (e) {
                setErr(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {p && p.total === 0 ? 'Hammasi ulangan' : `Ulash${p ? ` (${p.pieces} dona)` : ''}`}
          </Button>
        </div>
      </div>
    </div>
  );
}