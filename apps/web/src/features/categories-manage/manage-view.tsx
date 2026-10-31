'use client';

import { ExpandBox } from '@/components/report/nested';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { api, type ApiResponse } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatTiyin } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useMemo, useState } from 'react';

// ═══════════════════════════════════════════════════════════
// Umumiy manba › Moddalar boshqaruvi — xarajat moddalari guruhlari, juda sodda:
//  • mavjud (ishlab turgan) guruhlar va moddalar daraxt bo'lib — har birida nechta yozuv va qancha summa;
//  • «Yangi guruh», guruh ichida «+ ichiga» (yangi bo'limcha yoki modda), «✎» — nomini o'zgartirish;
//  • «Ko'chirish» — moddani boshqa guruhga (yoki shu yerning o'zida yangi guruh ochib — bir qadamda).
// Xarajat yozuvlari o'zgarmaydi — faqat modda qaysi guruhda turishi (hamma hisobotda o'sha guruh ichida ko'rinadi).
// O'zgartirish — faqat administrator.
// ═══════════════════════════════════════════════════════════

interface Cat {
  code: string;
  label: string;
  parentCode: string | null;
  isLeaf: boolean;
  order: number;
  count: number;
  totalTiyin: string;
}

interface Node extends Cat {
  children: Node[];
  /** Ichidagi hamma yozuvlar (o'zi va bo'limchalari) */
  allCount: number;
  allTotal: bigint;
}

const manageApi = {
  list: () => api.get<ApiResponse<Cat[]>>('/categories/manage/list'),
  create: (label: string, parentCode: string | null) => api.post<ApiResponse<{ code: string }>>('/categories', { label, parentCode }),
  rename: (code: string, label: string) => api.patch<ApiResponse<unknown>>(`/categories/${encodeURIComponent(code)}`, { label }),
  move: (code: string, parentCode: string | null) => api.patch<ApiResponse<unknown>>(`/categories/${encodeURIComponent(code)}/move`, { parentCode }),
};

function buildTree(list: Cat[]): Node[] {
  const by = new Map<string, Node>(list.map((c) => [c.code, { ...c, children: [], allCount: 0, allTotal: 0n }]));
  const roots: Node[] = [];
  for (const n of by.values()) (n.parentCode && by.has(n.parentCode) ? by.get(n.parentCode)!.children : roots).push(n);
  const sum = (n: Node): void => {
    n.children.forEach(sum);
    n.allCount = n.count + n.children.reduce((s, c) => s + c.allCount, 0);
    n.allTotal = BigInt(n.totalTiyin) + n.children.reduce((s, c) => s + c.allTotal, 0n);
  };
  roots.forEach(sum);
  return roots;
}

/** Ko'chirish uchun guruhlar ro'yxati (chekinish bilan); o'zi va o'z ichidagilari — yo'q */
function groupOptions(roots: Node[], exclude: string): { code: string; label: string }[] {
  const out: { code: string; label: string }[] = [];
  const walk = (list: Node[], depth: number) => {
    for (const n of list) {
      if (n.code === exclude) continue;
      if (!n.isLeaf || (n.count === 0 && n.children.length === 0)) out.push({ code: n.code, label: `${'  '.repeat(depth)}${depth ? '└ ' : ''}${n.label}${n.isLeaf ? ' (bo‘sh — guruhga aylanadi)' : ''}` });
      walk(n.children, depth + 1);
    }
  };
  walk(roots, 0);
  return out;
}

export function ManageView() {
  const { isAdmin } = useAuth();
  const data = useAsync(() => manageApi.list().then((r) => r.data), []);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  const [newRoot, setNewRoot] = useState<string | null>(null);
  const tree = useMemo(() => (data.data ? buildTree(data.data) : []), [data.data]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      setToast({ message: ok, tone: 'success' });
      data.reload();
      return true;
    } catch (e) {
      setToast({ message: errorMessage(e, 'Saqlab bo‘lmadi'), tone: 'error' });
      return false;
    }
  };

  // Qidiruv: mos kelgan modda va uning yo'lidagi guruhlar ko'rinadi (ochiq)
  const term = q.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!term) return null;
    const keep = new Set<string>();
    const walk = (n: Node, path: string[]): boolean => {
      const hit = n.label.toLowerCase().includes(term);
      const kids = n.children.map((c) => walk(c, [...path, n.code])).some(Boolean);
      if (hit || kids) {
        keep.add(n.code);
        path.forEach((p) => keep.add(p));
      }
      return hit || kids;
    };
    tree.forEach((n) => walk(n, []));
    return keep;
  }, [term, tree]);

  if (data.loading && !data.data) return <LoadingState />;
  if (data.error) return <ErrorState message={data.error} onRetry={data.reload} />;

  const toggle = (code: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(code)) n.delete(code);
      else n.add(code);
      return n;
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Moddani qidirish…"
          className="h-10 w-72 rounded-(--radius-control) border border-(--color-line-strong) bg-white px-3 text-sm focus:border-brand-600 focus:outline-none"
        />
        <span className="text-sm text-(--color-text-muted)">
          {tree.length} ta guruh · {data.data?.filter((c) => c.isLeaf).length ?? 0} ta modda
        </span>
        {isAdmin && (
          <div className="ml-auto">
            {newRoot === null ? (
              <Button onClick={() => setNewRoot('')}>+ Yangi guruh</Button>
            ) : (
              <NameInput
                initial=""
                placeholder="Guruh nomi, masalan: Soliqlar"
                onCancel={() => setNewRoot(null)}
                onSave={async (label) => {
                  if (await run(() => manageApi.create(label, null), `«${label}» guruhi yaratildi`)) setNewRoot(null);
                }}
              />
            )}
          </div>
        )}
      </div>

      <Card className="overflow-hidden">
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 border-b border-(--color-line) bg-(--color-surface-muted) px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">
          <span>Guruh › modda</span>
          <span className="w-24 text-right">Yozuvlar</span>
          <span className="w-40 text-right">Summa, so‘m</span>
        </div>
        <ul>
          {tree
            .filter((n) => !visible || visible.has(n.code))
            .map((n) => (
              <Row key={n.code} n={n} depth={0} roots={tree} open={open} visible={visible} toggle={toggle} isAdmin={isAdmin} run={run} api={manageApi} />
            ))}
        </ul>
      </Card>
      <p className="text-xs text-(--color-text-muted)">
        Moddani boshqa guruhga ko&apos;chirsangiz, xarajat yozuvlari o&apos;zgarmaydi — faqat hisobotlarda yangi guruh ichida ko&apos;rinadi. Yozuvi bor moddani guruhga aylantirib bo&apos;lmaydi
        (avval yangi guruh oching).
      </p>
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}
    </div>
  );
}

function Row({
  n,
  depth,
  roots,
  open,
  visible,
  toggle,
  isAdmin,
  run,
  api: a,
}: {
  n: Node;
  depth: number;
  roots: Node[];
  open: Set<string>;
  visible: Set<string> | null;
  toggle: (code: string) => void;
  isAdmin: boolean;
  run: (fn: () => Promise<unknown>, ok: string) => Promise<boolean>;
  api: typeof manageApi;
}) {
  const [mode, setMode] = useState<'none' | 'rename' | 'move' | 'add' | 'newgroup'>('none');
  const group = !n.isLeaf || n.children.length > 0;
  const isOpen = visible ? true : open.has(n.code);
  const options = useMemo(() => (mode === 'move' ? groupOptions(roots, n.code) : []), [mode, roots, n.code]);
  return (
    <li className="border-b border-(--color-line) last:border-0">
      <div className={cn('grid grid-cols-[1fr_auto_auto] items-center gap-x-4 px-4 py-2', group && depth === 0 && 'bg-[#f6f8fd]')}>
        <div className="flex min-w-0 flex-wrap items-center gap-2" style={{ paddingLeft: depth * 22 }}>
          <ExpandBox open={isOpen} hidden={!group} onClick={() => toggle(n.code)} />
          {mode === 'rename' ? (
            <NameInput
              initial={n.label}
              onCancel={() => setMode('none')}
              onSave={async (label) => {
                if (await run(() => a.rename(n.code, label), `Nomi o‘zgardi: «${label}»`)) setMode('none');
              }}
            />
          ) : (
            <span className={cn('min-w-0 truncate', group ? 'font-semibold text-heading' : 'text-heading')}>{n.label}</span>
          )}
          {isAdmin && mode === 'none' && (
            <span className="flex items-center gap-1 text-xs">
              <button type="button" className="rounded px-1.5 py-0.5 text-(--color-text-muted) hover:bg-brand-50 hover:text-brand-700" onClick={() => setMode('rename')} title="Nomini o'zgartirish">
                ✎
              </button>
              <button type="button" className="rounded px-1.5 py-0.5 font-medium text-brand-700 hover:bg-brand-50" onClick={() => setMode('move')}>
                Ko&apos;chirish
              </button>
              {group && (
                <button type="button" className="rounded px-1.5 py-0.5 font-medium text-brand-700 hover:bg-brand-50" onClick={() => setMode('add')}>
                  + ichiga
                </button>
              )}
            </span>
          )}
        </div>
        <span className="w-24 text-right text-sm tabular-nums text-(--color-text-muted)">{(group ? n.allCount : n.count) || ''}</span>
        <span className={cn('w-40 text-right text-sm tabular-nums', group ? 'font-semibold text-heading' : 'text-heading')}>{(group ? n.allTotal : BigInt(n.totalTiyin)) ? formatTiyin((group ? n.allTotal : BigInt(n.totalTiyin)).toString()) : ''}</span>
      </div>

      {mode === 'move' && (
        <div className="flex flex-wrap items-center gap-2 bg-brand-50/60 px-4 py-2 text-sm" style={{ paddingLeft: 16 + depth * 22 + 24 }}>
          <span className="text-(--color-text-muted)">«{n.label}» qayerga:</span>
          <select
            defaultValue=""
            className="h-9 min-w-72 rounded-(--radius-control) border border-(--color-line-strong) bg-white px-2 font-mono text-sm"
            onChange={async (e) => {
              const v = e.target.value;
              if (v === '__new') return setMode('newgroup');
              if (v === '') return;
              const target = v === '__root' ? null : v;
              const label = target ? (roots.length ? options.find((o) => o.code === target)?.label.trim().replace(/^└ /, '') : '') : 'eng yuqori daraja';
              if (await run(() => a.move(n.code, target), `«${n.label}» → ${label}`)) setMode('none');
            }}
          >
            <option value="">— guruhni tanlang —</option>
            <option value="__new">+ Yangi guruh ochib, shunga ko‘chirish…</option>
            {n.parentCode && <option value="__root">↑ Eng yuqori daraja (alohida guruh)</option>}
            {options.map((o) => (
              <option key={o.code} value={o.code} disabled={o.code === n.parentCode}>
                {o.label}
                {o.code === n.parentCode ? ' (hozir shu yerda)' : ''}
              </option>
            ))}
          </select>
          <button type="button" className="text-xs text-(--color-text-muted) hover:text-heading" onClick={() => setMode('none')}>
            Bekor
          </button>
        </div>
      )}

      {mode === 'newgroup' && (
        <div className="flex flex-wrap items-center gap-2 bg-brand-50/60 px-4 py-2 text-sm" style={{ paddingLeft: 16 + depth * 22 + 24 }}>
          <span className="text-(--color-text-muted)">Yangi guruh (eng yuqori darajada), «{n.label}» shunga o‘tadi:</span>
          <NameInput
            initial=""
            placeholder="Masalan: Soliqlar"
            onCancel={() => setMode('none')}
            onSave={async (label) => {
              const ok = await run(async () => {
                const created = (await a.create(label, null)).data;
                await a.move(n.code, created.code);
              }, `«${label}» guruhi ochildi, «${n.label}» unga ko‘chirildi`);
              if (ok) setMode('none');
            }}
          />
        </div>
      )}

      {mode === 'add' && (
        <div className="flex flex-wrap items-center gap-2 bg-brand-50/60 px-4 py-2 text-sm" style={{ paddingLeft: 16 + depth * 22 + 24 }}>
          <span className="text-(--color-text-muted)">«{n.label}» ichiga yangi:</span>
          <NameInput
            initial=""
            placeholder="Bo'limcha yoki modda nomi"
            onCancel={() => setMode('none')}
            onSave={async (label) => {
              if (await run(() => a.create(label, n.code), `«${n.label}» ichida «${label}» yaratildi`)) setMode('none');
            }}
          />
        </div>
      )}

      {group && isOpen && n.children.length > 0 && (
        <ul>
          {n.children
            .filter((c) => !visible || visible.has(c.code))
            .map((c) => (
              <Row key={c.code} n={c} depth={depth + 1} roots={roots} open={open} visible={visible} toggle={toggle} isAdmin={isAdmin} run={run} api={a} />
            ))}
        </ul>
      )}
    </li>
  );
}

function NameInput({ initial, placeholder, onSave, onCancel }: { initial: string; placeholder?: string; onSave: (label: string) => Promise<void>; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const label = value.replace(/\s+/g, ' ').trim();
    if (!label || busy) return;
    setBusy(true);
    try {
      await onSave(label);
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="flex items-center gap-1.5">
      <input
        autoFocus
        value={value}
        maxLength={100}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit();
          if (e.key === 'Escape') onCancel();
        }}
        className="h-9 w-64 rounded-(--radius-control) border border-brand-400 bg-white px-2 text-sm focus:outline-none"
      />
      <Button size="sm" onClick={() => void submit()} loading={busy} disabled={!value.trim()}>
        Saqlash
      </Button>
      <button type="button" className="text-xs text-(--color-text-muted) hover:text-heading" onClick={onCancel}>
        Bekor
      </button>
    </span>
  );
}
