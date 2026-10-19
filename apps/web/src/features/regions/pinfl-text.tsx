'use client';

import { useState } from 'react';

/** PINFL — o'qish oson (bo'shliqsiz, monoshrift) va bir bosishda nusxa olinadi */
export function PinflText({ pinfl, large }: { pinfl: string; large?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title="Nusxa olish"
      onClick={(ev) => {
        ev.stopPropagation();
        void navigator.clipboard?.writeText(pinfl).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className={`rounded-md px-1.5 py-0.5 font-mono tabular-nums hover:bg-brand-50 hover:text-brand-700 ${large ? 'text-sm text-heading' : 'text-xs text-(--color-text-muted)'}`}
    >
      {pinfl}
      {copied && <span className="ml-1.5 font-sans text-[11px] font-semibold text-emerald-600">nusxa olindi</span>}
    </button>
  );
}