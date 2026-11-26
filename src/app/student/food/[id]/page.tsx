import { Menu } from '@/components/student/menu';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Menu food id={(await params).id} />;
}
