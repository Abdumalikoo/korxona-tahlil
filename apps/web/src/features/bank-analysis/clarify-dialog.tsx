'use client';

import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { formatDate, formatTiyin } from '@/lib/format';
import { useState } from 'react';

// Bank ko'chirmasi: to'lovni «Aniqlashtirishda» ro'yxatiga o'tkazish oynasi (guruhlar jadvali, guruh oynasi, nomma-nom ro'yxat).
/** Aniqlashtirishga o'tkazish: nima aniqlanishi kerakligini yozish (ixtiyoriy) */
export function ClarifyDialog({ rows, label, busy, onConfirm, onCancel }: { rows?: { docDate: string; docNo: string; amountTiyin: string }[]; label?: string; busy: boolean; onConfirm: (note: string) => void; onCancel: () => void }) {
  const [note, setNote] = useState('');
  const list = rows ?? [];
  const total = list.reduce((s, x) => s + BigInt(x.amountTiyin), 0n);
  return (
    <Drawer
      open
      onClose={onCancel}
      title="Aniqlashtirishga o'tkazish"
      description={label ?? `${list.length === 1 ? `${formatDate(list[0]!.docDate)} № ${list[0]!.docNo || '—'}` : `${list.length} ta to'lov`} · ${formatTiyin(total.toString())} so'm`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Bekor
          </Button>
          <Button onClick={() => onConfirm(note)} loading={busy}>
            Aniqlashtirishga
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-(--color-text-muted)">
          To&apos;lov ish ro&apos;yxatidan «Aniqlashtirishda» ro&apos;yxatiga o&apos;tadi. Hech qanday yozuv yaratilmaydi. Aniqlab, tuzatgach — o&apos;sha yerdan yo&apos;naltirasiz (belgi o&apos;zi olinadi).
        </p>
        <label className="block text-xs font-medium text-(--color-text-muted)">
          Nima aniqlanishi kerak? (ixtiyoriy)
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={3} placeholder="Masalan: qaysi bo'lim uchun ekanini buxgalteriyadan so'rash; shartnoma raqami noma'lum" className="mt-1 block w-full rounded-(--radius-control) border border-(--color-line-strong) bg-white px-2 py-1.5 text-sm text-heading focus:border-brand-600 focus:outline-none" />
        </label>
      </div>
    </Drawer>
  );
}
