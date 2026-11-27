'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useSession } from '@/components/providers';
import { Busy, ErrorBox, Loading, Modal } from '@/components/ui';
import { money } from '@/lib/format';
import { rpc } from '@/services/catalog';

const presets = [50, 100, 200, 500];
const maxCashInCentavos = 2_147_483_647;
export const walletBalanceKey = ['simulated-wallet-balance'];

export function useWalletBalance(userId?: string) {
  return useQuery({
    queryKey: [...walletBalanceKey, userId],
    queryFn: () => rpc<number>('simulated_wallet_balance', {}),
    enabled: Boolean(userId),
  });
}

export function WalletCashIn({ onClose }: { onClose: () => void }) {
  const { user, loading, role } = useSession();

  return (
    <Modal title="Cash In to Wallet" className="wallet-modal" onClose={onClose}>
      {loading ? (
        <Loading />
      ) : !user ? (
        <>
          <p>Sign in with your student account to add simulated wallet credits.</p>
          <Link className="primary-button full-width" href="/login" onClick={onClose}>
            Sign in to cash in
          </Link>
        </>
      ) : role === 'student' ? (
        <CashInForm key={user.id} userId={user.id} />
      ) : (
        <p>Wallet cash-in is available to student accounts.</p>
      )}
    </Modal>
  );
}

function CashInForm({ userId }: { userId: string }) {
  const client = useQueryClient();
  const [amount, setAmount] = useState('100');
  const [custom, setCustom] = useState(false);
  const [review, setReview] = useState<{ cents: number; key: string } | null>(null);
  const [success, setSuccess] = useState<number | null>(null);
  const balanceKey = [...walletBalanceKey, userId];
  const balance = useWalletBalance(userId);
  const cashIn = useMutation({
    mutationFn: ({ cents, key }: { cents: number; key: string }) =>
      rpc<number>('simulate_wallet_cash_in', { p_amount_centavos: cents, p_key: key }),
    onSuccess: (updatedBalance, { cents }) => {
      client.setQueryData(balanceKey, updatedBalance);
      void client.invalidateQueries({ queryKey: balanceKey });
      setSuccess(cents);
      setReview(null);
    },
  });
  const cents = Math.round(Number(amount) * 100);
  const validAmount =
    /^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(amount) && cents > 0 && cents <= maxCashInCentavos;

  return (
    <div className="wallet-content">
      {balance.data !== undefined && (
        <div className="detail-row">
          <span>Available balance</span>
          <strong>{money(balance.data)}</strong>
        </div>
      )}
      {balance.isError && <ErrorBox error={balance.error} retry={() => void balance.refetch()} />}
      <p className="notice">Prototype only. Cash-ins add simulated credits.</p>
      {success !== null ? (
        <>
          <p role="status">Cash in successful. {money(success)} added to your wallet.</p>
          <button className="primary-button full-width" onClick={() => setSuccess(null)}>
            Cash in again
          </button>
        </>
      ) : review ? (
        <>
          <div className="detail-row">
            <span>Cash-in amount</span>
            <strong>{money(review.cents)}</strong>
          </div>
          <div className="detail-row">
            <span>Payment method</span>
            <strong>GCash (simulation)</strong>
          </div>
          {cashIn.isError && <ErrorBox error={cashIn.error} />}
          <button
            className="primary-button full-width"
            disabled={cashIn.isPending}
            onClick={() => cashIn.mutate(review)}
          >
            <Busy busy={cashIn.isPending}>Confirm cash in</Busy>
          </button>
          <button
            className="secondary-button full-width"
            disabled={cashIn.isPending}
            onClick={() => {
              cashIn.reset();
              setReview(null);
            }}
          >
            Change amount
          </button>
        </>
      ) : (
        <form
          className="wallet-content"
          onSubmit={(event) => {
            event.preventDefault();
            if (validAmount) setReview({ cents, key: crypto.randomUUID() });
          }}
        >
          <fieldset>
            <legend>Select amount</legend>
            <div className="wallet-presets">
              {presets.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className="secondary-button"
                  aria-pressed={!custom && amount === String(preset)}
                  onClick={() => {
                    setAmount(String(preset));
                    setCustom(false);
                  }}
                >
                  {money(preset * 100)}
                </button>
              ))}
            </div>
          </fieldset>
          <label>
            Custom amount (₱)
            <input
              type="number"
              inputMode="decimal"
              min="0.01"
              max={maxCashInCentavos / 100}
              step="0.01"
              placeholder="Enter amount"
              value={custom ? amount : ''}
              onChange={(event) => {
                setCustom(true);
                setAmount(event.target.value);
              }}
            />
          </label>
          <button className="primary-button full-width" disabled={!validAmount || balance.isError}>
            Review cash in{validAmount && ` · ${money(cents)}`}
          </button>
        </form>
      )}
    </div>
  );
}
