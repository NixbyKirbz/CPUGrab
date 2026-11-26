import { OrderDetail } from '@/components/student/order-detail';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <OrderDetail id={(await params).id} />;
}
