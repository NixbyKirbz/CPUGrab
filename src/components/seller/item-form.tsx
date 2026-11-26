'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { z } from 'zod';
import { useStall } from './context';
import { getSupabase } from '@/lib/supabase/client';
import { uploadImage } from '@/lib/upload';
import { useSession } from '@/components/providers';
import { PageTitle, Loading, ErrorBox, Busy } from '@/components/ui';
const schema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(1000),
  price_centavos: z.number().int().min(0).max(10000000),
  category_id: z.uuid(),
  is_available: z.boolean(),
});
export function ItemForm({ id }: { id?: string }) {
  const { user } = useSession();
  const { data: stall } = useStall();
  const router = useRouter();
  const query = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('categories')
        .select('*')
        .order('display_order');
      if (error) throw error;
      return data;
    },
  });
  const { data: item, isPending } = useQuery({
    queryKey: ['seller-item', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('menu_items')
        .select('*')
        .eq('id', id!)
        .single();
      if (error) throw error;
      return data;
    },
  });
  if (id && isPending) return <Loading />;
  const save = async (form: HTMLFormElement) => {
    setBusy(true);
    setError(null);
    try {
      if (!navigator.onLine) throw new Error('Reconnect to save your menu.');
      if (!user || !stall) throw new Error('Sign in to your approved stall account.');
      const f = new FormData(form);
      const value = schema.parse({
        name: f.get('name'),
        description: f.get('description'),
        price_centavos: Math.round(Number(f.get('price')) * 100),
        category_id: f.get('category'),
        is_available: f.get('available') === 'on',
      });
      const file = f.get('image') as File;
      const image = file?.size ? await uploadImage(file, user.id) : item?.image_url;
      if (!image) throw new Error('Add a food photo.');
      const db = getSupabase();
      const result = id
        ? await db
            .from('menu_items')
            .update({ ...value, image_url: image })
            .eq('id', id)
            .eq('stall_id', stall.id)
            .select('id')
            .single()
        : await db
            .from('menu_items')
            .insert({ ...value, image_url: image, stall_id: stall.id })
            .select('id')
            .single();
      if (result.error) throw result.error;
      await query.invalidateQueries({ queryKey: ['seller-menu'] });
      await query.invalidateQueries({ queryKey: ['catalog'] });
      router.push('/seller/menu');
    } catch (e) {
      setError(e instanceof z.ZodError ? new Error(e.issues[0].message) : e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageTitle
        title={id ? 'A fresh look for your favorite' : 'Something new on the menu'}
        back="/seller/menu"
      />
      <section className="panel" style={{ maxWidth: 650 }}>
        <form
          key={item?.id || 'new'}
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void save(e.currentTarget);
          }}
        >
          {item?.image_url && (
            <img
              src={item.image_url}
              alt={item.name}
              style={{ width: 150, height: 150, objectFit: 'cover', borderRadius: 12 }}
            />
          )}
          <label>
            Food picture
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              name="image"
              required={!id}
            />
            <span className="help-text">JPG, PNG or WebP, up to 5 MB.</span>
          </label>
          <label>
            Food name
            <input name="name" required maxLength={120} defaultValue={item?.name} />
          </label>
          <label>
            Description
            <textarea name="description" maxLength={1000} defaultValue={item?.description} />
          </label>
          <div className="form-grid">
            <label>
              Price (₱)
              <input
                name="price"
                type="number"
                min="0"
                max="100000"
                step="0.01"
                required
                defaultValue={item ? item.price_centavos / 100 : undefined}
              />
            </label>
            <label>
              Category
              <select name="category" required defaultValue={item?.category_id}>
                <option value="">Select a category</option>
                {categories.map((c) => (
                  <option value={c.id} key={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="check-label">
            <input type="checkbox" name="available" defaultChecked={item?.is_available ?? true} />
            Available for reservations
          </label>
          {Boolean(error) && <ErrorBox error={error} />}
          <button className="primary-button" disabled={busy}>
            <Busy busy={busy}>Save item</Busy>
          </button>
          {id && (
            <button
              type="button"
              className="danger-button"
              disabled={busy}
              onClick={async () => {
                if (!window.confirm('Archive this item? Past order records will remain.')) return;
                setBusy(true);
                try {
                  const { error } = await getSupabase()
                    .from('menu_items')
                    .update({ is_archived: true, is_available: false })
                    .eq('id', id)
                    .select('id')
                    .single();
                  if (error) throw error;
                  await query.invalidateQueries({ queryKey: ['seller-menu'] });
                  router.push('/seller/menu');
                } catch (e) {
                  setError(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Archive item
            </button>
          )}
        </form>
      </section>
    </>
  );
}
