'use client';

import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { formatSum } from '@/lib/format';
import { useEffect, useMemo, useState } from 'react';

// ═══════════════════════════════════════════════════════════
// Excel'dan qatorlarni qo'yish: Excel'da ustunlarni belgilab (Nomi · Miqdor · Narx) Ctrl+C,
// shu yerga Ctrl+V. Sarlavha qatori bo'lsa — o'zi tashlab yuboriladi.
// Nom ro'yxatdagi buyumga mos kelmasa — qator sariq bo'lib qo'shiladi, buyumni tanlaysiz.
// ═══════════════════════════════════════════════════════════

export interface PastedRow {
  name: string;
  qty: number | null;
  /** so'm */
  price: number | null;
}

function toNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[\s ]/g, '').replace(/so'?m$/i, '').replace(',', '.');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function parsePasted(text: string): PastedRow[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.split(/\t|;/).map((c) => c.trim()))
    .filter((cells) => cells.some(Boolean))
    .map((cells) => {
      // Birinchi matnli katak — nom; keyingi sonlar — miqdor va narx
      const nameIndex = cells.findIndex((c) => c && toNumber(c) === null);
      const name = nameIndex >= 0 ? cells[nameIndex]! : '';
      const nums = cells.filter((_, i) => i !== nameIndex).map(toNumber).filter((n): n is number => n !== null);
      return { name, qty: nums[0] ?? null, price: nums[1] ?? null };
    })
    // Sarlavha («Nomi | Miqdor | Narx») va nomsiz qatorlar tashlanadi
    .filter((r) => r.name && !(r.qty === null && r.price === null && /nom|nomi|наимен|name/i.test(r.name)));
}

export function PasteDialog({ open, withPrice, onClose, onApply }: { open: boolean; withPrice: boolean; onClose: () => void; onApply: (rows: PastedRow[]) => void }) {
  const [text, setText] = useState('');
  useEffect(() => {
    if (open) setText('');
  }, [open]);
  const rows = useMemo(() => parsePasted(text), [text]);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="lg"
      title="Excel'dan qatorlarni qo'yish"
      description={withPrice ? 'Ustunlar tartibi: Nomi · Miqdor · Narx (so‘m). Excel’da belgilab Ctrl+C, bu yerga Ctrl+V.' : 'Ustunlar tartibi: Nomi · Miqdor. Excel’da belgilab Ctrl+C, bu yerga Ctrl+V.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button onClick={() => onApply(rows)} disabled={rows.length === 0}>
            {rows.length} ta qatorni qo&apos;shish
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder={withPrice ? "A4 qog'oz «Svetocopy»\t50\t58000\nKartrij HP 85A\t6\t320000" : "A4 qog'oz «Svetocopy»\t10\nQalam (ko'k)\t2"}
          className="w-full rounded-(--radius-control) border border-(--color-line-strong) px-3 py-2 font-mono text-sm"
        />
        {rows.length > 0 && (
          <div className="overflow-hidden rounded-(--radius-control) border border-(--color-line)">
            <table className="w-full text-sm">
              <thead className="bg-(--color-surface-muted) text-xs text-(--color-text-muted)">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Nomi</th>
                  <th className="px-3 py-2 text-right font-medium">Miqdor</th>
                  {withPrice && <th className="px-3 py-2 text-right font-medium">Narx</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-(--color-line)">
                    <td className="px-3 py-1.5">{r.name}</td>
                    <td className="money px-3 py-1.5 text-right">{r.qty ?? <span className="text-(--color-expense)">—</span>}</td>
                    {withPrice && <td className="money px-3 py-1.5 text-right">{r.price !== null ? formatSum(r.price) : '—'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-(--color-text-muted)">
          Nom ma&apos;lumotnomadagi buyumga mos kelsa — o&apos;zi tanlanadi. Mos kelmasa — qator sariq bo&apos;lib qo&apos;shiladi: buyumni tanlaysiz yoki «+ Yangi buyum» bilan qo&apos;shasiz.
          {withPrice && ' Narx yozilmasa — oxirgi kirim narxi qo‘yiladi.'}
        </p>
      </div>
    </Drawer>
  );
}