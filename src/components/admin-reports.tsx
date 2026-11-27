'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { reportCategories, reportStatuses, type OrderReport } from '@/components/order-support';
import { Busy, Empty, ErrorBox, Loading, PageTitle } from '@/components/ui';
import { day, money, time } from '@/lib/format';
import { getSupabase } from '@/lib/supabase/client';
import { rpc } from '@/services/catalog';
import { orderSelect } from '@/services/orders';
import type { Order } from '@/types';

export function OrderReports() {
  const client = useQueryClient();
  const {
    data: reports,
    error,
    isPending,
  } = useQuery({
    queryKey: ['admin-order-reports'],
    queryFn: async () => {
      const result = await getSupabase()
        .from('order_reports')
        .select('*,orders(order_number,payment_status)')
        .order('created_at', { ascending: false })
        .limit(100);
      if (result.error) throw result.error;
      return result.data as OrderReport[];
    },
  });
  return (
    <>
      <PageTitle title="Order reports" />
      {isPending && <Loading />}
      {Boolean(error) && <ErrorBox error={error} />}
      {reports?.length === 0 && (
        <Empty title="No order reports" text="Submitted reports will appear here." />
      )}
      <div className="form-stack">
        {reports?.map((report) => (
          <ReportPanel
            key={report.id}
            report={report}
            refresh={() => void client.invalidateQueries()}
          />
        ))}
      </div>
    </>
  );
}

function ReportPanel({ report, refresh }: { report: OrderReport; refresh: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const {
    data,
    error: loadError,
    isFetching,
  } = useQuery({
    queryKey: ['admin-report', report.id],
    enabled: open,
    queryFn: async () => {
      const db = getSupabase();
      const bucket = db.storage.from('order-report-evidence');
      const [files, history, order, events] = await Promise.all([
        bucket.list(report.id),
        db
          .from('order_report_updates')
          .select('id,status,decision,reason,created_at')
          .eq('report_id', report.id)
          .order('created_at'),
        db.from('orders').select(orderSelect).eq('id', report.order_id).single(),
        db
          .from('order_status_history')
          .select('id,new_status,created_at,reason')
          .eq('order_id', report.order_id)
          .order('created_at'),
      ]);
      const problem = files.error || history.error || order.error || events.error;
      if (problem) throw problem;
      return {
        files: await Promise.all(
          (files.data ?? []).map(async ({ name }) => ({
            name,
            url: (await bucket.createSignedUrl(`${report.id}/${name}`, 300)).data?.signedUrl,
          })),
        ),
        history: history.data ?? [],
        events: events.data ?? [],
        order: order.data as Order,
      };
    },
  });
  return (
    <details className="panel" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        #{report.orders?.order_number} · {reportCategories[report.category]} ·{' '}
        {reportStatuses[report.status]}
      </summary>
      <p className="help-text">
        {report.reporter_role} · {day(report.created_at)} {time(report.created_at)}
      </p>
      <p>{report.description}</p>
      {isFetching && <Loading />}
      {Boolean(loadError) && <ErrorBox error={loadError} />}
      {data && (
        <>
          <p>
            {data.order.order_items
              .map((item) => `${item.quantity} × ${item.item_name_snapshot}`)
              .join(', ')}{' '}
            · {money(data.order.total_centavos)} via {data.order.payment_method}
          </p>
          <p className="help-text">
            Payment {data.order.payment_status} {data.order.payment_reference}{' '}
            {data.order.refund_reference && `· Refund ${data.order.refund_reference}`}
          </p>
          {Boolean(data.files.length) && (
            <ul aria-label="Private evidence">
              {data.files.map(({ name, url }, index) => (
                <li key={name}>
                  {url && (
                    <a href={url} target="_blank" rel="noreferrer">
                      Supporting photo {index + 1}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
          {data.order.delivery && (
            <p>
              Delivery {data.order.delivery.phase.replaceAll('_', ' ')}
              {data.order.delivery.completed_at &&
                ` · Handover verified at ${time(data.order.delivery.completed_at)}`}
            </p>
          )}
          {Boolean(data.events.length) && (
            <ul aria-label="Order timeline">
              {data.events.map((event) => (
                <li key={event.id}>
                  {day(event.created_at)} {time(event.created_at)} · {event.new_status}{' '}
                  {event.reason}
                </li>
              ))}
            </ul>
          )}
          {Boolean(data.history.length) && (
            <ul aria-label="Report decisions">
              {data.history.map((event) => (
                <li key={event.id}>
                  {day(event.created_at)} ·{' '}
                  {reportStatuses[event.status as keyof typeof reportStatuses]} · {event.reason}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {report.status !== 'closed' && (
        <form
          key={report.status}
          className="form-stack"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            setError(null);
            setBusy(true);
            try {
              await rpc('review_order_report', {
                p_report: report.id,
                p_status: form.get('status'),
                p_decision: form.get('decision'),
                p_reason: form.get('reason'),
              });
              refresh();
            } catch (problem) {
              setError(problem);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Status
            <select name="status" defaultValue={report.status}>
              {Object.entries(reportStatuses).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Decision
            <select name="decision">
              <option value="status_update">Update status</option>
              {report.orders?.payment_status === 'paid' &&
                !['resolved', 'rejected'].includes(report.status) && (
                  <option value="full_refund">Full refund to original payment method</option>
                )}
              <option value="external_follow_up">Escalated for external follow-up</option>
              <option value="no_action">No action after review</option>
            </select>
          </label>
          <label>
            Reason <textarea name="reason" required minLength={3} maxLength={1000} />
          </label>
          {Boolean(error) && <ErrorBox error={error} />}
          <button className="primary-button" disabled={busy}>
            <Busy busy={busy}>Save decision</Busy>
          </button>
        </form>
      )}
    </details>
  );
}
