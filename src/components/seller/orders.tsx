'use client';
import { useState } from 'react';
import { useStall } from './context';
import { Orders } from '@/components/orders';
import { Loading, Empty, ErrorBox } from '@/components/ui';
import { Preparation } from './preparation';
export function SellerOrders() {
  const [batch, setBatch] = useState(false);
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
  return (
    <>
      <nav className="inline-actions delivery-tabs" aria-label="Order view">
        <button className="secondary-button" aria-pressed={!batch} onClick={() => setBatch(false)}>
          Individual orders
        </button>
        <button className="secondary-button" aria-pressed={batch} onClick={() => setBatch(true)}>
          Batch preparation
        </button>
      </nav>
      {batch ? <Preparation stallId={stall.id} /> : <Orders seller stall={stall.id} />}
    </>
  );
}
