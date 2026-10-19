'use client';

import katex from 'katex';
import 'katex/dist/katex.min.css';
import { useMemo } from 'react';
import { cn } from '@/lib/utils';

/** LaTeX → HTML (KaTeX). Xato bo'lsa formula matn sifatida ko'rsatiladi. */
function render(latex: string, display: boolean): string | null {
  try {
    return katex.renderToString(latex, {
      displayMode: display,
      throwOnError: false,
      strict: 'ignore',
      output: 'html',
    });
  } catch {
    return null;
  }
}

export function FormulaMath({
  latex,
  display = true,
  className,
}: {
  latex: string;
  display?: boolean;
  className?: string;
}) {

  const html = useMemo(() => render(latex, display), [latex, display]);

  if (!html) {
    return <code className={cn('text-sm', className)}>{latex}</code>;
  }

  return (
    <span
      className={cn(display ? 'block overflow-x-auto py-1' : 'inline', className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** Belgi: LaTeX ko'rinishida bo'lsa KaTeX, aks holda kursiv matn */
function SymbolName({ value }: { value: string }) {
  if (/[_^\\]/.test(value)) return <FormulaMath latex={value} display={false} />;
  return <span className="font-serif italic">{value}</span>;
}

/** Formula belgilari izohi */
export function FormulaSymbols({ symbols }: { symbols: Record<string, string> }) {
  const entries = Object.entries(symbols);
  if (entries.length === 0) return null;

  return (
    <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[auto_1fr]">
      {entries.map(([name, meaning]) => (
        <div key={name} className="contents">
          <dt className="whitespace-nowrap text-(--color-text)">
            <SymbolName value={name} />
          </dt>

          <dd className="text-(--color-text-muted)">— {meaning}</dd>
        </div>
      ))}
    </dl>
  );
}