// ═══════════════════════════════════════════════════════════
// Yagona navigatsiya daraxti: yuqoridagi yorliqlar (1–3 qator), bosh sahifa kartalari
// va global qidiruvdagi "Sahifalar" shu yerdan olinadi.
// Yangi sahifa qo'shilsa — faqat shu faylga yoziladi.
// ═══════════════════════════════════════════════════════════

export interface NavNode {
  label: string;
  href: string;
  /** Qisqa izoh (bosh sahifa va qidiruvda) */
  description?: string;
  /** Faqat aynan shu manzilda faol (masalan, "/" yoki bo'lim bosh sahifasi) */
  exact?: boolean;
  /** Qo'shimcha manzillar ham shu bo'limga tegishli (masalan, "/munosabat/abc") */
  match?: string[];
  adminOnly?: boolean;
  children?: NavNode[];
}

export const NAV: NavNode[] = [
  { label: 'Bosh sahifa', href: '/', exact: true },
  {
    label: 'Daromad',
    href: '/daromadlar',
    description: 'Daromadlar ro\'yxati va bo\'limlari',
    children: [
      { label: 'Umumiy', href: '/daromadlar', exact: true, description: 'Doimiy va Boshqa bo\'limlar bir qarashda' },
      { label: 'Doimiy', href: '/daromadlar/doimiy', description: 'Muntazam daromadlar ro\'yxati' },
      { label: 'Boshqa', href: '/daromadlar/boshqa', description: 'Bir martalik daromadlar' },
      { label: 'Hududlar tushumi', href: '/daromadlar/hududlar', description: 'Hududlardan Excel orqali kelgan tushum' },
      { label: 'Natijalar', href: '/daromadlar/natijalar', description: 'Oylik natijalar' },
      { label: 'Tahlil', href: '/daromadlar/tahlil', description: 'Daromad dinamikasi va tarkibi' },
    ],
  },
  {
    label: 'Xarajat',
    href: '/xarajatlar',
    description: 'Xarajatlar ro\'yxati va bo\'limlari',
    children: [
      { label: 'Umumiy', href: '/xarajatlar', exact: true, description: 'Doimiy va Boshqa bo\'limlar bir qarashda' },
      { label: 'Doimiy', href: '/xarajatlar/doimiy', match: ['/xarajatlar/yangi'], description: 'Muntazam xarajatlar ro\'yxati' },
      { label: 'Boshqa', href: '/xarajatlar/boshqa', description: 'Bir martalik xarajatlar' },
      { label: 'Ish haqi', href: '/xarajatlar/ish-haqi', description: 'Ish haqi vedomostlari' },
      { label: 'Ish haqi tarkibi', href: '/xarajatlar/tarkib', description: 'Ish haqi komponentlar bo\'yicha' },
      { label: 'Mashinalar', href: '/xarajatlar/mashinalar', description: 'Yoqilg\'i, ta\'mir, probeg' },
      { label: 'Ijara', href: '/xarajatlar/ijara', description: 'Ijara shartnomalari va to\'lovlar' },
      { label: 'Tahlil', href: '/xarajatlar/tahlil', description: 'Xarajat dinamikasi va tarkibi' },
    ],
  },
  { label: 'Xodimlar', href: '/xodimlar', description: 'Xodimlar ro\'yxati va ko\'chishlar' },
  {
    label: 'Tahlil',
    href: '/tahlil/umumiy',
    match: ['/tahlil', '/solishtirma', '/modellar', '/katta-modellar', '/munosabat', '/nazorat'],
    description: 'Barcha tahlillar',
    children: [
      { label: 'Umumiy', href: '/tahlil/umumiy', description: 'Daromad va xarajat qayerdan, nimaga' },
      { label: 'Daromad tahlili', href: '/tahlil/daromad', description: 'Xizmatlar, mijozlar, hududlar' },
      { label: 'Xarajat tahlili', href: '/tahlil/xarajat', description: 'Moddalar, kontragentlar, hududlar' },
      { label: 'Solishtirma', href: '/solishtirma', description: 'Hududlar va Markaz yonma-yon' },
      { label: 'Katta modellar', href: '/katta-modellar', description: 'Prognoz, omillar, samaradorlik, risk' },
      { label: 'Modellar', href: '/modellar', description: 'Regressiya va o\'z formulalaringiz' },
      { label: 'Munosabat', href: '/munosabat', description: 'Belgilangan moddalar natijasi' },
      { label: 'Nazorat', href: '/nazorat', description: 'Oylik chegaralar va buzilishlar' },
    ],
  },
  { label: 'Hisobotlar', href: '/hisobotlar', description: 'Excel, PowerPoint, PDF va raqamlar tekshiruvi' },
  {
    label: 'Sozlamalar',
    href: '/sozlamalar/xarajat',
    match: ['/sozlamalar'],
    adminOnly: true,
    children: [
      { label: 'Xarajat moddalari', href: '/sozlamalar/xarajat' },
      { label: 'Ish haqi komponentlari', href: '/sozlamalar/komponentlar' },
      { label: 'Savat', href: '/sozlamalar/savat' },
      { label: 'Tarix', href: '/sozlamalar/tarix' },
      { label: 'Tekshiruv', href: '/sozlamalar/tekshiruv' },
      { label: 'Zaxira', href: '/sozlamalar/zaxira' },
    ],
  },
];

/** Tugun manzilga mosmi: 0 — yo'q, aks holda moslik uzunligi (uzunrog'i aniqroq) */
function score(node: NavNode, pathname: string): number {
  if (node.exact) return pathname === node.href ? node.href.length + 1000 : 0;
  let best = 0;
  for (const prefix of [node.href, ...(node.match ?? [])]) {
    if (prefix === '/') continue;
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) best = Math.max(best, prefix.length);
  }
  return best;
}

/** Joriy manzil uchun faol yo'l: [1-daraja, 2-daraja, 3-daraja] */
export function activePath(pathname: string, isAdmin: boolean): NavNode[] {
  const path: NavNode[] = [];
  let level = NAV.filter((n) => !n.adminOnly || isAdmin);
  while (level.length) {
    let best: NavNode | null = null;
    let bestScore = 0;
    for (const node of level) {
      // Tugunning o'zi yoki ichidagilardan biri mos kelsa
      const own = score(node, pathname);
      const inner = Math.max(0, ...flatten(node.children ?? []).map((c) => score(c, pathname)));
      const s = Math.max(own, inner);
      if (s > bestScore) {
        best = node;
        bestScore = s;
      }
    }
    if (!best) break;
    path.push(best);
    level = best.children ?? [];
  }
  return path;
}

export function flatten(nodes: NavNode[]): NavNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children ?? [])]);
}

/** Qidiruv uchun barcha sahifalar: "Xarajat › Ish haqi" */
export function pageIndex(isAdmin: boolean): { label: string; trail: string; href: string; description?: string }[] {
  const out: { label: string; trail: string; href: string; description?: string }[] = [];
  const walk = (nodes: NavNode[], trail: string[]) => {
    for (const n of nodes) {
      if (n.adminOnly && !isAdmin) continue;
      const t = [...trail, n.label];
      if (!(n.children?.length && n.children[0]!.href === n.href)) out.push({ label: n.label, trail: t.join(' › '), href: n.href, description: n.description });
      if (n.children) walk(n.children, t);
    }
  };
  walk(NAV, []);
  return out;
}

/** Yuqoridagi yorliqlar allaqachon ko'rsatadigan manzillar (sahifa ichidagi takror yorliqlarni yashirish uchun) */
export const NAV_HREFS = new Set(flatten(NAV).map((n) => n.href));