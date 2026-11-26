import { Menu } from '@/components/student/menu';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Menu id={(await params).id} />;
}
