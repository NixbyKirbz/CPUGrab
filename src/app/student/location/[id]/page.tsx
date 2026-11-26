import { Browse } from '@/components/student/browse';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Browse location={(await params).id} />;
}
