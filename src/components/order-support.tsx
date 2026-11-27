'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '@/components/providers';
import { Busy, ErrorBox, Modal } from '@/components/ui';
import { getSupabase } from '@/lib/supabase/client';
import { rpc } from '@/services/catalog';
import type { Order } from '@/types';

export const reportCategories = {
  missing_items: 'Missing items',
  food_quality: 'Poor food quality',
  spoiled_food: 'Spoiled or unsafe food',
  packaging: 'Damaged packaging',
  late_delivery: 'Late delivery',
  not_received: 'Order not received',
  unsafe_delivery: 'Unsafe delivery situation',
  disputed_completion: 'Disputed completion',
  other: 'Other',
};
export const reportStatuses = {
  submitted: 'Submitted',
  under_review: 'Under review',
  awaiting_response: 'Awaiting response',
  resolved: 'Resolved',
  rejected: 'Rejected',
  closed: 'Closed',
};
export type OrderReport = {
  id: string;
  order_id: string;
  reporter_role: 'student' | 'seller' | 'worker';
  category: keyof typeof reportCategories;
  status: keyof typeof reportStatuses;
  description: string;
  created_at: string;
  orders?: { order_number: string; payment_status: string };
};

const ratings = {
  quality: 'Food quality',
  temperature: 'Food temperature',
  packaging: 'Packaging',
  accuracy: 'Order accuracy',
  experience: 'Pickup or delivery experience',
};

export function OrderSupport({ orderId, order }: { orderId: string; order?: Order }) {
  const { user, toast } = useSession();
  const client = useQueryClient();
  const [panel, setPanel] = useState<'report' | 'rating' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const key = ['order-reports', orderId, user?.id];
  const reviewKey = ['order-review', orderId, user?.id];
  const { data: reports = [] } = useQuery({
    queryKey: key,
    enabled: Boolean(user && panel === 'report'),
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('order_reports')
        .select('*')
        .eq('order_id', orderId)
        .eq('reporter_id', user!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as OrderReport[];
    },
  });
  const { data: review } = useQuery({
    queryKey: reviewKey,
    enabled: Boolean(user && order?.status === 'completed'),
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('order_reviews')
        .select('*')
        .eq('order_id', orderId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const open = (next: 'report' | 'rating') => {
    setError(null);
    setPanel(next);
  };
  return (
    <>
      <button className="text-button" type="button" onClick={() => open('report')}>
        Report an issue
      </button>
      {order?.status === 'completed' &&
        order.payment_status === 'paid' &&
        order.student_id === user?.id &&
        !review && (
          <button className="text-button" type="button" onClick={() => open('rating')}>
            Rate this order
          </button>
        )}
      {review && (
        <details>
          <summary>Food quality ratings</summary>
          <ul>
            {Object.entries(ratings).map(([field, label]) => (
              <li key={field}>
                {label} · {review[field]} / 5
              </li>
            ))}
          </ul>
        </details>
      )}
      {panel && (
        <Modal
          title={panel === 'report' ? 'Report an issue' : 'Rate this order'}
          onClose={() => {
            if (!busy) setPanel(null);
          }}
        >
          {panel === 'report' && reports.length > 0 && (
            <ul aria-label="Your reports">
              {reports.map((report) => (
                <li key={report.id}>
                  {reportCategories[report.category]} · {reportStatuses[report.status]}
                </li>
              ))}
            </ul>
          )}
          <form
            className="form-stack"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!user) return;
              const form = new FormData(event.currentTarget);
              setError(null);
              setBusy(true);
              try {
                if (panel === 'rating') {
                  const { error } = await getSupabase()
                    .from('order_reviews')
                    .insert({
                      order_id: orderId,
                      customer_id: user.id,
                      ...Object.fromEntries(
                        Object.keys(ratings).map((field) => [field, Number(form.get(field))]),
                      ),
                    });
                  if (error) throw error;
                  await client.invalidateQueries({ queryKey: reviewKey });
                  toast('Your rating was submitted.');
                } else {
                  const image = form.get('image');
                  if (image instanceof File && image.size > 5_242_880)
                    throw new Error('Choose an image under 5 MB.');
                  const report =
                    draft ??
                    (await rpc<string>('submit_order_report', {
                      p_order: orderId,
                      p_category: String(form.get('category')),
                      p_description: String(form.get('description')),
                    }));
                  setDraft(report);
                  if (image instanceof File && image.size) {
                    const { error } = await getSupabase()
                      .storage.from('order-report-evidence')
                      .upload(`${report}/${crypto.randomUUID()}`, image, {
                        contentType: image.type,
                      });
                    if (error)
                      throw new Error('Your report was saved. Try attaching the image again.');
                  }
                  setDraft(null);
                  await client.invalidateQueries({ queryKey: key });
                  toast('Your private report was submitted for administrator review.');
                }
                setPanel(null);
              } catch (problem) {
                setError(problem);
              } finally {
                setBusy(false);
              }
            }}
          >
            {panel === 'rating' ? (
              Object.entries(ratings).map(([field, label]) => (
                <label key={field}>
                  {label}
                  <select name={field} required defaultValue="">
                    <option value="">Choose a rating</option>
                    {[1, 2, 3, 4, 5].map((value) => (
                      <option key={value} value={value}>
                        {value} of 5
                      </option>
                    ))}
                  </select>
                </label>
              ))
            ) : (
              <>
                {!draft && (
                  <>
                    <label>
                      Issue
                      <select name="category" defaultValue="" required>
                        <option value="">Choose an issue</option>
                        {Object.entries(reportCategories).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      What happened?{' '}
                      <textarea name="description" minLength={10} maxLength={2000} required />
                    </label>
                  </>
                )}
                <label>
                  Supporting photo (optional){' '}
                  <input name="image" type="file" accept="image/jpeg,image/png,image/webp" />
                </label>
              </>
            )}
            {Boolean(error) && <ErrorBox error={error} />}
            <button className="primary-button" disabled={busy}>
              <Busy busy={busy}>
                {draft
                  ? 'Finish submission'
                  : panel === 'report'
                    ? 'Submit private report'
                    : 'Submit rating'}
              </Busy>
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
