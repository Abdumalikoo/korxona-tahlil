'use client';

import { PageHeader } from '@/components/layout/page-header';
import { Card, CardBody } from '@/components/ui/card';
import { useAuth } from '@/lib/auth-context';
import { currentPeriod, formatPeriod } from '@/lib/format';

export default function DashboardPage() {
  const { user } = useAuth();

  return (
    <>
      <PageHeader title="Bosh sahifa" description={formatPeriod(currentPeriod())} />

      <div className="p-6">
        <Card>
          <CardBody>
            <h2 className="text-base font-semibold text-[--color-text]">
              Xush kelibsiz, {user?.fullName}
            </h2>
            <p className="mt-1 text-sm text-[--color-text-muted]">
              Chap paneldan kerakli bo&apos;limni tanlang.
            </p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
