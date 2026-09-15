import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '@korxona/shared';
import { CostBehavior, CostScope, PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const BCRYPT_ROUNDS = 12;

/** Boshlang'ich administrator ma'lumotlari */
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'admin123';

/**
 * Bo'limlar ro'yxati — taxminiy.
 * Korxonaning haqiqiy bo'limlari ma'lum bo'lganda o'zgartiriladi.
 *
 * allocationWeight — umumiy xarajatlarni taqsimlash og'irligi.
 * Ma'muriyat daromad keltirmaydi, shuning uchun 0.
 */
const DEPARTMENTS = [
  { code: 'BUX', name: 'Buxgalteriya xizmati', order: 10, allocationWeight: 1 },
  { code: 'SOLIQ', name: 'Soliq maslahati', order: 20, allocationWeight: 1 },
  { code: 'AUDIT', name: 'Audit va tekshiruv', order: 30, allocationWeight: 1 },
  { code: 'YURID', name: 'Yuridik xizmat', order: 40, allocationWeight: 1 },
  { code: 'ADMIN', name: "Ma'muriyat", order: 90, allocationWeight: 0 },
];

// ═══════════════════════════════════════════

async function seedExpenseCategories(): Promise<void> {
  // Ota-kategoriyalar avval yoziladi — bolalari ularga bog'lanadi
  const parents = EXPENSE_CATEGORIES.filter((node) => node.parent === null);
  const children = EXPENSE_CATEGORIES.filter((node) => node.parent !== null);

  for (const node of [...parents, ...children]) {
    const data = {
      label: node.label,
      parentCode: node.parent,
      isLeaf: node.isLeaf,
      behavior: node.behavior as CostBehavior,
      scope: node.scope as CostScope,
      keywords: node.keywords,
      model3d: node.model3d ?? null,
      order: node.order,
    };

    await prisma.category.upsert({
      where: { code: node.code },
      update: data,
      create: { code: node.code, ...data },
    });
  }

  console.log(`  Xarajat kategoriyalari: ${EXPENSE_CATEGORIES.length}`);
}

async function seedIncomeCategories(): Promise<void> {
  for (const node of INCOME_CATEGORIES) {
    await prisma.incomeCategory.upsert({
      where: { code: node.code },
      update: { label: node.label, order: node.order },
      create: { code: node.code, label: node.label, order: node.order },
    });
  }

  console.log(`  Daromad kategoriyalari: ${INCOME_CATEGORIES.length}`);
}

async function seedDepartments(): Promise<void> {
  for (const dept of DEPARTMENTS) {
    await prisma.department.upsert({
      where: { code: dept.code },
      update: {
        name: dept.name,
        order: dept.order,
        allocationWeight: dept.allocationWeight,
      },
      create: dept,
    });
  }

  console.log(`  Bo'limlar: ${DEPARTMENTS.length}`);
}

async function seedAdmin(): Promise<void> {
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, BCRYPT_ROUNDS);

  const existing = await prisma.user.findUnique({
    where: { username: ADMIN_USERNAME },
  });

  if (existing) {
    // Parolni qayta o'rnatamiz — eski SHA-256 hash bcrypt'ga almashadi
    await prisma.user.update({
      where: { username: ADMIN_USERNAME },
      data: { passwordHash, isActive: true },
    });
    console.log(`  Administrator: ${ADMIN_USERNAME} (parol yangilandi)`);
    return;
  }

  await prisma.user.create({
    data: {
      username: ADMIN_USERNAME,
      passwordHash,
      fullName: 'Administrator',
      role: UserRole.ADMIN,
    },
  });

  console.log(`  Administrator: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`);
}

async function seedSettings(): Promise<void> {
  const settings = [
    {
      key: 'allocation.enabled',
      value: false,
      comment: "Umumiy xarajatlar bo'limlarga taqsimlansinmi",
    },
    {
      key: 'company.name',
      value: 'Korxona',
      comment: 'Hisobotlarda ko\u2018rsatiladigan nom',
    },
    {
      key: 'alerts.expenseSpikePercent',
      value: 30,
      comment: 'Xarajat shu foizdan ko\u2018p oshsa ogohlantirish',
    },
  ];

  for (const setting of settings) {
    await prisma.setting.upsert({
      where: { key: setting.key },
      update: {},
      create: { key: setting.key, value: setting.value },
    });
  }

  console.log(`  Sozlamalar: ${settings.length}`);
}

// ═══════════════════════════════════════════

async function main(): Promise<void> {
  console.log('\nBoshlang\u2018ich ma\u2019lumot yuklanmoqda\n');

  await seedExpenseCategories();
  await seedIncomeCategories();
  await seedDepartments();
  await seedAdmin();
  await seedSettings();

  console.log('\nTayyor.\n');
}

main()
  .catch((error: unknown) => {
    console.error('\nXato:', error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
