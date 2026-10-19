'use client';

import { ShareBar } from '@/components/shared/share-bar';
import { IconChevronDown } from '@/components/ui/icons';
import { Money } from '@/components/ui/money';
import type { BreakdownNode } from '@/features/expenses/api';
import { formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useState } from 'react';

interface BreakdownTreeProps {
  nodes: BreakdownNode[];
  /** Tanlangan tugun — grafik shunga moslashadi */
  selectedKey?: string | null;
  onSelect?: (node: BreakdownNode | null) => void;
  color?: string;
}

/**
 * Xarajat tarkibi — ochiluvchi daraxt.
 *
 * Har qatorni bosib ichiga kirish mumkin. Tanlangan qator
 * ajralib turadi va grafik unga moslashadi.
 */
export function BreakdownTree({
  nodes,
  selectedKey,
  onSelect,
  color = 'var(--color-expense)',
}: BreakdownTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(key: string) {
    setExpanded((state) => {
      const next = new Set(state);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="divide-y divide-[--color-line]">
      {nodes.map((node) => (
        <TreeRow
          key={node.key}
          node={node}
          depth={0}
          expanded={expanded}
          onToggle={toggle}
          selectedKey={selectedKey}
          onSelect={onSelect}
          color={color}
        />
      ))}
    </div>
  );
}

function TreeRow({
  node,
  depth,
  expanded,
  onToggle,
  selectedKey,
  onSelect,
  color,
}: {
  node: BreakdownNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (key: string) => void;
  selectedKey?: string | null;
  onSelect?: (node: BreakdownNode | null) => void;
  color: string;
}) {
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.key);
  const isSelected = selectedKey === node.key;

  return (
    <>
      <div
        className={cn(
          'flex items-center gap-3 px-4 py-2.5 transition-colors',
          isSelected ? 'bg-brand-50' : 'hover:bg-[--color-surface-muted]',
          hasChildren && 'cursor-pointer',
        )}
        style={{ paddingLeft: `${16 + depth * 24}px` }}
        onClick={() => {
          if (hasChildren) onToggle(node.key);
          onSelect?.(isSelected ? null : node);
        }}
      >
        {/* Ochish belgisi */}
        <span className="flex w-4 shrink-0 justify-center">
          {hasChildren && (
            <IconChevronDown
              className={cn(
                'size-4 text-[--color-text-muted] transition-transform',
                !isOpen && '-rotate-90',
              )}
            />
          )}
        </span>

        {/* Nom */}
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-sm',
            depth === 0 && 'font-medium',
            depth > 1 && 'text-[--color-text-muted]',
          )}
        >
          {node.label}
        </span>

        {/* Yozuvlar soni */}
        <span className="money w-12 shrink-0 text-right text-xs text-[--color-text-faint]">
          {node.count}
        </span>

        {/* Ulush */}
        <span className="hidden w-32 shrink-0 sm:block">
          <ShareBar percent={node.sharePercent} color={color} />
        </span>

        <span className="money w-14 shrink-0 text-right text-xs text-[--color-text-muted]">
          {formatPercent(node.sharePercent)}
        </span>

        {/* Summa */}
        <span className="w-36 shrink-0 text-right">
          <Money
            tiyin={node.amountTiyin}
            tone="expense"
            className={cn('text-sm', depth === 0 && 'font-medium')}
          />
        </span>
      </div>

      {/* Ichki qatorlar */}
      {isOpen &&
        node.children.map((child) => (
          <TreeRow
            key={child.key}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            onToggle={onToggle}
            selectedKey={selectedKey}
            onSelect={onSelect}
            color={color}
          />
        ))}
    </>
  );
}
