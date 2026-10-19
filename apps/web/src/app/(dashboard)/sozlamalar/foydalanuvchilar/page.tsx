'use client';

import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { IconPlus, IconUsers } from '@/components/ui/icons';
import { EmptyState, ErrorState, LoadingState, TableSkeleton } from '@/components/ui/states';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { Toast } from '@/components/ui/toast';
import { rolesChanged, useRoles, type RoleItem } from '@/features/roles/api';
import { RenameRoleDialog } from '@/features/roles/rename-dialog';
import { usersApi, type UserRow } from '@/features/users/api';
import { CreateUserDrawer, MyPasswordDrawer, StatusChips, UserDrawer } from '@/features/users/user-dialogs';
import { useAuth } from '@/lib/auth-context';
import { formatDateTime } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

// ═══════════════════════════════════════════════════════════
// Sozlamalar › Foydalanuvchilar (faqat administrator).
// Ishchi rollar (Omborchi …) ID kod + PIN bilan kiradi va faqat o'z bo'limini ko'radi.
// Bu yerda: qo'shish (ID kod avtomatik), PIN tiklash, bloklash, qulfni ochish.
// ═══════════════════════════════════════════════════════════

export default function UsersPage() {
  const { isAdmin, ready, user: me, enterRole } = useAuth();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<UserRow | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [myPassword, setMyPassword] = useState(false);
  const [renaming, setRenaming] = useState<RoleItem | null>(null);
  /** Rollar — nomi (administrator qo'ygani) bilan; nomini shu yerda o'zgartirish mumkin */
  const roleItems = useRoles();

  useEffect(() => {
    if (ready && !isAdmin) router.replace('/');
  }, [ready, isAdmin, router]);

  const list = useAsync(() => usersApi.list(), []);
  const roles = useAsync(() => usersApi.roles(), []);

  if (!ready || !isAdmin) return <LoadingState />;

  const users = list.data?.data ?? [];
  const roleList = roles.data?.data ?? [];
  const workers = users.filter((u) => u.worker);

  return (
    <>
      <PageHeader
        title="Foydalanuvchilar"
        description={`${users.length} ta foydalanuvchi · ${workers.length} tasi ID kod bilan kiradi`}
        actions={
          <Button onClick={() => setCreating(true)} disabled={roleList.length === 0}>
            <IconPlus className="size-4" />
            Yangi foydalanuvchi
          </Button>
        }
      />

      <div className="space-y-5 p-6">
        {/* Rollar va ularga ochiq bo'limlar */}
        <Card className="overflow-hidden">
          <CardHeader title="Rollar" description="Ishchi rol ID kod va PIN bilan kiradi; faqat o'ziga berilgan bo'limni ko'radi va to'ldiradi. Boshqa bo'limlar unga ko'rinmaydi va server ham yopadi." />
          <div className="grid gap-3 p-5 md:grid-cols-3">
            <div className="rounded-(--radius-control) border border-(--color-line) p-3">
              <p className="text-sm font-semibold text-heading">Administrator</p>
              <p className="mt-1 text-xs text-(--color-text-muted)">Login va parol. Butun dastur: ko&apos;rish va kiritish, sozlamalar, foydalanuvchilar.</p>
            </div>
            {roleList.map((r) => (
              <div key={r.value} className="rounded-(--radius-control) border border-brand-200 bg-brand-50/60 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-heading">{r.label}</p>
                  {roleItems.find((x) => x.value === r.value) && (
                    <button
                      type="button"
                      onClick={() => setRenaming(roleItems.find((x) => x.value === r.value) ?? null)}
                      className="shrink-0 text-xs font-semibold text-brand-700 hover:underline"
                    >
                      Nomini o&apos;zgartirish
                    </button>
                  )}
                </div>
                <p className="mt-0.5 text-[11px] text-(--color-text-muted)">
                  Login — ID kod: <span className="font-mono">{r.codePrefix}-0001, {r.codePrefix}-0002 …</span> (qo&apos;shganda beriladi) · parol — 6 xonali PIN
                </p>
                <p className="mt-1 text-xs text-(--color-text-muted)">{r.description}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {r.sections.map((s) => (
                    <Badge key={s} tone="brand">
                      {s}
                    </Badge>
                  ))}
                </div>
                <Button
                  size="sm"
                  className="mt-3 w-full"
                  onClick={() => {
                    const home = enterRole(r.value);
                    if (home) router.push(home);
                  }}
                  title="ID kod va PIN'siz shu rolning ish ekraniga kirish"
                >
                  {r.label} sifatida kirish →
                </Button>
              </div>
            ))}
          </div>
        </Card>

        {/* Hali ishchi yo'q — nima qilish kerakligi aniq ko'rinsin */}
        {list.data && workers.length === 0 && roleList.length > 0 && (
          <Card className="flex flex-wrap items-center justify-between gap-3 border-2 border-dashed border-brand-300 bg-brand-50/60 p-5">
            <div>
              <p className="font-semibold text-heading">Hali {roleList.map((r) => r.label.toLowerCase()).join(', ')} qo&apos;shilmagan</p>
              <p className="mt-0.5 text-sm text-(--color-text-muted)">
                «Yangi foydalanuvchi»ni bosing — ID kod (login) va PIN (parol) shu zahoti chiqadi. Xodim kirish sahifasida «ID kod bilan» yorlig&apos;idan kiradi.
              </p>
            </div>
            <Button onClick={() => setCreating(true)}>
              <IconPlus className="size-4" />
              {roleList[0]?.label ?? 'Foydalanuvchi'} qo&apos;shish
            </Button>
          </Card>
        )}

        <Card className="overflow-hidden">
          {list.loading && !list.data ? (
            <TableSkeleton rows={4} cols={5} />
          ) : list.error ? (
            <ErrorState message={list.error} onRetry={list.reload} />
          ) : users.length === 0 ? (
            <EmptyState title="Foydalanuvchi yo'q" icon={<IconUsers className="size-10" strokeWidth={1.5} />} />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>F.I.Sh.</Th>
                  <Th className="w-40">Rol</Th>
                  <Th className="w-32">Kirish</Th>
                  <Th>Holati</Th>
                  <Th className="w-44">Oxirgi kirish</Th>
                </Tr>
              </THead>
              <TBody>
                {users.map((u) => (
                  <Tr
                    key={u.id}
                    clickable={u.worker || u.id === me?.id}
                    onClick={u.worker ? () => setSelected(u) : u.id === me?.id ? () => setMyPassword(true) : undefined}
                    className={cn(!u.isActive && 'opacity-60')}
                  >
                    <Td>
                      <span className="font-medium text-heading">{u.fullName}</span>
                      {u.id === me?.id && <span className="ml-2 text-xs text-(--color-text-muted)">(siz · bosing — parolni o&apos;zgartirish)</span>}
                      {u.sections && <p className="text-xs text-(--color-text-muted)">Bo&apos;limlar: {u.sections.join(', ')}</p>}
                    </Td>
                    <Td>
                      <Badge tone={u.worker ? 'brand' : u.role === 'ADMIN' ? 'warn' : 'neutral'}>{u.roleLabel}</Badge>
                    </Td>
                    <Td>
                      {u.loginCode ? (
                        <span className="font-mono text-sm font-semibold text-heading">{u.loginCode}</span>
                      ) : (
                        <span className="text-xs text-(--color-text-muted)">login: {u.username}</span>
                      )}
                    </Td>
                    <Td>
                      <StatusChips user={u} />
                    </Td>
                    <Td className="text-(--color-text-muted)">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Hali kirmagan'}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

        <p className="text-xs text-(--color-text-muted)">
          Kirishlar, xato PIN bilan yopilishlar, PIN tiklash va bloklash —{' '}
          <Link href="/sozlamalar/tarix" className="font-medium text-brand-700 hover:underline">
            Sozlamalar › Tarix
          </Link>{' '}
          da (bo&apos;lim: Foydalanuvchilar).
        </p>
      </div>

      <CreateUserDrawer open={creating} roles={roleList} onClose={() => setCreating(false)} onCreated={list.reload} />
      <UserDrawer
        user={selected}
        onClose={() => setSelected(null)}
        onChanged={(message) => {
          setToast(message);
          list.reload();
        }}
      />
      <RenameRoleDialog
        role={renaming}
        onClose={() => setRenaming(null)}
        onDone={(role) => {
          setToast(`Rol nomi: «${role.label}»`);
          roles.reload();
          list.reload();
          rolesChanged();
        }}
      />
      <MyPasswordDrawer open={myPassword} onClose={() => setMyPassword(false)} onDone={() => setToast("Parol o'zgartirildi")} />
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </>
  );
}