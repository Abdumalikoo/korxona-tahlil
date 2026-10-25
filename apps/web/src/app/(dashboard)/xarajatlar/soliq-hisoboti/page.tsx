'use client';

import { PayrollUploadPage } from '@/features/payroll/payroll-upload-page';

/** Xarajatlar › Soliq hisoboti — JShDS hisob-kitobining 4 va 5-ilovasi to'g'ridan-to'g'ri (shu oy summalari) */
export default function TaxReportPage() {
  return <PayrollUploadPage mode="ndfl" />;
}