import { Suspense } from 'react';
import { Auth } from '@/components/auth';
export default async function Page({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const { role } = await searchParams;
  return (
    <Suspense>
      <Auth mode="forgot" seller={role === 'seller'} />
    </Suspense>
  );
}
