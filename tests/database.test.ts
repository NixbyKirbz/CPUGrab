import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { readFile, readdir } from 'node:fs/promises';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
let db: PGlite;
const student = '11111111-1111-4111-8111-111111111111',
  other = '22222222-2222-4222-8222-222222222222',
  seller = '33333333-3333-4333-8333-333333333333',
  admin = '44444444-4444-4444-8444-444444444444';
const stall = '00000000-0000-4000-8000-000000000020',
  item = '00000000-0000-4000-8000-000000000100';
let slot: string, order: string;
async function as(id: string) {
  await db.exec(
    `reset role;set role authenticated;select set_config('request.jwt.claim.sub','${id}',false);`,
  );
}
async function owner() {
  await db.exec('reset role');
}
async function create(
  key = crypto.randomUUID(),
  qty = 1,
  pickupSlot = slot,
  method = 'gcash',
  total = 8500,
) {
  const r = await db.query<{ id: string }>(
    "select public.create_reservation($1,$2,$3::jsonb,$4,'test',$5,$6) as id",
    [stall, pickupSlot, JSON.stringify([{ id: item, quantity: qty }]), key, method, total],
  );
  return r.rows[0].id;
}
beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto, pg_trgm } });
  await db.exec(
    `create role anon;create role authenticated;create schema auth;create schema storage;create schema extensions;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,owner_id text);alter table storage.objects enable row level security;create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1,'/') $$;create publication supabase_realtime;`,
  );
  for (const file of (await readdir('supabase/migrations')).sort())
    await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
  await db.exec(await readFile('supabase/seed.sql', 'utf8'));
  for (const [id, email] of [
    [student, 'student@example.com'],
    [other, 'other@example.com'],
    [seller, 'seller@example.com'],
    [admin, 'admin@example.com'],
  ])
    await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)', [
      id,
      email,
      JSON.stringify({ full_name: 'Test User', student_id: 'TEST' }),
    ]);
  await db.query("update public.user_roles set role='seller' where user_id=$1", [seller]);
  await db.query("update public.user_roles set role='admin' where user_id=$1", [admin]);
  await db.query('update public.stalls set owner_id=$1 where id=$2', [seller, stall]);
  const r = await db.query<{ id: string }>(
    "insert into public.pickup_slots(stall_id,start_time,end_time,max_reservations) values($1,now()+interval '5 minutes',now()+interval '35 minutes',2) returning id",
    [stall],
  );
  slot = r.rows[0].id;
}, 60000);
afterAll(async () => {
  await db?.close();
});
describe('Database authorization and atomic lifecycle', () => {
  it('lists and accepts only pickup times that fit within today in Manila', async () => {
    await owner();
    await db.exec("set time zone 'America/Los_Angeles'");
    const { rows: laterSlots } = await db.query<{ id: string }>(
      `with boundary as (
        select ((timezone('Asia/Manila', now())::date + 1)::timestamp at time zone 'Asia/Manila') as midnight
      )
      insert into public.pickup_slots(stall_id,start_time,end_time,max_reservations)
      select $1, midnight + offset_time, midnight + offset_time + interval '30 minutes', 2
      from boundary cross join (values (interval '10 minutes'), (interval '2 days')) offsets(offset_time)
      returning id`,
      [stall],
    );
    try {
      await as(student);
      const { rows: available } = await db.query<{ id: string }>(
        'select id from public.available_pickup_slots($1)',
        [stall],
      );
      const ids = available.map(({ id }) => id);
      expect(ids).toContain(slot);
      for (const { id } of laterSlots) {
        expect(ids).not.toContain(id);
        await expect(create(crypto.randomUUID(), 1, id)).rejects.toThrow('pickup time for today');
      }
    } finally {
      await owner();
      await db.exec('reset time zone');
    }
  });
  it('keeps account confirmation from granting administrator access during the pause', async () => {
    await owner();
    const invited = '55555555-5555-4555-8555-555555555555';
    await db.query(
      "insert into cpugrab_private.admin_bootstrap(email) values('invited@example.com')",
    );
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at) values($1,'invited@example.com',now())",
      [invited],
    );
    expect(
      (
        await db.query<{ role: string }>('select role from public.user_roles where user_id=$1', [
          invited,
        ])
      ).rows[0].role,
    ).toBe('student');
    await db.query('update auth.users set email_confirmed_at=now() where id=$1', [invited]);
    expect(
      (
        await db.query<{ role: string }>('select role from public.user_roles where user_id=$1', [
          invited,
        ])
      ).rows[0].role,
    ).toBe('student');
    expect((await db.query('select * from cpugrab_private.admin_bootstrap')).rows).toHaveLength(1);
    await as(other);
    await expect(db.query('select * from cpugrab_private.admin_bootstrap')).rejects.toThrow();
  });
  it('uses current database prices, snapshots fees, and reserves stock', async () => {
    await owner();
    await db.query('update public.menu_items set stock_quantity=5 where id=$1', [item]);
    await as(student);
    order = await create();
    const r = await db.query<{ total_centavos: number }>(
      'select total_centavos from public.orders where id=$1',
      [order],
    );
    expect(r.rows[0].total_centavos).toBe(8500);
    await owner();
    expect(
      (
        await db.query<{ stock_quantity: number }>(
          'select stock_quantity from public.menu_items where id=$1',
          [item],
        )
      ).rows[0].stock_quantity,
    ).toBe(4);
  });
  it('returns the same order for the same idempotency key', async () => {
    await as(student);
    const key = crypto.randomUUID();
    const a = await create(key);
    const b = await create(key);
    expect(a).toBe(b);
  });
  it('rejects a full pickup slot', async () => {
    await as(other);
    await expect(create()).rejects.toThrow('full');
  });
  it('hides other students’ orders and denies direct writes', async () => {
    await as(other);
    expect((await db.query('select * from public.orders')).rows).toHaveLength(0);
    await expect(
      db.exec(`update public.orders set total_centavos=1 where id='${order}'`),
    ).rejects.toThrow();
    await expect(
      db.exec(`update public.user_roles set role='admin' where user_id='${other}'`),
    ).rejects.toThrow();
    await expect(db.exec('select * from public.pickup_tokens')).rejects.toThrow();
  });
  it('rejects foreign stall updates and out-of-role readiness', async () => {
    await as(student);
    await expect(db.query('select public.mark_order_ready($1)', [order])).rejects.toThrow(
      'Not authorized',
    );
    await as(seller);
    await expect(
      db.query('select public.update_menu_availability($1,false)', [
        '00000000-0000-4000-8000-000000000104',
      ]),
    ).rejects.toThrow('Not authorized');
  });
  it('marks ready and notifies the student', async () => {
    await as(seller);
    await db.query('select public.mark_order_ready($1)', [order]);
    await as(student);
    expect(
      (await db.query<{ status: string }>('select status from public.orders where id=$1', [order]))
        .rows[0].status,
    ).toBe('ready');
    expect(
      (await db.query("select * from public.notifications where title='Your meal is ready!'")).rows,
    ).toHaveLength(1);
  });
  it('rotates a token, redeems a prepaid order, and rejects duplicate scans', async () => {
    await as(student);
    const t = await db.query<{ token: string }>('select public.issue_pickup_token($1) as token', [
      order,
    ]);
    const old = t.rows[0].token;
    const token = (
      await db.query<{ token: string }>('select public.issue_pickup_token($1) as token', [order])
    ).rows[0].token;
    expect(token).toHaveLength(64);
    expect(token).not.toBe(old);
    await as(other);
    await expect(db.query('select public.redeem_pickup_token($1)', [token])).rejects.toThrow();
    await as(seller);
    await expect(db.query('select public.redeem_pickup_token($1)', [old])).rejects.toThrow(
      'Invalid',
    );
    await db.query('select public.redeem_pickup_token($1)', [token]);
    await expect(db.query('select public.redeem_pickup_token($1)', [token])).rejects.toThrow(
      'used',
    );
    await as(student);
    const r = await db.query<{ status: string; payment_status: string }>(
      'select status,payment_status from public.orders where id=$1',
      [order],
    );
    expect(r.rows[0]).toEqual({ status: 'completed', payment_status: 'paid' });
  });
  it('cancels with a reason and restores capacity and stock exactly once', async () => {
    await as(seller);
    const r = await db.query<{ id: string }>(
      "select id from public.orders where status='reserved'",
    );
    const id = r.rows[0].id;
    await expect(db.query('select public.cancel_order($1,$2)', [id, ''])).rejects.toThrow('reason');
    await db.query('select public.cancel_order($1,$2)', [id, 'Food item unavailable']);
    expect(
      (await db.query('select payment_method, payment_status from public.orders where id=$1', [id]))
        .rows[0],
    ).toEqual({ payment_method: 'gcash', payment_status: 'refunded' });
    await expect(
      db.query('select public.cancel_order($1,$2)', [id, 'Food item unavailable']),
    ).rejects.toThrow('cannot');
    await as(other);
    expect(await create()).toBeTruthy();
  });
  it('credits, charges and refunds only the owner’s simulated wallet exactly once', async () => {
    await owner();
    const {
      rows: [walletSlot],
    } = await db.query<{ id: string }>(
      `insert into public.pickup_slots(stall_id,start_time,end_time,max_reservations)
       values($1,now()+interval '20 minutes',now()+interval '40 minutes',1) returning id`,
      [stall],
    );
    const getBalance = async () =>
      Number(
        (await db.query<{ balance: number }>('select public.simulated_wallet_balance() as balance'))
          .rows[0].balance,
      );
    const cashInKey = crypto.randomUUID();
    const cashIn = (amount: number) =>
      db.query('select public.simulate_wallet_cash_in($1,$2)', [amount, cashInKey]);
    await as(student);
    expect(await getBalance()).toBe(0);
    await expect(create(crypto.randomUUID(), 1, walletSlot.id, 'cash')).rejects.toThrow(
      'Choose GCash',
    );
    await expect(create(crypto.randomUUID(), 1, walletSlot.id, 'wallet')).rejects.toThrow(
      'Insufficient',
    );
    await expect(cashIn(-100)).rejects.toThrow('cash-in amount');
    await cashIn(10000);
    await cashIn(10000);
    await expect(cashIn(5000)).rejects.toThrow('different amount');
    expect(await getBalance()).toBe(10000);
    await expect(create(crypto.randomUUID(), 1, walletSlot.id, 'wallet', 1)).rejects.toThrow(
      'total has changed',
    );
    expect(await getBalance()).toBe(10000);

    const orderKey = crypto.randomUUID();
    const id = await create(orderKey, 1, walletSlot.id, 'wallet');
    expect(await create(orderKey, 1, walletSlot.id, 'wallet')).toBe(id);
    expect(await getBalance()).toBe(1500);
    await as(other);
    expect(await getBalance()).toBe(0);
    await expect(
      db.exec('select * from cpugrab_private.simulated_wallet_entries'),
    ).rejects.toThrow();
    await as(seller);
    await expect(cashIn(10000)).rejects.toThrow('active student');
    await as(student);
    await db.query("select public.cancel_order($1,'Customer request')", [id]);
    await expect(
      db.query("select public.cancel_order($1,'Customer request')", [id]),
    ).rejects.toThrow('cannot');
    expect(await getBalance()).toBe(10000);
  });
  it('keeps pre-existing unpaid orders from being released at pickup', async () => {
    await owner();
    const {
      rows: [legacy],
    } = await db.query<{ id: string }>(
      `insert into public.orders (
         student_id, stall_id, pickup_slot_id, idempotency_key, payment_method, payment_status,
         subtotal_centavos, markup_centavos, reservation_fee_centavos, stall_fee_share_centavos,
         platform_fee_share_centavos, total_centavos
       ) select student_id, stall_id, pickup_slot_id, gen_random_uuid(), 'cash', 'unpaid',
         subtotal_centavos, markup_centavos, reservation_fee_centavos, stall_fee_share_centavos,
         platform_fee_share_centavos, total_centavos
       from public.orders where id=$1 returning id`,
      [order],
    );
    const token = '1'.repeat(64);
    await db.query(
      `insert into public.pickup_tokens (order_id, token_hash, expires_at)
       values ($1, encode(extensions.digest($2::text,'sha256'),'hex'), now()+interval '1 hour')`,
      [legacy.id, token],
    );
    await as(student);
    await expect(db.query('select public.issue_pickup_token($1)', [legacy.id])).rejects.toThrow(
      'Payment is required',
    );
    await as(seller);
    await expect(db.query('select public.redeem_pickup_token($1)', [token])).rejects.toThrow(
      'Payment is required',
    );
  });
  it('prevents fee, approval, and suspension privilege escalation', async () => {
    await as(student);
    expect(
      (
        await db.query(
          'update public.platform_settings set reservation_fee_centavos=0 returning id',
        )
      ).rows,
    ).toHaveLength(0);
    await expect(
      db.query('select public.manage_seller_approval($1,$2)', [stall, 'approved']),
    ).rejects.toThrow('Not authorized');
    await expect(
      db.query('select public.set_account_suspension($1,true)', [seller]),
    ).rejects.toThrow('Not authorized');
  });
  it('suspension prevents protected operations', async () => {
    await as(admin);
    await db.query('select public.set_account_suspension($1,true)', [student]);
    await as(student);
    await expect(create()).rejects.toThrow('active student');
    expect((await db.query('select * from public.orders')).rows).toHaveLength(0);
  });
});
