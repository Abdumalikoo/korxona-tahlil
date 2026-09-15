import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  /** O'ng tomondagi amal tugmalari */
  actions?: ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex h-14 items-center justify-between gap-4 border-b border-[--color-line] bg-white px-6">
      <div className="min-w-0">
        <h1 className="truncate text-base font-semibold text-[--color-text]">{title}</h1>
        {description && (
          <p className="truncate text-xs text-[--color-text-muted]">{description}</p>
        )}
      </div>

      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
