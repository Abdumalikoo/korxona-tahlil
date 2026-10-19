'use client';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Drawer } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { PinInput, weakPinReason } from '@/features/auth/pin';
import { api, type ApiResponse } from '@/lib/api';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';
import { usersApi, type Credentials, type RoleOption, type UserEvent, type UserRow } from './api';

// ═══════════════════════════════════════════════════════════
// Foydalanuvchi oynalari:
//  • CreateUserDrawer — yangi ishchi: F.I.Sh., rol, PIN (tizim yaratadi yoki o'zingiz yozasiz)
//  • UserDrawer — kirish ma'lumotlari (ID kod, PIN), bloklash, qulfni ochish, tarix (qachon kirgani)
//  • MyPasswordDrawer — administratorning o'z paroli
//  • CredentialsCard — ID kod va PIN (PIN faqat shu yerda bir marta ko'rinadi)
// ═══════════════════════════════════════════════════════════

/** Holat: faol / bloklangan / qulflangan / yangi PIN kutilmoqda */
export function userStatus(u: UserRow): { label: string; tone: 'ok' | 'warn' | 'bad' | 'muted' }[] {
  const out: { label: string; tone: 'ok' | 'warn' | 'bad' | 'muted' }[] = [];
  if (!u.isActive) out.push({ label: 'Bloklangan', tone: 'bad' });
  else out.push({ label: 'Faol', tone: 'ok' });
  if (u.lockedUntil) out.push({ label: `Xato PIN — ${formatDateTime(u.lockedUntil).slice(-5)} gacha yopiq`, tone: 'bad' });
  else if (u.failedAttempts > 0) out.push({ label: `Xato PIN: ${u.failedAttempts}`, tone: 'warn' });
  if (u.worker && u.mustChangePin) out.push({ label: u.lastLoginAt ? "O'z PIN'ini hali o'rnatmagan" : 'Hali kirmagan', tone: 'warn' });
  return out;
}

export function StatusChips({ user }: { user: UserRow }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {userStatus(user).map((s) => (
        <span
          key={s.label}
          className={cn(
            'inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold',
            s.tone === 'ok' && 'bg-(--color-income-soft) text-(--color-income)',
            s.tone === 'warn' && 'bg-(--color-warn-soft) text-(--color-warn)',
            s.tone === 'bad' && 'bg-(--color-expense-soft) text-(--color-expense)',
            s.tone === 'muted' && 'bg-(--color-surface-sunken) text-(--color-text-muted)',
          )}
        >
          {s.label}
        </span>
      ))}
    </div>
  );
}

/** ID kod va PIN — bir marta ko'rsatiladi; nusxa olish mumkin */
export function CredentialsCard({ creds, title }: { creds: Credentials; title: string }) {
  const [copied, setCopied] = useState(false);
  const temp = creds.user.mustChangePin;
  const text = `${creds.user.fullName}\n${creds.user.roleLabel}\nID kod: ${creds.user.loginCode}\nPIN: ${creds.pin}\nKirish: kirish sahifasida «ID kod bilan» yorlig'i.${temp ? " Birinchi kirishda o'z PIN'ingizni o'rnatasiz." : ''}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="space-y-4">
      <div className="rounded-(--radius-card) border-2 border-brand-300 bg-brand-50 p-5 text-center">
        <p className="text-sm font-semibold text-heading">{title}</p>
        <p className="mt-1 text-xs text-(--color-text-muted)">
          {creds.user.fullName} · {creds.user.roleLabel}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-(--radius-control) bg-white px-3 py-3 shadow-sm">
            <p className="text-xs text-(--color-text-muted)">ID kod (login)</p>
            <p className="mt-1 font-mono text-2xl font-bold tracking-wider text-heading">{creds.user.loginCode}</p>
          </div>
          <div className="rounded-(--radius-control) bg-white px-3 py-3 shadow-sm">
            <p className="text-xs text-(--color-text-muted)">PIN (parol)</p>
            <p className="mt-1 font-mono text-2xl font-bold tracking-[0.3em] text-heading">{creds.pin}</p>
          </div>
        </div>
        <Button variant="secondary" size="sm" className="mt-4" onClick={() => void copy()}>
          {copied ? 'Nusxa olindi ✓' : 'Nusxa olish'}
        </Button>
      </div>
      <p className="rounded-(--radius-control) bg-(--color-warn-soft) px-3 py-2.5 text-sm text-heading">
        <b>PIN boshqa ko&apos;rsatilmaydi.</b> Uni xodimga shaxsan bering.{' '}
        {temp ? "U birinchi kirishda o'z PIN'ini o'rnatadi — shundan keyin bu PIN ishlamaydi." : 'Xodim shu PIN bilan ishlayveradi.'} Unutsa — «Yangi PIN berish».
      </p>
      <div className="rounded-(--radius-control) border border-(--color-line) px-3 py-2.5 text-xs text-(--color-text-muted)">
        <b className="text-heading">Qanday kiradi:</b> chiqib, kirish sahifasida <b>«ID kod bilan»</b> yorlig&apos;ini tanlaydi → ID kod <span className="font-mono">{creds.user.loginCode}</span> va PIN.
      </div>
    </div>
  );
}

/** PIN tanlovi: tizim yaratsin yoki o'zim yozaman; birinchi kirishda o'zgartirsinmi */
function PinChoice({
  manual,
  setManual,
  pin,
  setPin,
  mustChange,
  setMustChange,
  disabled,
}: {
  manual: boolean;
  setManual: (v: boolean) => void;
  pin: string;
  setPin: (v: string) => void;
  mustChange: boolean;
  setMustChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const weak = manual && pin.length === 6 ? weakPinReason(pin) : null;
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {[
          { v: false, title: 'Tizim yaratsin', hint: 'Tasodifiy 6 raqam (tavsiya)' },
          { v: true, title: "O'zim yozaman", hint: '6 raqam, oson bo‘lmasin' },
        ].map((o) => (
          <label key={String(o.v)} className={cn('flex cursor-pointer gap-2.5 rounded-(--radius-control) border p-3', manual === o.v ? 'border-brand-400 bg-brand-50' : 'border-(--color-line)')}>
            <input type="radio" checked={manual === o.v} onChange={() => setManual(o.v)} disabled={disabled} className="mt-0.5 size-4" />
            <span>
              <span className="block text-sm font-semibold text-heading">{o.title}</span>
              <span className="block text-xs text-(--color-text-muted)">{o.hint}</span>
            </span>
          </label>
        ))}
      </div>
      {manual && <PinInput label="PIN" value={pin} onChange={setPin} disabled={disabled} error={weak} />}
      <label className="flex cursor-pointer items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5 size-4" checked={mustChange} onChange={(e) => setMustChange(e.target.checked)} disabled={disabled} />
        <span>
          Birinchi kirishda o&apos;z PIN&apos;ini o&apos;rnatsin <span className="text-xs text-(--color-text-muted)">(tavsiya — PIN'ni faqat xodimning o'zi biladi)</span>
        </span>
      </label>
    </div>
  );
}

export function CreateUserDrawer({ open, roles, onClose, onCreated }: { open: boolean; roles: RoleOption[]; onClose: () => void; onCreated: () => void }) {
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState('');
  const [manual, setManual] = useState(false);
  const [pin, setPin] = useState('');
  const [mustChange, setMustChange] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creds, setCreds] = useState<Credentials | null>(null);

  useEffect(() => {
    if (!open) return;
    setFullName('');
    setRole(roles[0]?.value ?? '');
    setManual(false);
    setPin('');
    setMustChange(true);
    setError(null);
    setCreds(null);
  }, [open, roles]);

  const selected = roles.find((r) => r.value === role);

  const submit = async () => {
    setError(null);
    if (fullName.trim().length < 3) return setError("F.I.Sh.ni to'liq yozing");
    if (!role) return setError('Rolni tanlang');
    if (manual) {
      const weak = weakPinReason(pin);
      if (weak) return setError(weak);
    }
    setSaving(true);
    try {
      const r = await usersApi.create({ fullName: fullName.trim(), role, mustChange, ...(manual ? { pin } : {}) });
      setCreds(r.data);
      onCreated();
    } catch (err) {
      setError(errorMessage(err, "Qo'shib bo'lmadi"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={creds ? 'Foydalanuvchi qo‘shildi' : 'Yangi foydalanuvchi'}
      description={creds ? undefined : 'ID kod (login) tizim tomonidan beriladi — keyin o‘zgartirish mumkin. Xodim faqat rolga ochiq bo‘limni ko‘radi.'}
      footer={
        creds ? (
          <Button onClick={onClose}>Tayyor</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              Bekor qilish
            </Button>
            <Button onClick={() => void submit()} loading={saving}>
              Qo&apos;shish
            </Button>
          </>
        )
      }
    >
      {creds ? (
        <CredentialsCard creds={creds} title="Kirish ma'lumotlari" />
      ) : (
        <div className="space-y-4">
          <Input label="F.I.Sh." value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Rahimov Bekzod Akmal o'g'li" autoFocus required disabled={saving} />
          <Select label="Rol" value={role} onChange={(e) => setRole(e.target.value)} disabled={saving} options={roles.map((r) => ({ value: r.value, label: r.label }))} />
          {selected && (
            <div className="rounded-(--radius-control) bg-(--color-surface-muted) px-3 py-2.5 text-sm">
              <p className="font-semibold text-heading">Ochiq bo&apos;limlar: {selected.sections.join(', ')}</p>
              <p className="mt-0.5 text-xs text-(--color-text-muted)">
                {selected.description}. Boshqa bo&apos;limlar unga ko&apos;rinmaydi. ID kod: <span className="font-mono">{selected.codePrefix}-</span> bilan boshlanadi.
              </p>
            </div>
          )}
          <div className="space-y-2">
            <p className="text-sm font-medium text-(--color-text)">PIN (parol)</p>
            <PinChoice manual={manual} setManual={setManual} pin={pin} setPin={setPin} mustChange={mustChange} setMustChange={setMustChange} disabled={saving} />
          </div>
          {error && <p className="rounded-(--radius-control) bg-(--color-expense-soft) px-3 py-2 text-sm text-(--color-expense)">{error}</p>}
        </div>
      )}
    </Drawer>
  );
}

type Pending = 'reset' | 'block' | 'unblock' | 'unlock' | 'code' | null;

/** Tarix qatorining belgisi: kirish, xato, admin amali */
function eventTone(e: UserEvent): string {
  if (/xato PIN|yopildi|bloklandi/.test(e.summary)) return 'bg-(--color-expense)';
  if (/tizimga kirdi/.test(e.summary)) return 'bg-(--color-income)';
  return 'bg-brand-400';
}

export function UserDrawer({ user, onClose, onChanged }: { user: UserRow | null; onClose: () => void; onChanged: (message: string) => void }) {
  const [current, setCurrent] = useState<UserRow | null>(user);
  const [fullName, setFullName] = useState('');
  const [code, setCode] = useState('');
  const [manual, setManual] = useState(false);
  const [pin, setPin] = useState('');
  const [mustChange, setMustChange] = useState(true);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creds, setCreds] = useState<Credentials | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [history, setHistory] = useState<UserEvent[] | null>(null);
  const [historyTick, setHistoryTick] = useState(0);

  useEffect(() => {
    setCurrent(user);
    setFullName(user?.fullName ?? '');
    setCode(user?.loginCode ?? '');
    setManual(false);
    setPin('');
    setMustChange(true);
    setPending(null);
    setError(null);
    setCreds(null);
    setResetOpen(false);
    setHistory(null);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    usersApi
      .history(user.id)
      .then((r) => alive && setHistory(r.data))
      .catch(() => alive && setHistory([]));
    return () => {
      alive = false;
    };
  }, [user, historyTick]);

  if (!user || !current) return null;

  const run = async (action: Exclude<Pending, null> | 'rename') => {
    setBusy(true);
    setError(null);
    try {
      if (action === 'rename') {
        const r = await usersApi.update(current.id, { fullName: fullName.trim() });
        setCurrent(r.data);
        onChanged('Saqlandi');
      } else if (action === 'code') {
        const r = await usersApi.update(current.id, { loginCode: code.trim() });
        setCurrent(r.data);
        setCode(r.data.loginCode ?? '');
        onChanged(`ID kod: ${r.data.loginCode}`);
      } else if (action === 'reset') {
        const r = await usersApi.resetPin(current.id, manual ? pin : undefined, mustChange);
        setCurrent(r.data.user);
        setCreds(r.data);
        setResetOpen(false);
        onChanged(`${current.loginCode}: yangi PIN berildi`);
      } else if (action === 'block' || action === 'unblock') {
        const r = await usersApi.update(current.id, { isActive: action === 'unblock' });
        setCurrent(r.data);
        onChanged(`${current.loginCode}: ${action === 'block' ? 'bloklandi' : 'blokdan chiqarildi'}`);
      } else {
        const r = await usersApi.unlock(current.id);
        setCurrent(r.data);
        onChanged(`${current.loginCode}: qulf ochildi`);
      }
      setHistoryTick((t) => t + 1);
    } catch (err) {
      setError(errorMessage(err, "Bajarib bo'lmadi"));
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const renamed = fullName.trim() !== current.fullName && fullName.trim().length >= 3;
  const codeChanged = code.trim().toUpperCase() !== (current.loginCode ?? '') && /^[A-Za-z]{2,4}-?\d{1,6}$/.test(code.trim());
  const pinWeak = manual ? weakPinReason(pin) : null;
  const logins = (history ?? []).filter((h) => /tizimga kirdi/.test(h.summary)).length;

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        width="lg"
        title={`${current.loginCode} · ${current.fullName}`}
        description={`${current.roleLabel} · ochiq bo'limlar: ${(current.sections ?? []).join(', ')}`}
        footer={
          <Button variant="secondary" onClick={onClose}>
            Yopish
          </Button>
        }
      >
        {creds ? (
          <div className="space-y-4">
            <CredentialsCard creds={creds} title="Yangi PIN" />
            <Button variant="secondary" onClick={() => setCreds(null)}>
              ← Foydalanuvchiga qaytish
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Holat */}
            <div className="grid gap-3 rounded-(--radius-control) bg-(--color-surface-muted) p-3 sm:grid-cols-3">
              <div>
                <p className="text-xs text-(--color-text-muted)">Holati</p>
                <div className="mt-1">
                  <StatusChips user={current} />
                </div>
              </div>
              <div>
                <p className="text-xs text-(--color-text-muted)">Oxirgi kirish</p>
                <p className="mt-1 text-sm font-semibold text-heading">{current.lastLoginAt ? formatDateTime(current.lastLoginAt) : 'Hali kirmagan'}</p>
              </div>
              <div>
                <p className="text-xs text-(--color-text-muted)">Qo&apos;shilgan</p>
                <p className="mt-1 text-sm font-medium text-heading">{formatDateTime(current.createdAt)}</p>
              </div>
            </div>

            {/* Kirish ma'lumotlari */}
            <div className="space-y-3 rounded-(--radius-control) border border-(--color-line) p-4">
              <p className="text-sm font-semibold text-heading">Ma&apos;lumotlar va login</p>
              <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <Input label="F.I.Sh." value={fullName} onChange={(e) => setFullName(e.target.value)} disabled={busy} />
                <Button variant="secondary" onClick={() => void run('rename')} disabled={!renamed || busy}>
                  Saqlash
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <Input
                  label="ID kod (login)"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  disabled={busy}
                  className="font-mono uppercase tracking-wider"
                  hint="Masalan SK-0007. O'zgarsa — xodim yangi kod bilan qaytadan kiradi"
                />
                <Button variant="secondary" onClick={() => setPending('code')} disabled={!codeChanged || busy}>
                  Kodni o&apos;zgartirish
                </Button>
              </div>
            </div>

            {/* PIN (parol) */}
            <div className="rounded-(--radius-control) border border-(--color-line) p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-heading">PIN (parol)</p>
                  <p className="text-xs text-(--color-text-muted)">Unutgan bo&apos;lsa yoki almashtirish kerak bo&apos;lsa. Eski PIN ishlamay qoladi, ochiq oynalari yopiladi.</p>
                </div>
                {!resetOpen && (
                  <Button size="sm" variant="secondary" onClick={() => setResetOpen(true)} disabled={busy}>
                    Yangi PIN berish
                  </Button>
                )}
              </div>
              {resetOpen && (
                <div className="mt-4 space-y-3">
                  <PinChoice manual={manual} setManual={setManual} pin={pin} setPin={setPin} mustChange={mustChange} setMustChange={setMustChange} disabled={busy} />
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setResetOpen(false)} disabled={busy}>
                      Bekor qilish
                    </Button>
                    <Button size="sm" onClick={() => setPending('reset')} disabled={busy || Boolean(pinWeak) || (manual && pin.length !== 6)}>
                      Yangi PIN berish
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Qulf va bloklash */}
            <div className="flex flex-wrap items-center gap-2">
              {current.lockedUntil && (
                <Button variant="secondary" onClick={() => setPending('unlock')} disabled={busy}>
                  Qulfni ochish
                </Button>
              )}
              {current.isActive ? (
                <Button variant="ghost" className="text-(--color-expense)" onClick={() => setPending('block')} disabled={busy}>
                  Bloklash
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => setPending('unblock')} disabled={busy}>
                  Blokdan chiqarish
                </Button>
              )}
              <span className="text-xs text-(--color-text-muted)">O&apos;chirilmaydi — bloklanadi: kiritgan hujjatlari va tarix saqlanadi.</span>
            </div>

            {error && <p className="rounded-(--radius-control) bg-(--color-expense-soft) px-3 py-2 text-sm text-(--color-expense)">{error}</p>}

            {/* Tarix */}
            <div>
              <p className="mb-2 text-sm font-semibold text-heading">
                Tarix: qachon kirgan <span className="font-normal text-(--color-text-muted)">· kirishlar: {logins}</span>
              </p>
              {history === null ? (
                <p className="text-xs text-(--color-text-muted)">Yuklanmoqda…</p>
              ) : history.length === 0 ? (
                <p className="text-xs text-(--color-text-muted)">Hali hech narsa yo&apos;q.</p>
              ) : (
                <ol className="max-h-80 space-y-0 overflow-y-auto rounded-(--radius-control) border border-(--color-line)">
                  {history.map((h) => (
                    <li key={h.id} className="flex items-start gap-3 border-b border-(--color-line) px-3 py-2 text-sm last:border-b-0">
                      <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', eventTone(h))} />
                      <span className="w-32 shrink-0 text-xs text-(--color-text-muted)">{formatDateTime(h.at)}</span>
                      <span className="min-w-0 flex-1 text-heading">{h.summary.replace(/^[A-Z]{2,4}-\d+(:| \([^)]*\))\s*/, '')}</span>
                      {!h.self && <span className="shrink-0 text-xs text-(--color-text-muted)">{h.by}</span>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={pending !== null}
        danger={pending === 'block'}
        loading={busy}
        title={pending === 'reset' ? 'Yangi PIN berish' : pending === 'code' ? "ID kodni o'zgartirish" : pending === 'block' ? 'Bloklash' : pending === 'unblock' ? 'Blokdan chiqarish' : 'Qulfni ochish'}
        message={
          pending === 'reset'
            ? `${current.fullName} uchun yangi PIN beriladi. Eski PIN ishlamay qoladi, ochiq oynalari yopiladi.`
            : pending === 'code'
              ? `ID kod ${current.loginCode} → ${code.trim().toUpperCase()}. Xodim keyingi safar yangi kod bilan kiradi (PIN o'zgarmaydi), ochiq oynalari yopiladi.`
              : pending === 'block'
                ? `${current.fullName} tizimga kira olmaydi, ochiq oynalari shu zahoti yopiladi. Kiritgan hujjatlari saqlanadi.`
                : pending === 'unblock'
                  ? `${current.fullName} yana o'z ID kodi va PIN'i bilan kira oladi.`
                  : `Xato PIN tufayli yopilgan hisob hozir ochiladi.`
        }
        confirmLabel={pending === 'reset' ? 'Yangi PIN berish' : pending === 'block' ? 'Bloklash' : 'Tasdiqlash'}
        onConfirm={() => pending && void run(pending)}
        onCancel={() => setPending(null)}
      />
    </>
  );
}

/** Administratorning o'z paroli */
export function MyPasswordDrawer({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCurrent('');
    setNext('');
    setRepeat('');
    setError(null);
  }, [open]);

  const submit = async () => {
    setError(null);
    if (next.length < 8) return setError("Yangi parol kamida 8 belgi bo'lsin");
    if (next !== repeat) return setError('Yangi parol takrori mos kelmadi');
    setSaving(true);
    try {
      await api.post<ApiResponse<{ success: true }>>('/auth/change-password', { currentPassword: current, newPassword: next });
      onDone();
      onClose();
    } catch (err) {
      setError(errorMessage(err, "Parolni o'zgartirib bo'lmadi"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Mening parolim"
      description="Administrator paroli: kamida 8 belgi"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Bekor qilish
          </Button>
          <Button onClick={() => void submit()} loading={saving}>
            Saqlash
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input label="Joriy parol" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" autoFocus />
        <Input label="Yangi parol" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" hint="Kamida 8 belgi" />
        <Input label="Yangi parol (takror)" type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" error={repeat && repeat !== next ? 'Mos kelmadi' : undefined} />
        {error && <p className="rounded-(--radius-control) bg-(--color-expense-soft) px-3 py-2 text-sm text-(--color-expense)">{error}</p>}
      </div>
    </Drawer>
  );
}