'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Busy, ErrorBox, Loading } from '@/components/ui';
import { getSupabase } from '@/lib/supabase/client';
import { rpc } from '@/services/catalog';

const labels = {
  pending: 'Pending verification',
  verified: 'Verified by administrator',
  changes_requested: 'Changes requested',
};
const categories = {
  authorization: 'Stall authorization',
  sanitary: 'Sanitary documentation',
  handling: 'Food handling documentation',
};
export const foodHandlingStandards =
  'I agree to prepare and store food cleanly, use fresh ingredients and safe temperatures, package food safely, seal delivery orders, fulfill orders accurately, provide known allergen information, and hand over orders safely.';

export function StallVerification({
  stallId,
  reviewer = false,
}: {
  stallId: string;
  reviewer?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const client = useQueryClient();
  const key = ['stall-verification', stallId];
  const {
    data,
    error: loadError,
    isFetching,
  } = useQuery({
    queryKey: key,
    enabled: open,
    queryFn: async () => {
      const db = getSupabase();
      const bucket = db.storage.from('stall-verification');
      const [result, listing] = await Promise.all([
        db.from('stall_verifications').select('*').eq('stall_id', stallId).maybeSingle(),
        bucket.list(stallId),
      ]);
      if (result.error || listing.error) throw result.error || listing.error;
      const documents = await Promise.all(
        (listing.data ?? []).map(async ({ name }) => {
          const link = await bucket.createSignedUrl(`${stallId}/${name}`, 300);
          return { name, url: link.data?.signedUrl };
        }),
      );
      return { record: result.data, documents };
    },
  });
  const status = (data?.record?.verification_status ?? 'pending') as keyof typeof labels;
  return (
    <details className="panel" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Food handling verification</summary>
      {isFetching && <Loading />}
      {Boolean(loadError) && <ErrorBox error={loadError} />}
      {data && (
        <>
          <p>
            {labels[status]}
            {data.record?.expires_on && ` · Expires ${data.record.expires_on}`}
          </p>
          <p>
            {data.record?.standards_accepted_at
              ? 'The stall owner accepted the food handling standards.'
              : 'Food handling acknowledgment is pending.'}
          </p>
          {data.record?.reviewer_note && <p>{data.record.reviewer_note}</p>}
          {data.documents.length > 0 && (
            <ul aria-label="Private verification documents">
              {data.documents.map(({ name, url }, index) => (
                <li key={name}>
                  {url && (
                    <a href={url} target="_blank" rel="noreferrer">
                      {categories[name.split('-')[0] as keyof typeof categories] ?? 'Document'}{' '}
                      {index + 1}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
          <form
            key={data.record?.reviewed_at}
            className="form-stack"
            onSubmit={async (event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const fields = new FormData(form);
              setError(null);
              setBusy(true);
              try {
                if (reviewer) {
                  await rpc('review_stall_documents', {
                    p_stall: stallId,
                    p_status: fields.get('status'),
                    p_expiry: fields.get('expiry') || null,
                    p_note: String(fields.get('note') ?? ''),
                  });
                } else {
                  const file = fields.get('file');
                  if (file instanceof File && file.size > 5_242_880)
                    throw new Error('Choose a file under 5 MB.');
                  if (!data.record?.standards_accepted_at)
                    await rpc('accept_stall_standards', { p_stall: stallId });
                  if (file instanceof File && file.size) {
                    const { error } = await getSupabase()
                      .storage.from('stall-verification')
                      .upload(`${stallId}/${fields.get('category')}-${crypto.randomUUID()}`, file, {
                        contentType: file.type,
                      });
                    if (error) throw error;
                  }
                  form.reset();
                }
                await client.invalidateQueries({ queryKey: key });
              } catch (problem) {
                setError(problem);
              } finally {
                setBusy(false);
              }
            }}
          >
            {reviewer ? (
              <>
                <label>
                  Verification status{' '}
                  <select name="status" defaultValue={status}>
                    {Object.entries(labels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Expiration date (if applicable){' '}
                  <input type="date" name="expiry" defaultValue={data.record?.expires_on ?? ''} />
                </label>
                <label>
                  Review note{' '}
                  <textarea
                    name="note"
                    maxLength={1000}
                    defaultValue={data.record?.reviewer_note ?? ''}
                  />
                </label>
              </>
            ) : (
              <>
                {!data.record?.standards_accepted_at && (
                  <label className="check-label">
                    <input type="checkbox" name="standards" required /> {foodHandlingStandards}
                  </label>
                )}
                <label>
                  Document type{' '}
                  <select name="category">
                    {Object.entries(categories).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Supporting document (optional){' '}
                  <input
                    name="file"
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,image/webp"
                  />
                </label>
              </>
            )}
            {Boolean(error) && <ErrorBox error={error} />}
            <button className="secondary-button" disabled={busy}>
              <Busy busy={busy}>
                {reviewer ? 'Save verification' : 'Save verification details'}
              </Busy>
            </button>
          </form>
        </>
      )}
    </details>
  );
}
