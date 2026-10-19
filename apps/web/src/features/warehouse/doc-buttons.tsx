'use client';

import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth-context';
import { DOC_KIND_HINTS, type DocKind } from './api';

/** «Kirim»dan tashqari hujjat turlari — SourceActions ichida, «+ Kirim» yonida (faqat administrator) */
const OTHER: { kind: DocKind; label: string }[] = [
  { kind: 'ISSUE', label: 'Chiqim (berish)' },
  { kind: 'TRANSFER', label: "Ko'chirish" },
  { kind: 'RETURN', label: 'Qaytarish' },
  { kind: 'WRITE_OFF', label: 'Hisobdan chiqarish' },
];

export function DocButtons({ onNew, only }: { onNew: (kind: DocKind) => void; only?: DocKind[] }) {
  const { canWrite } = useAuth();
  /** Kiritish huquqi: administrator yoki Omborchi */
  const isAdmin = canWrite('/ombor');
  if (!isAdmin) return null;
  return (
    <>
      {OTHER.filter((o) => !only || only.includes(o.kind)).map((o) => (
        <Button key={o.kind} size="sm" variant="secondary" onClick={() => onNew(o.kind)} title={DOC_KIND_HINTS[o.kind]}>
          {o.label}
        </Button>
      ))}
    </>
  );
}