interface ShareBarProps {
  percent: number;
  color?: string;
}

/**
 * Ulushni ko'rsatuvchi ingichka chiziq.
 * Jadvalda raqam yonida turadi - ko'z bilan solishtirish osonlashadi.
 */
export function ShareBar({ percent, color = 'var(--color-expense)' }: ShareBarProps) {
  const width = Math.min(Math.max(percent, 0), 100);

  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[--color-surface-sunken]">
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${width}%`, backgroundColor: color, opacity: 0.7 }}
      />
    </div>
  );
}
