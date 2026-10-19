'use client';

import { useEffect, useRef } from 'react';

// ═══════════════════════════════════════════════════════════
// Sahifadagi forma uchun tugmalar: Ctrl+S — saqlash, Ctrl+Enter — «Saqlash va yana»
// (bo'lmasa — oddiy saqlash). Ochiq oyna (drawer, tasdiqlash) bo'lsa — u o'zi boshqaradi.
// ═══════════════════════════════════════════════════════════

export function useSaveShortcut(onSave: () => void, onSaveNext?: () => void, enabled = true) {
  const save = useRef(onSave);
  const next = useRef(onSaveNext);
  save.current = onSave;
  next.current = onSaveNext;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const isS = e.key === 's' || e.key === 'S' || e.code === 'KeyS';
      if (!isS && e.key !== 'Enter') return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      e.preventDefault();
      if (e.key === 'Enter' && next.current) next.current();
      else save.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}