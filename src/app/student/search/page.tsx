import { Suspense } from 'react';
import { Browse } from '@/components/student/browse';
export default function Page() {
  return (
    <Suspense>
      <Browse search />
    </Suspense>
  );
}
