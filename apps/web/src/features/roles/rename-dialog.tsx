'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/error-message';
import { useEffect, useState, type FormEvent } from 'react';
import { rolesApi, rolesChanged, type RoleItem } from './api';

// ═══════════════════════════════════════════════════════════
// Rol nomini o'zgartirish: chap panel, rol dashbordi, foydalanuvchilar va rol egasining
// o'z ekranida shu nom ko'rinadi. Bo'sh qoldirilsa — asl nomiga qaytadi.
// ═══════════════════════════════════════════════════════════

export function RenameRoleDialog({ role, onClose, onDone }: { role: RoleItem | null; onClose: () => void; onDone?: (role: RoleItem) => void }) {
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (role) {
      setLabel(role.label);
      setError(null);
    }
  }, [role]);

  useEffect(() => {
    if (!role) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [role, saving, onClose]);

  if (!role) return null;

  const submit = async (e?: FormEvent, reset = false) => {
    e?.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const r = await rolesApi.rename(role.value, reset ? '' : label);
      rolesChanged();
      onDone?.(r.data);
      onClose();
    } catch (err) {
      setError(errorMessage(err, "Nomni o'zgartirib bo'lmadi"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/30" onClick={saving ? undefined : onClose} aria-hidden />
      <form
        role="dialog"
        aria-modal="true"
        aria-label="Rol nomini o'zgartirish"
        onSubmit={(e) => void submit(e)}
        className="relative w-full max-w-md space-y-4 rounded-(--radius-card) bg-white p-5 shadow-xl"
      >
        <div>
          <h3 className="text-base font-semibold text-heading">Rol nomini o&apos;zgartirish</h3>
          <p className="mt-0.5 text-xs text-(--color-text-muted)">
            Yangi nom chap panelda, rol dashbordida, foydalanuvchilar ro&apos;yxatida va shu rol xodimining o&apos;z ekranida ko&apos;rinadi. Huquqlar o&apos;zgarmaydi.
          </p>
        </div>
        <Input label="Rol nomi" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} autoFocus placeholder={role.defaultLabel} />
        <p className="text-xs text-(--color-text-muted)">
          Asl nomi: <b>{role.defaultLabel}</b> · bo&apos;limlar: {role.sections.join(', ')}
        </p>
        {error && <p className="rounded-(--radius-control) bg-(--color-expense-soft) px-3 py-2 text-sm text-(--color-expense)">{error}</p>}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {role.label !== role.defaultLabel && (
            <Button type="button" variant="ghost" className="mr-auto" onClick={() => void submit(undefined, true)} disabled={saving}>
              Asl nomiga qaytarish
            </Button>
          )}
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Bekor qilish
          </Button>
          <Button type="submit" loading={saving} disabled={label.trim().length < 2}>
            Saqlash
          </Button>
        </div>
      </form>
    </div>
  );
}