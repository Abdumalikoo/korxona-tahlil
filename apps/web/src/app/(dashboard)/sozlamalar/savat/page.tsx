'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { trashApi } from '@/features/shared/trash-api';
import { formatDate, formatDateTime } from '@/lib/format';

import { PageHeader } from '@/components/layout/page-header';
import { Tabs } from '@/components/ui/tabs';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Money } from '@/components/ui/money';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { EmptyState, LoadingState } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconTrash } from '@/components/ui/icons';

const tabs = [
  { href: '/sozlamalar/xarajat', label: 'Xarajat' },
  { href: '/sozlamalar/savat', label: 'Savat' },
  { href: '/sozlamalar/tarix', label: 'Tarix' },
];

export default function TrashPage() {
  const { isAdmin, ready } = useAuth();
  const router = useRouter();

  const [restoring, setRestoring] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [emptyOpen, setEmptyOpen] = useState(false);
  const [emptying, setEmptying] = useState(false);

  const expenses = useAsync(() => trashApi.expenses(), []);
  const incomes = useAsync(() => trashApi.incomes(), []);

  useEffect(() => {
    if (ready && !isAdmin) router.replace('/');
  }, [ready, isAdmin, router]);

  /** Savatni butunlay bosatadi */
  async function handleEmpty() {
    setEmptying(true);

    try {
      const result = await trashApi.empty();
      setToast(
        `${result.data.expenses + result.data.incomes} ta yozuv butunlay ochirildi`,
      );
      expenses.reload();
      incomes.reload();
    } catch {
      setToast('Tozalashda xatolik');
    } finally {
      setEmptying(false);
      setEmptyOpen(false);
    }
  }

  async function handleRestore(type: 'expense' | 'income', id: string) {
    setRestoring(id);

    try {
      if (type === 'expense') {
        await trashApi.restoreExpense(id);
        expenses.reload();
      } else {
        await trashApi.restoreIncome(id);
        incomes.reload();
      }
      setToast('Yozuv tiklandi');
    } catch {
      setToast('Tiklashda xatolik');
    } finally {
      setRestoring(null);
    }
  }

  if (!ready || !isAdmin) return <LoadingState />;

  const expenseRows = expenses.data?.data ?? [];
  const incomeRows = incomes.data?.data ?? [];
  const total = expenseRows.length + incomeRows.length;

  return (
    <>
      <PageHeader
        title="Sozlamalar"
        description="O'chirilgan yozuvlar 15 kun saqlanadi"
        actions={
          total > 0 && (
            <Button variant="danger" size="sm" onClick={() => setEmptyOpen(true)}>
              <IconTrash className="size-4" />
              Savatni bo&rsquo;shatish
            </Button>
          )
        }
      />

      <Tabs items={tabs} className="bg-white px-6" />

      <div className="space-y-4 p-6">
        {total === 0 && !expenses.loading && !incomes.loading ? (
          <Card>
            <EmptyState
              title="Savat bo'sh"
              description="O'chirilgan yozuvlar shu yerda ko'rinadi"
              icon={<IconTrash className="size-10" strokeWidth={1.5} />}
            />
          </Card>
        ) : (
          <>
            {/* Xarajatlar */}
            <Card className="overflow-hidden">
              <CardHeader
                title="O'chirilgan xarajatlar"
                description={`${expenseRows.length} ta yozuv`}
              />

              {expenses.loading ? (
                <LoadingState />
              ) : expenseRows.length === 0 ? (
                <EmptyState title="Yo'q" />
              ) : (
                <Table>
                  <THead>
                    <Tr>
                      <Th className="w-28">Sana</Th>
                      <Th>Kategoriya</Th>
                      <Th>Tavsif</Th>
                      <Th className="w-40">O&apos;chirilgan</Th>
                      <Th align="right" className="w-36">
                        Summa
                      </Th>
                      <Th className="w-24" />
                    </Tr>
                  </THead>

                  <TBody>
                    {expenseRows.map((item) => (
                      <Tr key={item.id}>
                        <Td className="money text-[--color-text-muted]">
                          {formatDate(item.date)}
                        </Td>

                        <Td>{item.category.label}</Td>

                        <Td className="max-w-xs truncate text-[--color-text-muted]">
                          {item.description ?? '\u2014'}
                        </Td>

                        <Td className="text-xs text-[--color-text-muted]">
                          {item.deletedAt ? formatDateTime(item.deletedAt) : '\u2014'}
                        </Td>

                        <Td money>
                          <Money tiyin={item.amountTiyin} tone="expense" />
                        </Td>

                        <Td>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void handleRestore('expense', item.id)}
                            loading={restoring === item.id}
                          >
                            Tiklash
                          </Button>
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              )}
            </Card>

            {/* Daromadlar */}
            <Card className="overflow-hidden">
              <CardHeader
                title="O'chirilgan daromadlar"
                description={`${incomeRows.length} ta yozuv`}
              />

              {incomes.loading ? (
                <LoadingState />
              ) : incomeRows.length === 0 ? (
                <EmptyState title="Yo'q" />
              ) : (
                <Table>
                  <THead>
                    <Tr>
                      <Th className="w-28">Sana</Th>
                      <Th>Xizmat turi</Th>
                      <Th>Mijoz</Th>
                      <Th className="w-40">O&apos;chirilgan</Th>
                      <Th align="right" className="w-36">
                        Summa
                      </Th>
                      <Th className="w-24" />
                    </Tr>
                  </THead>

                  <TBody>
                    {incomeRows.map((item) => (
                      <Tr key={item.id}>
                        <Td className="money text-[--color-text-muted]">
                          {formatDate(item.date)}
                        </Td>

                        <Td className="max-w-xs truncate">{item.category.label}</Td>

                        <Td className="text-[--color-text-muted]">
                          {item.clientName ?? '\u2014'}
                        </Td>

                        <Td className="text-xs text-[--color-text-muted]">
                          {item.deletedAt ? formatDateTime(item.deletedAt) : '\u2014'}
                        </Td>

                        <Td money>
                          <Money tiyin={item.amountTiyin} tone="income" />
                        </Td>

                        <Td>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void handleRestore('income', item.id)}
                            loading={restoring === item.id}
                          >
                            Tiklash
                          </Button>
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              )}
            </Card>
          </>
        )}
      </div>

      <ConfirmDialog
        open={emptyOpen}
        title="Savatni bosatish"
        message={`${total} ta yozuv butunlay ochiriladi. Bu amalni qaytarib bolmaydi.`}
        confirmLabel="Bosatish"
        danger
        loading={emptying}
        onConfirm={() => void handleEmpty()}
        onCancel={() => setEmptyOpen(false)}
      />

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </>
  );
}
