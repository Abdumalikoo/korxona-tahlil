import type { SVGProps } from 'react';

/**
 * Chap menyu uchun qo'shimcha ikonkalar (24×24 setka, joriy matn rangi).
 * Umumiy to'plam — components/ui/icons.tsx; bu yerda faqat menyuga kerak bo'lganlari.
 */

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, strokeWidth = 1.9, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

/** Bosh sahifa — to'rtta katak */
export function NavHome(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
    </Icon>
  );
}

/** Daromadlar — yuqoriga ko'tariluvchi chiziq */
export function NavIncome(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M15 7h6v6" />
    </Icon>
  );
}

/** Xarajatlar — hamyon */
export function NavExpense(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2" />
      <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
    </Icon>
  );
}

/** Xodimlar */
export function NavUsers(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </Icon>
  );
}

/** Tahlil — doiraviy diagramma */
export function NavPie(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M21.2 15.9A10 10 0 1 1 8 2.8" />
      <path d="M22 12A10 10 0 0 0 12 2v10z" />
    </Icon>
  );
}

/** Solishtirma — yonma-yon ustunlar */
export function NavCompare(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 21h18" />
      <rect x="5" y="10" width="4" height="8" rx="1" />
      <rect x="10" y="5" width="4" height="13" rx="1" />
      <rect x="15" y="13" width="4" height="5" rx="1" />
    </Icon>
  );
}

/** Modellar — formula (sigma) */
export function NavFormula(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M18 7V4H6l6 8-6 8h12v-3" />
    </Icon>
  );
}

/** Katta modellar — qatlamlar */
export function NavLayers(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m12 2 9 5-9 5-9-5 9-5z" />
      <path d="m3 12 9 5 9-5" />
      <path d="m3 17 9 5 9-5" />
    </Icon>
  );
}

/** Mashinalar — avtomobil */
export function NavCar(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 17h14v-4.5l-1.8-4.6A2 2 0 0 0 15.3 6.6H8.7a2 2 0 0 0-1.9 1.3L5 12.5V17z" />
      <path d="M3 12.5h18" />
      <circle cx="7.5" cy="17" r="1.8" />
      <circle cx="16.5" cy="17" r="1.8" />
    </Icon>
  );
}

/** Ombor — quti */
export function NavBox(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M21 8 12 3 3 8v8l9 5 9-5V8z" />
      <path d="m3 8 9 5 9-5" />
      <path d="M12 13v8" />
      <path d="m7.5 5.5 9 5" />
    </Icon>
  );
}

/** Manba — ma'lumotlar bazasi (silindr) */
export function NavDatabase(props: IconProps) {
  return (
    <Icon {...props}>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
      <path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
    </Icon>
  );
}

/** Munosabat — bayroqcha */
export function NavFlag(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 22V4" />
      <path d="M4 4h12l-2 4 2 4H4" />
    </Icon>
  );
}

/** Nazorat — qalqon */
export function NavShield(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </Icon>
  );
}

/** Hisobotlar — hujjat */
export function NavReport(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h8" />
      <path d="M8 17h5" />
    </Icon>
  );
}

/** Sozlamalar — tishli g'ildirak */
export function NavSettings(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  );
}

/** Logo — o'sish ustunlari doira ichida */
export function NavLogo(props: IconProps) {
  return (
    <Icon strokeWidth={2.2} {...props}>
      <path d="M7 16v-3" />
      <path d="M12 16V8" />
      <path d="M17 16v-5" />
    </Icon>
  );
}

/** Tez kiritish — chaqmoq */
export function NavBolt(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12L13 2Z" />
    </Icon>
  );
}

// ── Omborchi (ishchi rol) menyusi ──

/** Kirim — qutiga kiruvchi strelka */
export function NavIn(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3v11" />
      <path d="m7.5 9.5 4.5 4.5 4.5-4.5" />
      <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
    </Icon>
  );
}

/** Chiqim (berish) — qutidan chiquvchi strelka */
export function NavOut(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 14V3" />
      <path d="m7.5 7.5 4.5-4.5 4.5 4.5" />
      <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
    </Icon>
  );
}

/** Ko'chirish — ikki tomonga strelka */
export function NavSwap(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 8h14" />
      <path d="m14 4 4 4-4 4" />
      <path d="M20 16H6" />
      <path d="m10 12-4 4 4 4" />
    </Icon>
  );
}

/** Qaytarish — orqaga burilgan strelka */
export function NavUndo(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </Icon>
  );
}

/** Hisobdan chiqarish — savat */
export function NavBin(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" />
      <path d="M10 11v6M14 11v6" />
    </Icon>
  );
}

/** Pochta — konvert */
export function NavMail(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </Icon>
  );
}

/** Jurnal — ro'yxat */
export function NavList(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 6h12M9 12h12M9 18h12" />
      <circle cx="4.5" cy="6" r="1" />
      <circle cx="4.5" cy="12" r="1" />
      <circle cx="4.5" cy="18" r="1" />
    </Icon>
  );
}

/** Asosiy vosita — yorliq (inventar raqami) */
export function NavTag(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9z" />
      <circle cx="8" cy="8" r="1.5" />
    </Icon>
  );
}

/** Kimda nima bor — odam va kartochka */
export function NavPerson(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </Icon>
  );
}

/** Inventarizatsiya — tekshiruv varag'i */
export function NavClipboard(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4V3h6v1" />
      <path d="m9 12 2 2 4-4" />
    </Icon>
  );
}

/** Hisobot — ustunli grafik */
export function NavBars(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </Icon>
  );
}

/** Chat — suhbat pufakchasi */
export function NavChat(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4H6.5A2.5 2.5 0 0 1 4 13.5z" />
      <path d="M8 8.5h8M8 11.5h5" />
    </Icon>
  );
}