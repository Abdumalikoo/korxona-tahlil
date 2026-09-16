import { PrismaClient, CostBehavior, CostScope, UserRole } from '@prisma/client';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '@korxona/shared';
import bcrypt from 'bcryptjs';
import { REGIONS, DEPARTMENTS } from './regions-data';

const prisma = new PrismaClient();

const BCRYPT_ROUNDS = 12;

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'admin123';

// ═══════════════════════════════════════════

async function seedExpenseCategories(): Promise<void> {
  // Ota-kategoriyalar avval yoziladi - bolalari ularga boglanadi
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
        index: dept.index,
        order: dept.index * 10,
      },
      create: {
        code: dept.code,
        name: dept.name,
        index: dept.index,
        order: dept.index * 10,
        allocationWeight: 1,
      },
    });
  }

  console.log(`  Bo'limlar: ${DEPARTMENTS.length}`);
}

async function seedRegions(): Promise<void> {
  let districtCount = 0;

  for (const region of REGIONS) {
    await prisma.region.upsert({
      where: { code: region.code },
      update: { name: region.name },
      create: { code: region.code, name: region.name },
    });

    for (const district of region.districts) {
      // Tarkibli kalit: "33-1"
      const id = `${region.code}-${district.code}`;

      await prisma.district.upsert({
        where: { id },
        update: { name: district.name },
        create: {
          id,
          regionCode: region.code,
          code: district.code,
          name: district.name,
        },
      });

      districtCount += 1;
    }
  }

  console.log(`  Hududlar: ${REGIONS.length} viloyat, ${districtCount} tuman`);
}

async function seedAdmin(): Promise<void> {
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, BCRYPT_ROUNDS);

  const existing = await prisma.user.findUnique({
    where: { username: ADMIN_USERNAME },
  });

  if (existing) {
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
    { key: 'allocation.enabled', value: false },
    { key: 'company.name', value: 'Korxona' },
    { key: 'alerts.expenseSpikePercent', value: 30 },
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
  await seedRegions();
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
