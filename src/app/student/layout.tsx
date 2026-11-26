import { Shell } from '@/components/shell';
import { Suspense } from 'react';
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <Shell>
      <Suspense>{children}</Suspense>
    </Shell>
  );
}
