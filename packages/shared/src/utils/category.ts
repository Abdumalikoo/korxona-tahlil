import { EXPENSE_CATEGORIES } from '../constants/categories';
import type { CategoryNode, CostBehavior } from '../types/category';

/** Daraxt ko'rinishida ishlatish uchun tugun */
export interface CategoryTreeNode extends CategoryNode {
  children: CategoryTreeNode[];
}

/** Tez qidirish uchun kod → tugun xaritasi */
const categoryMap = new Map<string, CategoryNode>(
  EXPENSE_CATEGORIES.map((node) => [node.code, node]),
);

/** Kod bo'yicha kategoriyani topadi */
export function findCategory(code: string): CategoryNode | undefined {
  return categoryMap.get(code);
}

/** Kategoriya nomini qaytaradi; topilmasa kodning o'zini */
export function categoryLabel(code: string): string {
  return categoryMap.get(code)?.label ?? code;
}

/** Faqat yozuv kiritish mumkin bo'lgan barg kategoriyalar */
export function getLeafCategories(): CategoryNode[] {
  return EXPENSE_CATEGORIES.filter((node) => node.isLeaf).sort((a, b) => a.order - b.order);
}

/** Ildiz (asosiy) kategoriyalar */
export function getRootCategories(): CategoryNode[] {
  return EXPENSE_CATEGORIES.filter((node) => node.parent === null).sort(
    (a, b) => a.order - b.order,
  );
}

/** Berilgan kategoriyaning bevosita bolalari */
export function getChildren(parentCode: string): CategoryNode[] {
  return EXPENSE_CATEGORIES.filter((node) => node.parent === parentCode).sort(
    (a, b) => a.order - b.order,
  );
}

/**
 * Kategoriyadan ildizgacha bo'lgan yo'l.
 * PAYROLL_BASE → [PAYROLL, PAYROLL_BASE]
 */
export function getCategoryPath(code: string): CategoryNode[] {
  const path: CategoryNode[] = [];
  let current = categoryMap.get(code);

  while (current) {
    path.unshift(current);
    current = current.parent ? categoryMap.get(current.parent) : undefined;
  }

  return path;
}

/** Yo'lni matn ko'rinishida: "Ish haqi fondi › Asosiy ish haqi" */
export function categoryBreadcrumb(code: string, separator = ' › '): string {
  return getCategoryPath(code)
    .map((node) => node.label)
    .join(separator);
}

/** Ildiz kategoriyani topadi — hisobotlarda guruhlash uchun */
export function getRootCategory(code: string): CategoryNode | undefined {
  const path = getCategoryPath(code);
  return path[0];
}

/** To'liq daraxt tuzilmasi — UI'da ko'rsatish uchun */
export function buildCategoryTree(): CategoryTreeNode[] {
  const nodes = new Map<string, CategoryTreeNode>(
    EXPENSE_CATEGORIES.map((node) => [node.code, { ...node, children: [] }]),
  );

  const roots: CategoryTreeNode[] = [];

  for (const node of nodes.values()) {
    if (node.parent === null) {
      roots.push(node);
      continue;
    }
    const parent = nodes.get(node.parent);
    if (parent) {
      parent.children.push(node);
    }
  }

  const sortRecursive = (list: CategoryTreeNode[]): CategoryTreeNode[] => {
    list.sort((a, b) => a.order - b.order);
    for (const item of list) {
      sortRecursive(item.children);
    }
    return list;
  };

  return sortRecursive(roots);
}

/** Kategoriya doimiy xarajatmi */
export function isFixedCost(code: string): boolean {
  return categoryMap.get(code)?.behavior === 'FIXED';
}

/** Xatti-harakat bo'yicha filtrlash */
export function getCategoriesByBehavior(behavior: CostBehavior): CategoryNode[] {
  return EXPENSE_CATEGORIES.filter((node) => node.isLeaf && node.behavior === behavior);
}

/** Bo'limga to'g'ridan-to'g'ri yoziladigan kategoriyalar */
export function getDepartmentCategories(): CategoryNode[] {
  return EXPENSE_CATEGORIES.filter((node) => node.isLeaf && node.scope === 'DEPARTMENT');
}

/** Umumkorxona xarajatlari — bo'limlarga taqsimlanadi */
export function getGeneralCategories(): CategoryNode[] {
  return EXPENSE_CATEGORIES.filter((node) => node.isLeaf && node.scope === 'GENERAL');
}

/** Kategoriya kodi mavjudligini tekshiradi */
export function isValidCategoryCode(code: string): boolean {
  return categoryMap.has(code);
}

/** Yozuv kiritish uchun yaroqli kodmi (faqat barglar) */
export function isWritableCategory(code: string): boolean {
  return categoryMap.get(code)?.isLeaf === true;
}
