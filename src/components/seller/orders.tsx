'use client';
import { useStall } from './context';
import { Orders } from '@/components/orders';
import { Loading, Empty, ErrorBox } from '@/components/ui';
export function SellerOrders() {
  const { data: stall, isPending, error } = useStall();
  if (isPending) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!stall || stall.approval_status !== 'approved')
    return (
      <Empty
        title="Approval required"
        text="Your reservations become available after stall approval."
      />
    );
  return <Orders seller stall={stall.id} />;
}
