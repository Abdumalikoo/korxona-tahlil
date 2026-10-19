'use client';

import { PageHeader } from '@/components/layout/page-header';
import { SearchInput } from '@/components/shared/search-input';
import { SourceActions } from '@/components/shared/source-actions';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { Select } from '@/components/ui/select';
import { SubTabs } from '@/components/ui/tabs';
import { Table, TBody, Td, TFoot, Th, THead, Tr } from '@/components/ui/table';
import { warehouseApi, type AssetStatus, type DocKind } from '@/features/warehouse/api';
import { AssetStatusBadge } from '@/features/warehouse/bits';
import { useWarehouseDialogs } from '@/features/warehouse/use-dialogs';
import { useAuth } from '@/lib/auth-context';
import { formatDate, formatTiyin } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';

// ═══════════════════════════════════════════════════════════
// Ombor › Asosiy vositalar — har biri inventar raqami bilan: hozir kimda, qayerda.
// Belgilab bir nechtasini birdan berish / ko'chirish / qaytarish / hisobdan chiqarish mumkin.
// Qatorni bosing — harakat tarixi (masalan: Strategiya → Kadrlar).
// ═══════════════════════════════════════════════════════════

type StatusTab = 'ACTIVE' | AssetStatus;

export default function WarehouseAssetsPage() {
  const { canWrite } = useAuth();
  /** Kiritish huquqi: administrator yoki Omborchi */
  const isAdmin = canWrite('/ombor');
  const params = useSearchParams();
  const initialStatus = params.get('status');
  const [status, setStatus] = useState<StatusTab>(
    initialStatus === 'IN_STOCK' || initialStatus === 'IN_USE' || initialStatus === 'WRITTEN_OFF' ? initialStatus : 'ACTIVE',
  );
  const [departmentId, setDepartmentId] = useState(params.get('departmentId') ?? '');
  const [regionCode, setRegionCode] = useState(params.get('regionCode') ?? '');
  const [itemId, setItemId] = useState(params.get('itemId') ?? '');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);

  const list = useAsync(
    () =>
      warehouseApi.assets({
        status: status === 'ACTIVE' ? undefined : status,
        departmentId: departmentId || undefined,
        regionCode: regionCode || undefined,
        itemId: itemId || undefined,
        search,
      }),
    [status, departmentId, regionCode, itemId, search],
  );
  const w = useWarehouseDialogs(() => {
    setSelected([]);
    list.reload();
  });

  const assets = useMemo(() => list.data?.data ?? [], [list.data]);
  const value = assets.reduce((s, a) => s + Number(a.priceTiyin), 0);
  const chosen = assets.filter((a) => selected.includes(a.id));
  const allIn = (st: AssetStatus) => chosen.length > 0 && chosen.every((a) => a.status === st);
  const bulk: { kind: DocKind; label: string; ok: boolean }[] = [
    { kind: 'ISSUE', label: 'Berish', ok: allIn('IN_STOCK') },
    { kind: 'TRANSFER', label: "Ko'chirish", ok: allIn('IN_USE') },
    { kind: 'RETURN', label: 'Omborga qaytarish', ok: allIn('IN_USE') },
    { kind: 'WRITE_OFF', label: 'Hisobdan chiqarish', ok: chosen.length > 0 && chosen.every((a) => a.status !== 'WRITTEN_OFF') },
  ];

  const change = (fn: () => void) => {
    fn();
    setSelected([]);
  };
  const hasFilters = Boolean(departmentId || regionCode || itemId || search);
  const selectable = assets.filter((a) => a.status !== 'WRITTEN_OFF');
  const allChecked = selectable.length > 0 && selectable.every((a) => selected.includes(a.id));

  return (
    <>
      <PageHeader title="Asosiy vositalar" description="Inventar raqami bo'yicha: hozir kimda va qayerda" />

      <div className="space-y-4 p-6">
        <SourceActions
          add={{ label: w.keeper ? 'Qabul qilish' : 'Kirim', onClick: () => w.newDoc('RECEIPT'), hint: "Yangi asosiy vositalar — kirim hujjati bilan, har donasiga inventar raqami beriladi" }}
          extra={
            isAdmin ? (
              <div className="flex flex-wrap items-center gap-2 border-l border-(--color-line) pl-3">
                <span className="text-xs text-(--color-text-muted)">{chosen.length > 0 ? `Belgilangan: ${chosen.length} ta →` : 'Belgilang, keyin:'}</span>
                {bulk.map((b) => (
                  <Button
                    key={b.kind}
                    size="sm"
                    variant={b.ok && b.kind !== 'WRITE_OFF' ? 'primary' : 'secondary'}
                    disabled={!b.ok}
                    onClick={() => w.newDoc(b.kind, chosen.map((a) => a.id))}
                    title={b.ok ? undefined : b.kind === 'ISSUE' ? 'Faqat omborda turganlarni belgilang' : b.kind === 'WRITE_OFF' ? 'Avval qatorlarni belgilang' : 'Faqat foydalanishdagilarni belgilang'}
                  >
                    {b.label}
                  </Button>
                ))}
              </div>
            ) : null
          }
        />

        <div className="flex flex-wrap items-center gap-3">
          <SubTabs<StatusTab>
            value={status}
            onChange={(v) => change(() => setStatus(v))}
            options={[
              { value: 'ACTIVE', label: 'Hammasi' },
              { value: 'IN_USE', label: 'Foydalanishda' },
              { value: 'IN_STOCK', label: 'Omborda' },
              { value: 'WRITTEN_OFF', label: 'Hisobdan chiqarilgan' },
            ]}
          />
          <SearchInput value={search} onChange={(v) => change(() => setSearch(v))} placeholder="Inventar, nomi, seriya, odam" className="w-56" />
          <div className="w-48">
            <Select
              className="h-9"
              value={departmentId}
              onChange={(e) => change(() => setDepartmentId(e.target.value))}
              options={[{ value: '', label: "Barcha bo'limlar" }, ...(w.lookups?.departments ?? []).map((d) => ({ value: d.id, label: d.name }))]}
            />
          </div>
          <div className="w-44">
            <Select
              className="h-9"
              value={regionCode}
              onChange={(e) => change(() => setRegionCode(e.target.value))}
              options={[{ value: '', label: 'Barcha hududlar' }, ...(w.lookups?.regions ?? []).map((r) => ({ value: String(r.code), label: r.name }))]}
            />
          </div>
          {hasFilters && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                change(() => {
                  setDepartmentId('');
                  setRegionCode('');
                  setItemId('');
                  setSearch('');
                })
              }
            >
              Tozalash
            </Button>
          )}
        </div>

        <Card className="overflow-hidden">
          {list.loading && !list.data ? (
            <TableSkeleton rows={8} cols={6} />
          ) : list.error ? (
            <ErrorState message={list.error} onRetry={list.reload} />
          ) : assets.length === 0 ? (
            <EmptyState
              title={hasFilters ? 'Hech narsa topilmadi' : "Asosiy vosita yo'q"}
              description={hasFilters ? undefined : "Kompyuter, printer, stol kabi buyumlar «Asosiy vosita» turi bilan ma'lumotnomaga qo'shilib, kirim qilinganda shu yerda paydo bo'ladi."}
              hint={hasFilters ? 'search' : undefined}
            />
          ) : (
            <Table>
              <THead>
                <Tr>
                  {isAdmin && (
                    <Th className="w-10">
                      <input
                        type="checkbox"
                        aria-label="Hammasini belgilash"
                        checked={allChecked}
                        onChange={() => setSelected(allChecked ? [] : selectable.map((a) => a.id))}
                        className="size-4"
                      />
                    </Th>
                  )}
                  <Th className="w-32">Inventar</Th>
                  <Th>Nomi</Th>
                  <Th className="w-36">Holati</Th>
                  <Th>Kimda / qayerda</Th>
                  <Th className="w-28">Kirim</Th>
                  <Th className="w-36" align="right">
                    Qiymati
                  </Th>
                </Tr>
              </THead>
              <TBody>
                {assets.map((a) => {
                  const on = selected.includes(a.id);
                  return (
                    <Tr key={a.id} clickable onClick={() => w.openAsset(a.id)} className={cn(on && 'bg-brand-50/60')}>
                      {isAdmin && (
                        <Td onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label={`${a.inventoryNo} belgilash`}
                            disabled={a.status === 'WRITTEN_OFF'}
                            checked={on}
                            onChange={() => setSelected((list) => (on ? list.filter((x) => x !== a.id) : [...list, a.id]))}
                            className="size-4"
                          />
                        </Td>
                      )}
                      <Td className="money text-xs font-semibold text-brand-700">{a.inventoryNo}</Td>
                      <Td>
                        <span className="font-medium text-heading">{a.name}</span>
                        <p className="text-xs text-(--color-text-muted)">{[a.group, a.serialNo ? `S/N ${a.serialNo}` : null].filter(Boolean).join(' · ')}</p>
                      </Td>
                      <Td>
                        <AssetStatusBadge status={a.status} />
                      </Td>
                      <Td className={cn(a.status === 'IN_USE' ? 'text-heading' : 'text-(--color-text-muted)')}>{a.status === 'WRITTEN_OFF' ? '—' : a.place.text}</Td>
                      <Td className="text-(--color-text-muted)">{formatDate(a.acquiredAt)}</Td>
                      <Td align="right" money>
                        {formatTiyin(a.priceTiyin)}
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
              <TFoot>
                <Tr>
                  <Td colSpan={isAdmin ? 6 : 5} className="font-semibold">
                    Jami: {assets.length} ta
                  </Td>
                  <Td align="right" money className="font-bold">
                    {formatTiyin(value)}
                  </Td>
                </Tr>
              </TFoot>
            </Table>
          )}
        </Card>
      </div>

      {w.element}
    </>
  );
}