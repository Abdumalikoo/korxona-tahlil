/**
 * Xarajat kategoriyalari uchun asosiy tiplar.
 * Bu fayl butun tizimning "category" o'qini belgilaydi.
 */

/** Xarajatning hajmga nisbatan xatti-harakati */
export type CostBehavior =
  | 'FIXED' // Doimiy — hajmdan qat'i nazar o'zgarmaydi (ijara)
  | 'VARIABLE' // O'zgaruvchan — hajmga bog'liq (yoqilg'i)
  | 'MIXED'; // Aralash — doimiy qismi ham, o'zgaruvchan qismi ham bor

/** Xarajat qaysi darajaga tegishli */
export type CostScope =
  | 'DEPARTMENT' // To'g'ridan-to'g'ri bo'limga yoziladi
  | 'GENERAL'; // Umumkorxona — bo'limlarga taqsimlanadi

/** Kategoriya daraxtining bitta tuguni */
export interface CategoryNode {
  /** Bazada saqlanadigan barqaror kod — hech qachon o'zgarmaydi */
  code: string;
  /** Foydalanuvchi ko'radigan nom */
  label: string;
  /** Ota-tugun kodi; ildiz uchun null */
  parent: string | null;
  /** Faqat barg tugunlarga yozuv kiritiladi */
  isLeaf: boolean;
  behavior: CostBehavior;
  scope: CostScope;
  /** Avtomatik kategoriyalash uchun kalit so'zlar (lotin, kirill, rus) */
  keywords: string[];
  /** Kelajakda 3D maket bilan bog'lash uchun */
  model3d?: string;

  /** Ro'yxatdagi tartib */
  order: number;
}

/** Daromad manbalari uchun tur */
export interface IncomeCategoryNode {
  code: string;
  label: string;
  order: number;
}
