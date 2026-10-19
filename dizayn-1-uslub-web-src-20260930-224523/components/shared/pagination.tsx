'use client';

import { Button } from '@/components/ui/button';
import { IconChevronLeft, IconChevronRight } from '@/components/ui/icons';

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  limit: number;
  onChange: (page: number) => void;
}

export function Pagination({ page, totalPages, total, limit, onChange }: PaginationProps) {
  if (totalPages <= 1) return null;

  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  return (
    <div className="flex items-center justify-between border-t border-[--color-line] px-4 py-3">
      <p className="text-sm text-[--color-text-muted]">
        <span className="money">{from}</span>–<span className="money">{to}</span> /{' '}
        <span className="money">{total}</span> ta
      </p>

      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onChange(page - 1)}
          disabled={page <= 1}
        >
          <IconChevronLeft className="size-4" />
          Oldingi
        </Button>

        <span className="px-2 text-sm text-[--color-text-muted]">
          <span className="money">{page}</span> / <span className="money">{totalPages}</span>
        </span>

        <Button
          variant="secondary"
          size="sm"
          onClick={() => onChange(page + 1)}
          disabled={page >= totalPages}
        >
          Keyingi
          <IconChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
