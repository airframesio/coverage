'use client';

import dynamic from 'next/dynamic';

const CoverageMap = dynamic(
  () => import('@/components/map/CoverageMap'),
  { ssr: false, loading: () => <div className="h-screen w-screen bg-zinc-950" /> }
);

export default function Home() {
  return <CoverageMap />;
}
