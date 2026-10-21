'use client';

import { HpRegion } from '@/features/hudud-reja/regions';
import { useParams } from 'next/navigation';

/** Hudud uchun reja — bitta hudud */
export default function HududRejaRegionPage() {
  const params = useParams<{ code: string }>();
  return <HpRegion code={Number(params.code)} />;
}