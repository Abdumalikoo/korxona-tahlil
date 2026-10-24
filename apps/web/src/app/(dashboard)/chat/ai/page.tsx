'use client';

import { PageHeader } from '@/components/layout/page-header';
import { Card } from '@/components/ui/card';
import Link from 'next/link';

/** Chat › AI chati — sun'iy intellekt bilan suhbat (keyingi bosqich) */
export default function AiChatPage() {
  return (
    <>
      <PageHeader title="Chat" description="AI chati — tez kunda" />
      <div className="p-4 md:p-6">
        <Card className="mx-auto max-w-2xl px-6 py-12 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-violet-600 text-xl font-bold text-white shadow">AI</div>
          <h2 className="mt-4 text-lg font-bold text-heading">AI chati — keyingi bosqich</h2>
          <p className="mt-2 text-sm text-(--color-text-muted)">
            Bu yerda sun&apos;iy intellekt erkin savollarga javob beradi, tahlil va xulosa yozadi. Hozircha aniq javoblar uchun Manba chatidan foydalaning — u faqat
            tizimdagi ma&apos;lumotdan javob beradi.
          </p>
          <Link href="/chat" className="mt-5 inline-flex rounded-(--radius-control) bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
            Manba chatiga o&apos;tish
          </Link>
        </Card>
      </div>
    </>
  );
}