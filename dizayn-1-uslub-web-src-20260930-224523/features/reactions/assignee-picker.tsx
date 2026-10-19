'use client';

import { useEffect, useState } from 'react';
import { reactionsApi, type EmployeeOption } from './api';

export interface PickedAssignee {
  pinfl: string;
  fullName: string;
  position: string | null;
  place?: string;
  role: string;
}

const FIELD = 'h-9 w-full rounded-[--radius-control] border border-[--color-line] bg-white px-2.5 text-sm outline-none focus:border-slate-500';

/** Mas'ul xodimlarni tanlash — Xodimlar bo'limidan qidiriladi */
export function AssigneePicker({ value, onChange }: { value: PickedAssignee[]; onChange: (next: PickedAssignee[]) => void }) {
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<EmployeeOption[]>([]);

  useEffect(() => {
    const timer = setTimeout(() => {
      reactionsApi
        .employees(search)
        .then((r) => setFound(r.data))
        .catch(() => setFound([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  return (
    <div>
      {value.length > 0 && (
        <ul className="mb-2 space-y-1.5">
          {value.map((a) => (
            <li key={a.pinfl} className="flex items-center gap-2 rounded-[--radius-control] border border-[--color-line] px-2.5 py-1.5 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{a.fullName}</span>
                <span className="block truncate text-xs text-[--color-text-muted]">{[a.position, a.place].filter(Boolean).join(' · ')}</span>
              </span>
              <select
                value={a.role}
                onChange={(e) => onChange(value.map((x) => (x.pinfl === a.pinfl ? { ...x, role: e.target.value } : x)))}
                className="h-7 rounded border border-[--color-line] bg-white px-1 text-xs"
              >
                <option>Mas&apos;ul</option>
                <option>Ijrochi</option>
                <option>Nazoratchi</option>
              </select>
              <button
                type="button"
                onClick={() => onChange(value.filter((x) => x.pinfl !== a.pinfl))}
                className="px-1 text-lg leading-none text-[--color-text-faint] hover:text-[--color-expense]"
                aria-label="Olib tashlash"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <input value={search} onChange={(e) => setSearch(e.target.value)} className={FIELD} placeholder="Ism, lavozim yoki PINFL bo'yicha qidirish…" />
      <ul className="mt-1 max-h-44 overflow-auto rounded-[--radius-control] border border-[--color-line]">
        {found
          .filter((e) => !value.some((a) => a.pinfl === e.pinfl))
          .map((e) => (
            <li key={e.pinfl}>
              <button
                type="button"
                onClick={() => onChange([...value, { pinfl: e.pinfl, fullName: e.fullName, position: e.position, place: e.place, role: value.length === 0 ? "Mas'ul" : 'Ijrochi' }])}
                className="block w-full px-2.5 py-1.5 text-left text-sm hover:bg-[--color-surface-muted]"
              >
                <span className="font-medium">{e.fullName}</span>
                <span className="ml-2 text-xs text-[--color-text-muted]">{[e.position, e.place].filter(Boolean).join(' · ')}</span>
              </button>
            </li>
          ))}
        {found.length === 0 && <li className="px-2.5 py-2 text-xs text-[--color-text-faint]">Xodim topilmadi</li>}
      </ul>
    </div>
  );
}