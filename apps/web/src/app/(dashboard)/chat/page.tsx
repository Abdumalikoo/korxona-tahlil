'use client';

import { PageHeader } from '@/components/layout/page-header';
import { Card } from '@/components/ui/card';
import { SourceChatView } from '@/features/chat/source-chat-view';
import { useAuth } from '@/lib/auth-context';

/**
 * Chat › Manba chati: savolga javob faqat tizim manbalaridan — xodimlar (miya), ish haqi,
 * xarajat / daromad / natija, xodimlar soni. AI chati — alohida yorliqda (tez kunda).
 */
export default function ChatPage() {
  const { isAdmin } = useAuth();
  return (
    <>
      <PageHeader title="Chat" description="Manba chati — javob faqat tizimdagi manbalardan, taxminsiz" />
      <div className="p-4 md:p-6">
        {isAdmin ? (
          <SourceChatView />
        ) : (
          <Card className="p-6 text-sm text-(--color-text-muted)">Chat faqat administrator uchun — unda xodimlarning shaxsiy ma&apos;lumotlari ham bor.</Card>
        )}
      </div>
    </>
  );
}