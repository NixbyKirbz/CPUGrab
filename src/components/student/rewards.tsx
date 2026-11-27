'use client';
import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/components/providers';
import { ErrorBox, Loading, PageTitle } from '@/components/ui';
import { day, money } from '@/lib/format';
import { rpc } from '@/services/catalog';

type Reward = { id: string; amount_centavos: number };
type RewardSummary = {
  eligible: number;
  progress: number;
  threshold: number;
  reward_centavos: number;
  funded: boolean;
  available: Reward[];
  history: (Reward & {
    action: 'earned' | 'redeemed' | 'restored' | 'revoked';
    created_at: string;
  })[];
};
const eventLabels = {
  earned: 'Earned',
  redeemed: 'Used at checkout',
  restored: 'Restored on refund',
  revoked: 'Eligibility reversed',
};

export function useRewards(userId?: string) {
  return useQuery({
    queryKey: ['rewards', userId],
    enabled: Boolean(userId),
    queryFn: () => rpc<RewardSummary>('student_rewards', {}),
  });
}

export function StudentRewards() {
  const { user } = useSession();
  const { data, error, isPending } = useRewards(user?.id);
  return (
    <>
      <PageTitle title="CPUGrab Rewards" back="/student/profile" />
      {isPending && <Loading />}
      {Boolean(error) && <ErrorBox error={error} />}
      {data && (
        <section className="panel form-stack">
          <p>
            {data.eligible} eligible completed{' '}
            {data.eligible === 1 ? 'reservation' : 'reservations'}
          </p>
          <label>
            Progress toward a {money(data.reward_centavos)} reward
            <progress max={data.threshold} value={Math.min(data.progress, data.threshold)} />
          </label>
          <p>
            {Math.min(data.progress, data.threshold)} of {data.threshold} eligible reservations
            toward your next reward.
          </p>
          {!data.funded && (
            <p className="notice">
              Reward issuance opens when the administrator funds the promotion.
            </p>
          )}
          <h2>Available rewards</h2>
          {data.available.length ? (
            <ul>
              {data.available.map((reward) => (
                <li key={reward.id}>{money(reward.amount_centavos)} off a future reservation</li>
              ))}
            </ul>
          ) : (
            <p>You have no rewards ready to use.</p>
          )}
          <p className="help-text">
            Use one promotional discount on a reservation that costs more than the reward. Rewards
            are separate from your wallet balance. Paid, completed orders count toward rewards.
          </p>
          <h2>Reward history</h2>
          {data.history.length ? (
            <ul>
              {data.history.map((event) => (
                <li key={event.id}>
                  {day(event.created_at)} · {eventLabels[event.action]} ·{' '}
                  {money(event.amount_centavos)}
                </li>
              ))}
            </ul>
          ) : (
            <p>Your reward activity will appear here.</p>
          )}
        </section>
      )}
    </>
  );
}
