'use client';

import {
  IconAlert,
  IconChart,
  IconDashboard,
  IconTrendUp,
  IconUsers,
  IconWallet,
} from '@/components/ui/icons';

export type AnalysisTab =
  | 'overview'
  | 'dynamics'
  | 'efficiency'
  | 'revenue'
  | 'expenses'
  | 'insights';

interface TabItem {
  key: AnalysisTab;
  label: string;
  question: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  accent: string;
  hover: string;
}

export const ANALYSIS_TABS: TabItem[] = [
  {
    key: 'overview',
    label: 'Umumiy holat',
    question: 'Korxona foydada ishlayaptimi?',
    icon: IconDashboard,
    accent: 'text-brand-700',
    hover: 'hover:border-brand-600',
  },
  {
    key: 'dynamics',
    label: 'Dinamika',
    question: 'Vaqt davomida nima bo\u2018ldi?',
    icon: IconChart,
    accent: 'text-[--color-warn]',
    hover: 'hover:border-[--color-warn]',
  },
  {
    key: 'efficiency',
    label: 'Samaradorlik',
    question: 'Qayerda qanday natija bor?',
    icon: IconUsers,
    accent: 'text-brand-700',
    hover: 'hover:border-brand-600',
  },
  {
    key: 'revenue',
    label: 'Daromad tarkibi',
    question: 'Daromad nimadan keladi?',
    icon: IconTrendUp,
    accent: 'text-[--color-income]',
    hover: 'hover:border-[--color-income]',
  },
  {
    key: 'expenses',
    label: 'Xarajat tarkibi',
    question: 'Pul qayerga ketmoqda?',
    icon: IconWallet,
    accent: 'text-[--color-expense]',
    hover: 'hover:border-[--color-expense]',
  },
  {
    key: 'insights',
    label: 'Xulosa',
    question: 'Nima o\u2018zgardi, nimaga e\u2019tibor berish kerak?',
    icon: IconAlert,
    accent: 'text-[--color-warn]',
    hover: 'hover:border-[--color-warn]',
  },
];

/**
 * Tahlil bo'limlari — ekran markazida katta kartochkalar.
 * Bittasini bosganda o'sha bo'lim to'liq ochiladi.
 */
export function AnalysisCards({ onSelect }: { onSelect: (tab: AnalysisTab) => void }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {ANALYSIS_TABS.map((tab) => {
        const Icon = tab.icon;

        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onSelect(tab.key)}
            className={`group flex flex-col items-center justify-center gap-3 rounded-[--radius-card] border border-[--color-line] bg-white px-6 py-10 text-center transition-all hover:shadow-md ${tab.hover}`}
          >
            <Icon
              className={`size-10 transition-transform group-hover:scale-110 ${tab.accent}`}
              strokeWidth={1.5}
            />

            <span className="text-lg font-semibold text-[--color-text]">{tab.label}</span>

            <span className="text-sm text-[--color-text-muted]">{tab.question}</span>
          </button>
        );
      })}
    </div>
  );
}

export function tabLabel(tab: AnalysisTab): string {
  return ANALYSIS_TABS.find((item) => item.key === tab)?.label ?? '';
}

export function tabQuestion(tab: AnalysisTab): string {
  return ANALYSIS_TABS.find((item) => item.key === tab)?.question ?? '';
}
