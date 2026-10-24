'use client';

import { api, type ApiResponse } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import Link from 'next/link';
import { useEffect, useState } from 'react';

// ═══════════════════════════════════════════════════════════
// Administrator uchun ogohlantirish: standart (hammaga ma'lum) o'chirish paroli yoki chat kodi
// hali almashtirilmagan. Bir marta yuklanadi; «Keyinroq» — shu brauzer oynasi uchun yashiriladi.
// ═══════════════════════════════════════════════════════════

const HIDE_KEY = 'security-banner-hidden';

interface Status {
  deletePasswordDefault: boolean;
  chatCodeDefault: boolean;
}

export function SecurityBanner() {
  const { isAdmin, actingRole } = useAuth();
  const [status, setStatus] = useState<Status | null>(null);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (!isAdmin || actingRole) return;
    let off = false;
    try {
      if (window.sessionStorage.getItem(HIDE_KEY) === '1') return;
    } catch {
      // sessionStorage yopiq bo'lsa — baribir ko'rsatiladi
    }
    setHidden(false);
    api
      .get<ApiResponse<Status>>('/security/status')
      .then((r) => !off && setStatus(r.data))
      .catch(() => null);
    return () => {
      off = true;
    };
  }, [isAdmin, actingRole]);

  if (hidden || !status || (!status.deletePasswordDefault && !status.chatCodeDefault)) return null;

  const hide = () => {
    setHidden(true);
    try {
      window.sessionStorage.setItem(HIDE_KEY, '1');
    } catch {
      // e'tiborsiz
    }
  };

  return (
    <div role="status" className="no-print mx-4 mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-(--radius-control) border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 md:mx-6">
      <b className="font-semibold">Xavfsizlik:</b>
      <span className="min-w-0 flex-1">
        {status.deletePasswordDefault && (
          <>
            O&apos;chirish paroli standart —{' '}
            <Link href="/sozlamalar/xavfsizlik" className="font-medium underline underline-offset-2">
              almashtiring
            </Link>{' '}
            (shungacha ko&apos;p yozuvni o&apos;chirish yopiq).{' '}
          </>
        )}
        {status.chatCodeDefault && (
          <>
            Chat kodi standart —{' '}
            <Link href="/sozlamalar/chat-kodi" className="font-medium underline underline-offset-2">
              almashtiring
            </Link>{' '}
            (shungacha chat yopiq).
          </>
        )}
      </span>
      <button type="button" onClick={hide} className="text-xs text-amber-800 hover:text-amber-950">
        Keyinroq
      </button>
    </div>
  );
}