'use client';

import { PageHeader } from '@/components/layout/page-header';
import { SearchInput } from '@/components/shared/search-input';
import { SourceActions } from '@/components/shared/source-actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { SubTabs } from '@/components/ui/tabs';
import { Table, TBody, Td, TFoot, Th, THead, Tr } from '@/components/ui/table';
import { qtyText, warehouseApi, type ItemKind, type WarehouseItem } from '@/features/warehouse/api';
import { DocButtons } from '@/features/warehouse/doc-buttons';
import { ItemForm } from '@/features/warehouse/item-form';
import { useWarehouseDialogs } from '@/features/warehouse/use-dialogs';
import { useAuth } from '@/lib/auth-context';
import { formatTiyin } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useState } from 'react';

// ═══════════════════════════════════════════════════════════
// Ombor › Qoldiq — buyumlar ma'lumotnomasi va bugungi qoldiq.
// Qoldiq hujjatlardan hisoblanadi: kirim + qaytarish − chiqim − hisobdan chiqarish.
// ═══════════════════════════════════════════════════════════

type KindTab = 'ALL' | ItemKind;

export default function WarehouseStockPage() {
  const { canWrite } = useAuth();
  /** Kiritish huquqi: administrator yoki Omborchi */
  const isAdmin = canWrite('/ombor');
  const [kind, setKind] = useState<KindTab>('ALL');
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  const [lowOnly, setLowOnly] = useState(false);
  const [editing, setEditing] = useState<WarehouseItem | null>(null);
  const [creating, setCreating] = useState(false);

  const list = useAsync(() => warehouseApi.items({ kind: kind === 'ALL' ? undefined : kind, search, all: archived }), [kind, search, archived]);
  const w = useWarehouseDialogs(list.reload);

  const all = list.data?.data ?? [];
  const items = lowOnly ? all.filter((i) => i.low) : all;
  const lowCount = all.filter((i) => i.low).length;
  const value = items.reduce((s, i) => s + Number(i.stockValueTiyin), 0);

  return (
    <>
      <PageHeader title="Qoldiq" description="Buyumlar ma'lumotnomasi va ombordagi bugungi qoldiq" />

      <div className="space-y-4 p-6">
        <SourceActions
          add={{ label: 'Yangi buyum', onClick: () => setCreating(true), hint: "Ma'lumotnomaga qo'shish — keyin kirim va chiqimda tanlanadi" }}
          extra={
            isAdmin ? (
              <>
                <Button size="sm" variant="secondary" onClick={() => w.newDoc('RECEIPT')}>
                  {w.keeper ? 'Qabul qilish' : 'Kirim'}
                </Button>
                <DocButtons onNew={(k) => w.newDoc(k)} only={['ISSUE', 'WRITE_OFF']} />
                <span className="text-xs text-(--color-text-muted)">Buyumni o&apos;chirish — qatorni bosing, oyna ochiladi.</span>
              </>
            ) : null
          }
        />

        <div className="flex flex-wrap items-center gap-3">
          <SubTabs<KindTab>
            value={kind}
            onChange={setKind}
            options={[
              { value: 'ALL', label: 'Barchasi' },
              { value: 'TMZ', label: 'TMZ' },
              { value: 'ASSET', label: 'Asosiy vositalar' },
            ]}
          />
          <SearchInput value={search} onChange={setSearch} placeholder="Nomi yoki kodi" className="w-64" />
          <label className="flex cursor-pointer items-center gap-2 text-sm text-(--color-text-muted)">
            <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} className="size-4" />
            Faqat kam qolganlar
            {lowCount > 0 && <Badge tone="expense">{lowCount}</Badge>}
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-(--color-text-muted)">
            <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} className="size-4" />
            Arxivdagilar ham
          </label>
        </div>

        <Card className="overflow-hidden">
          {list.loading && !list.data ? (
            <TableSkeleton rows={8} cols={7} />
          ) : list.error ? (
            <ErrorState message={list.error} onRetry={list.reload} />
          ) : items.length === 0 ? (
            <EmptyState
              title={all.length === 0 && !search ? "Ma'lumotnoma bo'sh" : 'Hech narsa topilmadi'}
              description={all.length === 0 && !search ? "«Yangi buyum» tugmasi bilan buyumlarni qo'shing: qog'oz, kartrij, kompyuter, stol…" : undefined}
              hint={search ? 'search' : undefined}
            />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th className="w-28">Kod</Th>
                  <Th>Nomi</Th>
                  <Th className="w-36" align="right">
                    Omborda
                  </Th>
                  <Th className="w-32" align="right">
                    Foydalanishda
                  </Th>
                  <Th className="w-36" align="right">
                    O&apos;rtacha narx
                  </Th>
                  <Th className="w-40" align="right">
                    Qoldiq qiymati
                  </Th>
                  {isAdmin && <Th className="w-44" align="right" />}
                </Tr>
              </THead>
              <TBody>
                {items.map((i) => (
                  <Tr key={i.id} clickable onClick={() => setEditing(i)} className={cn(!i.isActive && 'opacity-60')}>
                    <Td className="money text-xs font-semibold text-(--color-text-muted)">{i.code}</Td>
                    <Td>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-heading">{i.name}</span>
                        {i.kind === 'ASSET' && <Badge tone="brand">Asosiy vosita</Badge>}
                        {i.low && <Badge tone="expense">Kam qoldi</Badge>}
                        {!i.isActive && <Badge tone="neutral">Arxiv</Badge>}
                      </div>
                      <p className="text-xs text-(--color-text-muted)">{[i.group, i.categoryLabel].filter(Boolean).join(' · ')}</p>
                    </Td>
                    <Td align="right" money className={cn('font-semibold', i.low && 'text-(--color-expense)')}>
                      {qtyText(i.inStock)} <span className="font-normal text-(--color-text-muted)">{i.unit}</span>
                      {i.minQty != null && <p className="text-[11px] font-normal text-(--color-text-faint)">min {qtyText(i.minQty)}</p>}
                    </Td>
                    <Td align="right" money>
                      {i.kind === 'ASSET' ? (
                        <Link
                          href={`/ombor/asosiy-vositalar?itemId=${i.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-brand-700 hover:underline"
                        >
                          {i.inUse} dona
                        </Link>
                      ) : (
                        <span className="text-(--color-text-faint)">—</span>
                      )}
                    </Td>
                    <Td align="right" money>
                      {formatTiyin(i.avgPriceTiyin)}
                    </Td>
                    <Td align="right" money className="font-semibold">
                      {formatTiyin(i.stockValueTiyin)}
                    </Td>
                    {isAdmin && (
                      <Td align="right" className="whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        {/* Tez amallar: shu buyum bilan kirim yoki chiqim sahifasi ochiladi */}
                        {i.isActive && (
                          <Link href={w.keeper ? '/ombor/qabul' : `/ombor/kirim?item=${i.id}`} className="rounded-md px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50">
                            {w.keeper ? 'Qabul' : 'Kirim'}
                          </Link>
                        )}
                        {i.kind === 'TMZ' && i.inStock > 0 && (
                          <Link href={`/ombor/chiqim?item=${i.id}`} className="rounded-md px-2 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-50">
                            Berish
                          </Link>
                        )}
                        {i.kind === 'ASSET' && i.inStock > 0 && (
                          <Link href={`/ombor/asosiy-vositalar?itemId=${i.id}&status=IN_STOCK`} className="rounded-md px-2 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-50">
                            Berish
                          </Link>
                        )}
                      </Td>
                    )}
                  </Tr>
                ))}
              </TBody>
              <TFoot>
                <Tr>
                  <Td colSpan={5} className="font-semibold">
                    Jami: {items.length} ta buyum
                  </Td>
                  <Td align="right" money className="font-bold">
                    {formatTiyin(value)}
                  </Td>
                  {isAdmin && <Td />}
                </Tr>
              </TFoot>
            </Table>
          )}
        </Card>
      </div>

      <ItemForm
        open={creating || Boolean(editing)}
        item={editing}
        lookups={w.lookups}
        defaultKind={kind === 'ASSET' ? 'ASSET' : 'TMZ'}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={(message) => {
          setCreating(false);
          setEditing(null);
          w.notify(message);
          list.reload();
        }}
      />
      {w.element}
    </>
  );
}