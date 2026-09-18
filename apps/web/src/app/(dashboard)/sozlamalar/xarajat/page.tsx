'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { ApiError } from '@/lib/api';
import { referencesApi, categoriesApi } from '@/features/shared/references';

import { PageHeader } from '@/components/layout/page-header';
import { Tabs } from '@/components/ui/tabs';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { BehaviorBadge, Badge } from '@/components/ui/badge';
import { Toast } from '@/components/ui/toast';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/states';
import { IconPlus, IconEdit, IconChevronDown } from '@/components/ui/icons';
import { CategoryFormDrawer } from '@/features/settings/category-form-drawer';
import { cn } from '@/lib/utils';
import type { CategoryTree, Category } from '@/lib/types';

const tabs = [
  { href: '/sozlamalar/xarajat', label: 'Xarajat' },
  { href: '/sozlamalar/savat', label: 'Savat' },
  { href: '/sozlamalar/tarix', label: 'Tarix' },
  { href: '/sozlamalar/tekshiruv', label: 'Tekshiruv' },
];

export default function ExpenseSettingsPage() {
  const { isAdmin, ready } = useAuth();
  const router = useRouter();

  const [showInactive, setShowInactive] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Category | null>(null);
  const [creatingIn, setCreatingIn] = useState<string | null | undefined>(undefined);
  const [toast, setToast] = useState<string | null>(null);

  const tree = useAsync(() => referencesApi.expenseTree(showInactive), [showInactive]);

  useEffect(() => {
    if (ready && !isAdmin) router.replace('/');
  }, [ready, isAdmin, router]);

  // Birinchi yuklanganda hamma guruhni ochamiz
  useEffect(() => {
    if (tree.data && expanded.size === 0) {
      setExpanded(new Set(tree.data.data.map((node) => node.code)));
    }
  }, [tree.data, expanded.size]);

  function toggle(code: string) {
    setExpanded((state) => {
      const next = new Set(state);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  async function handleArchive(category: Category) {
    const usage = await categoriesApi.usage(category.code);
    const message =
      usage.data.expenses > 0
        ? `"${category.label}" kategoriyasida ${usage.data.expenses} ta yozuv bor. Arxivlansa, eski yozuvlar saqlanadi, lekin yangi yozuvda tanlab bo'lmaydi. Davom etamizmi?`
        : `"${category.label}" arxivlansinmi?`;

    if (!window.confirm(message)) return;

    try {
      await categoriesApi.archive(category.code);
      setToast('Arxivlandi');
      tree.reload();
    } catch (err) {
      setToast(err instanceof ApiError ? err.message : 'Xatolik');
    }
  }

  if (!ready || !isAdmin) return <LoadingState />;

  const groups = tree.data?.data ?? [];

  return (
    <>
      <PageHeader
        title="Sozlamalar"
        description="Xarajat kategoriyalari"
        actions={
          <Button size="sm" onClick={() => setCreatingIn(null)}>
            <IconPlus className="size-4" />
            Yangi guruh
          </Button>
        }
      />

      <Tabs items={tabs} className="bg-white px-6" />

      <div className="space-y-4 p-6">
        <div className="flex items-center justify-between">
          <p className="text-sm text-[--color-text-muted]">
            Kategoriya nomini, turini va qamrovini o&rsquo;zgartirish mumkin. Kod
            o&rsquo;zgarmaydi &mdash; unga yozuvlar bog&rsquo;langan.
          </p>

          <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm text-[--color-text-muted]">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(event) => setShowInactive(event.target.checked)}
              className="size-4 rounded border-[--color-line-strong]"
            />
            Arxivlanganlar
          </label>
        </div>

        {tree.loading ? (
          <LoadingState />
        ) : tree.error ? (
          <ErrorState message={tree.error} onRetry={tree.reload} />
        ) : groups.length === 0 ? (
          <EmptyState title="Kategoriyalar yo'q" />
        ) : (
          <div className="space-y-3">
            {groups.map((group) => (
              <GroupCard
                key={group.code}
                group={group}
                open={expanded.has(group.code)}
                onToggle={() => toggle(group.code)}
                onEdit={setEditing}
                onArchive={handleArchive}
                onAddChild={() => setCreatingIn(group.code)}
              />
            ))}
          </div>
        )}
      </div>

      <CategoryFormDrawer
        category={editing}
        parentCode={creatingIn}
        groups={groups}
        onClose={() => {
          setEditing(null);
          setCreatingIn(undefined);
        }}
        onSaved={(message) => {
          setToast(message);
          tree.reload();
        }}
      />

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </>
  );
}

interface GroupCardProps {
  group: CategoryTree;
  open: boolean;
  onToggle: () => void;
  onEdit: (category: Category) => void;
  onArchive: (category: Category) => void;
  onAddChild: () => void;
}

function GroupCard({ group, open, onToggle, onEdit, onArchive, onAddChild }: GroupCardProps) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-[--color-line] px-4 py-3">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <IconChevronDown
            className={cn(
              'size-4 shrink-0 text-[--color-text-muted] transition-transform',
              !open && '-rotate-90',
            )}
          />
          <span className="truncate text-sm font-semibold">{group.label}</span>
          <span className="shrink-0 text-xs text-[--color-text-faint]">
            {group.children.length} ta
          </span>
          {!group.isActive && <Badge tone="neutral">Arxiv</Badge>}
        </button>

        <Button variant="ghost" size="sm" onClick={onAddChild}>
          <IconPlus className="size-4" />
          Modda
        </Button>

        <Button variant="ghost" size="sm" onClick={() => onEdit(group)}>
          <IconEdit className="size-4" />
        </Button>
      </div>

      {open && (
        <div className="divide-y divide-[--color-line]">
          {group.children.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-[--color-text-muted]">
              Bu guruhda modda yo&rsquo;q
            </p>
          ) : (
            group.children.map((item) => (
              <div
                key={item.code}
                className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[--color-surface-muted]"
              >
                <span className="min-w-0 flex-1 truncate text-sm">{item.label}</span>

                {!item.isActive && <Badge tone="neutral">Arxiv</Badge>}

                <BehaviorBadge behavior={item.behavior} />

                <span className="w-28 shrink-0 text-xs text-[--color-text-muted]">
                  {item.scope === 'DEPARTMENT' ? "Bo'limga" : 'Umumkorxona'}
                </span>

                <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button variant="ghost" size="sm" onClick={() => onEdit(item)}>
                    <IconEdit className="size-4" />
                  </Button>

                  {item.isActive && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onArchive(item)}
                      className="text-[--color-text-muted] hover:text-[--color-expense]"
                    >
                      Arxiv
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </Card>
  );
}
