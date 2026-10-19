import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  /** O'ng tomondagi amal tugmalari */
  actions?: ReactNode;
}

/**
 * Sahifa sarlavhasi — yuqoridagi yorliqlar ostida, yengil (fonsiz):
 * sarlavha, qisqa izoh va o'ngda amal tugmalari.
 */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 px-4 pb-3 pt-5 md:px-6">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-[--color-text-muted]">{description}</p>}
      </div>

      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}