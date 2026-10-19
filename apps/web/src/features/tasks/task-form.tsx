'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { errorMessage } from '@/lib/error-message';
import { reminderLabel, tasksApi, toLocalInput, type Task, type TaskEmployee } from './api';

const PRESETS = [72, 48, 24, 12, 6, 3, 2, 1, 0];
const DEFAULT = [24, 2];

/** Tez muddat tugmalari */
function quickDeadlines(): { label: string; value: string }[] {
  const now = new Date();
  const local = toLocalInput(now); // Toshkent
  const day = local.slice(0, 10);
  const at = (d: string, hm: string) => `${d}T${hm}`;
  const plusDays = (n: number) => toLocalInput(new Date(new Date(`${day}T12:00:00+05:00`).getTime() + n * 86_400_000)).slice(0, 10);
  // Juma (hafta oxiri)
  const dow = new Date(`${day}T12:00:00+05:00`).getUTCDay();
  const toFriday = (5 - dow + 7) % 7 || 7;
  const list = [
    { label: 'Bugun 18:00', value: at(day, '18:00') },
    { label: 'Ertaga 18:00', value: at(plusDays(1), '18:00') },
    { label: '3 kundan keyin', value: at(plusDays(3), '18:00') },
    { label: 'Juma 18:00', value: at(plusDays(toFriday), '18:00') },
    { label: '1 haftadan keyin', value: at(plusDays(7), '18:00') },
  ];
  const seen = new Set<string>();
  return list.filter((x) => x.value > local && !seen.has(x.value) && Boolean(seen.add(x.value)));
}

interface Props {
  open: boolean;
  /** Tahrirlanayotgan topshiriq (yo'q bo'lsa — yangi) */
  task: Task | null;
  botReady: boolean;
  onClose: () => void;
  onSaved: (task: Task, created: boolean) => void;
}

export function TaskForm({ open, task, botReady, onClose, onSaved }: Props) {
  const [person, setPerson] = useState<TaskEmployee | null>(null);
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<TaskEmployee[]>([]);
  const [listOpen, setListOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [deadline, setDeadline] = useState('');
  const [hours, setHours] = useState<number[]>(DEFAULT);
  const [custom, setCustom] = useState('');
  const [sendNow, setSendNow] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Ochilganda — boshlang'ich holat
  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    setCustom('');
    if (task) {
      setPerson({ pinfl: task.pinfl, fullName: task.employeeName, position: task.position, linked: task.linked });
      setSearch(task.employeeName);
      setTitle(task.title);
      setDescription(task.description ?? '');
      setDeadline(toLocalInput(task.deadline));
      setHours(task.remindHours);
      setSendNow(false);
    } else {
      setPerson(null);
      setSearch('');
      setTitle('');
      setDescription('');
      setDeadline(quickDeadlines()[1]?.value ?? '');
      setHours(DEFAULT);
      setSendNow(true);
    }
  }, [open, task]);

  // Xodim qidiruvi
  useEffect(() => {
    if (!open || !listOpen) return;
    const term = search.trim();
    const timer = window.setTimeout(() => {
      tasksApi
        .employees(term)
        .then((r) => setFound(r.data))
        .catch(() => setFound([]));
    }, 200);
    return () => window.clearTimeout(timer);
  }, [open, listOpen, search]);

  function toggleHour(h: number) {
    setHours((list) => (list.includes(h) ? list.filter((x) => x !== h) : [...list, h].sort((a, b) => b - a)));
  }

  function addCustom() {
    const n = Number(custom);
    if (!Number.isInteger(n) || n < 0 || n > 720) {
      setError("Eslatma soati 0 dan 720 gacha butun son bo'lsin");
      return;
    }
    if (!hours.includes(n)) setHours((list) => [...list, n].sort((a, b) => b - a));
    setCustom('');
  }

  async function save() {
    setError(null);
    if (!person) return setError('Xodimni tanlang');
    if (title.trim().length < 2) return setError('Topshiriq matnini yozing');
    if (!deadline) return setError('Muddatni tanlang');
    if (hours.length > 6) return setError("6 tadan ko'p eslatma bo'lmasin");
    setSaving(true);
    try {
      const input = { title: title.trim(), description: description.trim() || null, deadline, pinfl: person.pinfl, remindHours: hours };
      const res = task ? await tasksApi.update(task.id, input) : await tasksApi.create({ ...input, sendNow });
      onSaved(res.data, !task);
    } catch (e) {
      setError(errorMessage(e, "Saqlab bo'lmadi"));
    } finally {
      setSaving(false);
    }
  }

  const deadlineMs = deadline ? new Date(`${deadline}:00+05:00`).getTime() : NaN;
  const pastHours = Number.isNaN(deadlineMs) ? [] : hours.filter((h) => deadlineMs - h * 3_600_000 <= Date.now());

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={task ? 'Topshiriqni tahrirlash' : 'Yangi topshiriq'}
      description="Belgilangan soatlarda xodimga Telegram orqali avtomatik yuboriladi"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Bekor
          </Button>
          <Button data-save loading={saving} onClick={() => void save()}>
            {task ? 'Saqlash' : 'Topshiriq berish'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {/* Xodim */}
        <div className="relative">
          <label className="mb-1.5 block text-sm font-medium">Kimga</label>
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPerson(null);
              setListOpen(true);
            }}
            onFocus={() => setListOpen(true)}
            onBlur={() => window.setTimeout(() => setListOpen(false), 150)}
            placeholder="Xodim ismi, lavozimi yoki JSHSHIR"
            className="h-10 w-full rounded-(--radius-control) border border-(--color-line-strong) bg-white px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            autoComplete="off"
          />
          {listOpen && found.length > 0 && (
            <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-(--radius-control) border border-(--color-line) bg-white py-1 shadow-lg">
              {found.map((p) => (
                <li key={p.pinfl}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setPerson(p);
                      setSearch(p.fullName);
                      setListOpen(false);
                    }}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-brand-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{p.fullName}</span>
                      {p.position && <span className="block truncate text-xs text-(--color-text-muted)">{p.position}</span>}
                    </span>
                    <TgDot linked={p.linked} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {person && !person.linked && (
            <p className="mt-1.5 text-xs text-(--color-warn)">
              {person.fullName} hali Telegram botga ulanmagan — topshiriq saqlanadi, xabar u ulangandan keyin ketadi. Ro&apos;yxatdagi «Ulash» tugmasi orqali havola yuboring.
            </p>
          )}
          {person?.linked && <p className="mt-1.5 text-xs text-(--color-income)">Telegramga ulangan ✓</p>}
        </div>

        <Input label="Topshiriq" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Masalan: Oy yakuni bo'yicha ombor hisobotini topshirish" maxLength={300} />

        <div>
          <label className="mb-1.5 block text-sm font-medium">
            Izoh <span className="font-normal text-(--color-text-faint)">(ixtiyoriy)</span>
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Batafsil: nima, qayerga, qanday shaklda"
            className="w-full rounded-(--radius-control) border border-(--color-line-strong) bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
        </div>

        {/* Muddat */}
        <div>
          <label className="mb-1.5 block text-sm font-medium">Muddat (sana va soat)</label>
          <input
            type="datetime-local"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className="h-10 w-full rounded-(--radius-control) border border-(--color-line-strong) bg-white px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {quickDeadlines().map((q) => (
              <button
                key={q.label}
                type="button"
                onClick={() => setDeadline(q.value)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                  deadline === q.value ? 'border-brand-600 bg-brand-600 text-white' : 'border-(--color-line-strong) bg-white hover:border-brand-300 hover:bg-brand-50',
                )}
              >
                {q.label}
              </button>
            ))}
          </div>
        </div>

        {/* Eslatmalar */}
        <div>
          <label className="mb-1 block text-sm font-medium">Telegramga qachon eslatilsin</label>
          <p className="mb-2 text-xs text-(--color-text-muted)">Muddatdan necha soat oldin. Bir nechtasini tanlash mumkin (6 tagacha).</p>
          <div className="flex flex-wrap gap-1.5">
            {[...new Set([...PRESETS, ...hours])].sort((a, b) => b - a).map((h) => {
              const on = hours.includes(h);
              return (
                <button
                  key={h}
                  type="button"
                  onClick={() => toggleHour(h)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                    on ? 'border-brand-600 bg-brand-600 text-white' : 'border-(--color-line-strong) bg-white hover:border-brand-300 hover:bg-brand-50',
                    on && pastHours.includes(h) && 'border-amber-500 bg-amber-500',
                  )}
                  title={on && pastHours.includes(h) ? "Bu vaqt o'tib ketgan — yuborilmaydi" : undefined}
                >
                  {reminderLabel(h)}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addCustom();
                }
              }}
              placeholder="Boshqa: soat"
              inputMode="numeric"
              className="h-8 w-28 rounded-(--radius-control) border border-(--color-line-strong) px-2.5 text-xs outline-none focus:border-brand-500"
            />
            <Button variant="ghost" size="sm" type="button" onClick={addCustom} disabled={!custom}>
              Qo&apos;shish
            </Button>
          </div>
          {pastHours.length > 0 && (
            <p className="mt-1.5 text-xs text-amber-700">Sariq belgilangan eslatma vaqti o&apos;tib ketgan — u yuborilmaydi.</p>
          )}
          {hours.length === 0 && <p className="mt-1.5 text-xs text-(--color-text-muted)">Eslatma tanlanmagan — faqat topshiriq berilganda bir marta yuboriladi.</p>}
        </div>

        {!task && (
          <label className="flex cursor-pointer items-start gap-2.5 rounded-(--radius-control) border border-(--color-line) p-3 text-sm">
            <input type="checkbox" checked={sendNow} onChange={(e) => setSendNow(e.target.checked)} className="mt-0.5 size-4 accent-brand-600" />
            <span>
              <span className="font-medium">Hozir ham yuborilsin</span>
              <span className="block text-xs text-(--color-text-muted)">Topshiriq berilishi bilan xodimga darhol xabar boradi</span>
            </span>
          </label>
        )}

        {!botReady && (
          <p className="rounded-(--radius-control) bg-(--color-warn-soft) px-3 py-2 text-xs text-(--color-warn)">
            Telegram bot hali ulanmagan (Sozlamalar › Telegram). Topshiriq saqlanadi, xabarlar bot ulangandan keyin ketadi.
          </p>
        )}

        {error && <p className="rounded-(--radius-control) bg-(--color-expense-soft) px-3 py-2 text-sm text-(--color-expense)">{error}</p>}
      </div>
    </Drawer>
  );
}

/** Telegram holati belgisi */
export function TgDot({ linked }: { linked: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
        linked ? 'bg-sky-50 text-sky-700' : 'bg-(--color-surface-sunken) text-(--color-text-faint)',
      )}
      title={linked ? 'Telegramga ulangan' : 'Telegramga ulanmagan'}
    >
      <svg viewBox="0 0 24 24" className="size-3" fill="currentColor" aria-hidden>
        <path d="M21.9 4.3 18.6 20c-.2 1.1-.9 1.4-1.8.9l-5-3.7-2.4 2.3c-.3.3-.5.5-1 .5l.4-5.1 9.2-8.3c.4-.4-.1-.6-.6-.2L6 13.6l-4.9-1.5c-1.1-.3-1.1-1.1.2-1.6L20.5 3c.9-.3 1.7.2 1.4 1.3z" />
      </svg>
      {linked ? 'ulangan' : 'ulanmagan'}
    </span>
  );
}