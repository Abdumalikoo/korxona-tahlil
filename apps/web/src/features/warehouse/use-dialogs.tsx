'use client';

import { Toast } from '@/components/ui/toast';
import { useAsync } from '@/lib/use-async';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { DOC_KIND_PATHS, warehouseApi, type DocKind, type WarehouseLookups } from './api';
import { AssetDrawer } from './asset-drawer';
import { DocDrawer } from './doc-drawer';

// ═══════════════════════════════════════════════════════════
// Ombor sahifalarining umumiy oynalari: hujjat oynasi, asosiy vosita kartasi va xabar.
//   const w = useWarehouseDialogs(reload);  w.newDoc('ISSUE'); w.openAsset(id); … {w.element}
// Yangi hujjat — alohida kiritish sahifasida (Kirim, Chiqim …): newDoc o'sha sahifani ochadi,
// asosiy vositalar berilsa — ular oldindan tanlangan bo'ladi.
// ═══════════════════════════════════════════════════════════

export interface WarehouseDialogs {
  lookups: WarehouseLookups | null;
  newDoc: (kind: DocKind, assetIds?: string[]) => void;
  /** Omborchi: kirimni xaridchi yozadi — omborchi «Qabul qilish» sahifasida tasdiqlaydi */
  keeper: boolean;
  openDoc: (id: string) => void;
  openAsset: (id: string) => void;
  notify: (message: string, tone?: 'success' | 'error') => void;
  element: ReactNode;
}

export function useWarehouseDialogs(onChanged: () => void): WarehouseDialogs {
  const lookupsState = useAsync(() => warehouseApi.lookups(), []);
  const lookups = lookupsState.data?.data ?? null;

  const router = useRouter();
  const { user } = useAuth();
  const keeper = user?.role === 'SKLADCHI';
  const [docId, setDocId] = useState<string | null>(null);
  const [assetId, setAssetId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);

  const changed = useRef(onChanged);
  changed.current = onChanged;

  const notify = useCallback((message: string, tone: 'success' | 'error' = 'success') => setToast({ message, tone }), []);

  const newDoc = useCallback(
    (kind: DocKind, assetIds?: string[]) => {
      if (kind === 'RECEIPT' && keeper) return router.push('/ombor/qabul');
      router.push(`${DOC_KIND_PATHS[kind]}${assetIds && assetIds.length ? `?assets=${assetIds.join(',')}` : ''}`);
    },
    [router, keeper],
  );
  const openDoc = useCallback((id: string) => {
    setAssetId(null);
    setDocId(id);
  }, []);
  const openAsset = useCallback((id: string) => {
    setDocId(null);
    setAssetId(id);
  }, []);

  const element = (
    <>
      <DocDrawer
        docId={docId}
        onClose={() => setDocId(null)}
        onChanged={(message) => {
          notify(message);
          changed.current();
        }}
        onOpenAsset={openAsset}
      />
      <AssetDrawer
        assetId={assetId}
        onClose={() => setAssetId(null)}
        onAction={(kind, id) => {
          setAssetId(null);
          newDoc(kind, [id]);
        }}
        onOpenDoc={openDoc}
        onChanged={(message) => {
          notify(message);
          changed.current();
        }}
      />
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}
    </>
  );

  return { lookups, keeper, newDoc, openDoc, openAsset, notify, element };
}