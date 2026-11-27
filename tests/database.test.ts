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
    `create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;create schema extensions;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,owner_id text);alter table storage.objects enable row level security;create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1,'/') $$;create publication supabase_realtime;`,
  );
  for (const file of (await readdir('supabase/migrations')).sort())
    await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
  await db.exec(await readFile('supabase/seed.sql', 'utf8'));
  // Allow these fixtures to use the current clock even when the suite runs after campus hours.
  await db.exec('alter table public.stalls drop constraint stalls_reservation_hours');
  await db.query(
    "update public.stalls set reservation_opens_at='00:00',reservation_closes_at='23:59:59' where id=$1",
    [stall],
  );
  for (const [id, email] of [
    [student, 'student@example.com'],
    [other, 'other@example.com'],
    [seller, 'seller@example.com'],
    [admin, 'admin@example.com'],
  ])
    await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)', [
      id,
      email,
      JSON.stringify({ full_name: 'Test User', student_id: email.split('@')[0] + '-TEST' }),
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
  it('keeps student-number lookup private and stall applicants separate from students', async () => {
    await as(student);
    await expect(db.query("select public.student_login_email('student-test')")).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      db.query("select public.register_seller('Other stall',$1,'09123456789','stall.png')", [
        '00000000-0000-4000-8000-000000000001',
      ]),
    ).rejects.toThrow(/separate Stall Portal account/);
    await owner();
    await db.exec('set role service_role');
    expect(
      (await db.query("select public.student_login_email(' STUDENT-TEST ') as email")).rows,
    ).toEqual([{ email: 'student@example.com' }]);
    expect(
      (await db.query("select public.student_login_email('seller-test') as email")).rows,
    ).toEqual([{ email: null }]);
    await owner();
    const applicant = 'a905980a-5e55-4311-903f-a6f0bcc1b4a1';
    await db.query(
      "insert into auth.users(id,email,raw_user_meta_data) values($1,'newstall@example.com',$2)",
      [applicant, JSON.stringify({ account_type: 'seller', student_id: 'student-test' })],
    );
    await as(applicant);
    expect((await db.query("select public.has_role('student') as allowed")).rows).toEqual([
      { allowed: false },
    ]);
    const submitted = await db.query<{ id: string }>(
      "select public.register_seller('New stall',$1,'09123456789','stall.png') as id",
      ['00000000-0000-4000-8000-000000000001'],
    );
    expect(
      (
        await db.query('select approval_status from public.stalls where id=$1', [
          submitted.rows[0].id,
        ])
      ).rows,
    ).toEqual([{ approval_status: 'pending' }]);
    await owner();
    await expect(
      db.query(
        "insert into auth.users(id,email,raw_user_meta_data) values(gen_random_uuid(),'duplicate@example.com',$1)",
        [JSON.stringify({ student_id: ' STUDENT-TEST ' })],
      ),
    ).rejects.toThrow(/already registered/);
  });
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
    await db.query('update public.profiles set wallet_reminder_enabled=true where id=$1', [
      student,
    ]);
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
    expect(
      (
        await db.query(
          "select id from public.notifications where title='Wallet balance is low' and order_id=$1",
          [id],
        )
      ).rows,
    ).toHaveLength(1);
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
    ).rejects.toThrow('Administrator access');
    await expect(
      db.query('select public.set_account_suspension($1,true)', [seller]),
    ).rejects.toThrow('Not authorized');
  });
  it('keeps a submitted stall pending until an administrator approves it', async () => {
    const applicant = '71111111-1111-4111-8111-111111111111';
    await owner();
    await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)', [
      applicant,
      'stall-applicant@example.com',
      JSON.stringify({ full_name: 'Stall Applicant', account_type: 'seller' }),
    ]);
    await as(applicant);
    const {
      rows: [{ id }],
    } = await db.query<{ id: string }>(
      "select public.register_seller('New Stall',(select id from public.locations limit 1),'09123456789','https://example.com/stall.png') as id",
    );
    const canManage = async () =>
      (await db.query<{ allowed: boolean }>('select public.can_manage_stall($1) as allowed', [id]))
        .rows[0].allowed;
    expect(await canManage()).toBe(false);
    expect(
      (await db.query('select approval_status from public.stalls where id=$1', [id])).rows[0],
    ).toEqual({ approval_status: 'pending' });
    await expect(
      db.query("select public.manage_seller_approval($1,'approved')", [id]),
    ).rejects.toThrow('Administrator access');
    await db.query('select public.accept_stall_standards($1)', [id]);
    await as(admin);
    await expect(
      db.query("select public.manage_seller_approval($1,'approved')", [id]),
    ).rejects.toThrow('Review the stall verification');
    await db.query(
      "select public.review_stall_documents($1,'verified',null,'Verified for the pilot')",
      [id],
    );
    await db.query("select public.manage_seller_approval($1,'approved')", [id]);
    await as(applicant);
    expect(await canManage()).toBe(true);
  });
  it('holds a worker for paid campus delivery and uses different single-use pickup and handover codes', async () => {
    await owner();
    await db.query(
      "update public.stalls set delivery_enabled=true, delivery_closes_at='23:59' where id=$1",
      [stall],
    );
    const {
      rows: [{ id: dropoff }],
    } = await db.query<{ id: string }>(
      'update public.locations set is_delivery_dropoff=true where id=(select id from public.locations limit 1) returning id',
    );
    const {
      rows: [{ id: deliverySlot }],
    } = await db.query<{ id: string }>(
      "insert into public.pickup_slots(stall_id,start_time,end_time,max_reservations) values($1,now()+interval '10 minutes',now()+interval '30 minutes',3) returning id",
      [stall],
    );
    const options = async () =>
      (
        await db.query<{ ids: string[] }>('select public.delivery_options($1,$2) as ids', [
          stall,
          deliverySlot,
        ])
      ).rows[0].ids;
    await as(student);
    expect(await options()).toEqual([]);
    await as(other);
    await db.query("select public.apply_delivery_worker('09123456789','DEMO-ID')");
    await expect(
      db.query(
        "select public.set_delivery_availability(now()+interval '1 hour',null,'{}'::uuid[])",
      ),
    ).rejects.toThrow('approved first');
    await as(admin);
    await db.query("select public.review_delivery_worker($1,'approved')", [other]);
    await as(other);
    await db.query(
      "select public.set_delivery_availability(now()+interval '1 hour',null,'{}'::uuid[])",
    );
    await as(student);
    expect(await options()).toEqual([dropoff]);
    const place = async (key: string, method = 'gcash') =>
      (
        await db.query<{ id: string }>(
          "select public.create_delivery_reservation($1,$2,$3::jsonb,$4,'delivery',$5,10000,$6) as id",
          [stall, deliverySlot, JSON.stringify([{ id: item, quantity: 1 }]), key, method, dropoff],
        )
      ).rows[0].id;
    const key = crypto.randomUUID();
    const id = await place(key);
    expect(await place(key)).toBe(id);
    expect(await options()).toEqual([]);
    await expect(place(crypto.randomUUID())).rejects.toThrow('No delivery worker');
    await expect(db.query('select public.issue_pickup_token($1)', [id])).rejects.toThrow(
      'customer handover',
    );
    const step = async (action: string, code?: string, orderId = id) =>
      (
        await db.query<{ result: string }>('select public.delivery_action($1,$2,$3) as result', [
          orderId,
          action,
          code ?? null,
        ])
      ).rows[0].result;
    const credentials = async (stage: string) =>
      (
        await db.query<{ codes: { pin: string; qr: string } }>(
          'select public.delivery_credentials($1,$2) as codes',
          [id, stage],
        )
      ).rows[0].codes;
    await expect(step('accept')).rejects.toThrow('approved delivery worker');
    await as(seller);
    await expect(db.query('select public.mark_order_ready($1)', [id])).rejects.toThrow(
      /wait for the delivery worker/i,
    );
    await as(other);
    expect(await step('accept')).toBe('ok');
    await expect(step('accept')).rejects.toThrow('no longer available');
    const pickup = await credentials('pickup');
    expect(pickup.pin).toMatch(/^\d{6}$/);
    await expect(credentials('handover')).rejects.toThrow('unavailable');
    await as(seller);
    await db.query('select public.mark_order_ready($1)', [id]);
    expect(await step('collect', 'incorrect')).toBe('invalid_code');
    expect(await step('collect', pickup.pin)).toBe('ok');
    expect((await db.query('select status from public.orders where id=$1', [id])).rows[0]).toEqual({
      status: 'ready',
    });
    await expect(step('collect', pickup.pin)).rejects.toThrow('pickup window');
    await as(other);
    expect(await step('start')).toBe('ok');
    expect(await step('arrive')).toBe('ok');
    await as(student);
    const handover = await credentials('handover');
    expect(handover.pin).not.toBe(pickup.pin);
    expect(handover.qr).toContain('delivery-handover');
    await as(other);
    expect(await step('handover', pickup.pin)).toBe('invalid_code');
    expect(await step('handover', handover.qr.split(':').at(-1))).toBe('ok');
    await expect(step('handover', handover.pin)).rejects.toThrow('unavailable');
    expect(
      (
        await db.query(
          'select phase,worker_earnings_centavos from public.deliveries where order_id=$1',
          [id],
        )
      ).rows[0],
    ).toEqual({ phase: 'completed', worker_earnings_centavos: 1500 });

    await as(student);
    const {
      rows: [{ previous }],
    } = await db.query<{ previous: number }>(
      'select public.simulated_wallet_balance() as previous',
    );
    const unaccepted = await place(crypto.randomUUID(), 'wallet');
    await owner();
    await db.query(
      "update public.deliveries set offer_expires_at=now()-interval '1 second' where order_id=$1",
      [unaccepted],
    );
    await db.exec(
      'select cpugrab_private.expire_delivery_offers(); select cpugrab_private.expire_delivery_offers();',
    );
    await as(student);
    expect(
      (await db.query('select status,payment_status from public.orders where id=$1', [unaccepted]))
        .rows[0],
    ).toEqual({ status: 'cancelled', payment_status: 'refunded' });
    expect(
      (await db.query('select public.simulated_wallet_balance() as previous')).rows[0],
    ).toEqual({ previous });
  });
  it('groups compatible bookings for one worker and still verifies each handover separately', async () => {
    const third = '77111111-1111-4111-8111-111111111111';
    await owner();
    await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)', [
      third,
      'group-customer@example.com',
      '{"full_name":"Group Customer","student_id":"GROUP-TEST"}',
    ]);
    await db.query('update public.menu_items set stock_quantity=10 where id=$1', [item]);
    const {
      rows: [{ id: groupSlot }],
    } = await db.query<{ id: string }>(
      "insert into public.pickup_slots(stall_id,start_time,end_time,max_reservations) values($1,now()+interval '10 minutes',now()+interval '30 minutes',4) returning id",
      [stall],
    );
    const {
      rows: [{ id: dropoff }],
    } = await db.query<{ id: string }>(
      'select id from public.locations where is_delivery_dropoff limit 1',
    );
    const book = async () =>
      (
        await db.query<{ id: string }>(
          "select public.create_delivery_reservation($1,$2,$3::jsonb,$4,'group','gcash',9500,$5,true) as id",
          [
            stall,
            groupSlot,
            JSON.stringify([{ id: item, quantity: 1 }]),
            crypto.randomUUID(),
            dropoff,
          ],
        )
      ).rows[0].id;
    const step = async (orderId: string, action: string, code?: string) =>
      (
        await db.query<{ result: string }>('select public.delivery_action($1,$2,$3) as result', [
          orderId,
          action,
          code ?? null,
        ])
      ).rows[0].result;
    const code = async (orderId: string, stage: string) =>
      (
        await db.query<{ codes: { pin: string; qr: string } }>(
          'select public.delivery_credentials($1,$2) as codes',
          [orderId, stage],
        )
      ).rows[0].codes;
    await as(student);
    const first = await book();
    await as(other);
    await expect(step(first, 'accept')).rejects.toThrow('At least two students');
    await as(third);
    expect(
      (await db.query('select public.delivery_options($1,$2,true) as ids', [stall, groupSlot]))
        .rows[0],
    ).toEqual({ ids: [dropoff] });
    const second = await book();
    await as(other);
    expect(await step(second, 'accept')).toBe('ok');
    const { rows: assigned } = await db.query<{
      group_id: string;
      phase: string;
      compensation_centavos: number;
    }>(
      'select group_id,phase,compensation_centavos from public.deliveries where order_id in ($1,$2)',
      [first, second],
    );
    expect(assigned).toHaveLength(2);
    expect(assigned[0]).toEqual(assigned[1]);
    expect(assigned[0]).toMatchObject({ phase: 'assigned', compensation_centavos: 1000 });
    const pickup1 = await code(first, 'pickup');
    const pickup2 = await code(second, 'pickup');
    await as(seller);
    await db.query('select public.mark_order_ready($1)', [first]);
    await db.query('select public.mark_order_ready($1)', [second]);
    expect(await step(first, 'collect', pickup1.pin)).toBe('ok');
    expect(await step(second, 'collect', pickup2.pin)).toBe('ok');
    await as(other);
    for (const id of [first, second]) {
      expect(await step(id, 'start')).toBe('ok');
      expect(await step(id, 'arrive')).toBe('ok');
    }
    await as(student);
    const handover = await code(first, 'handover');
    await expect(code(second, 'handover')).rejects.toThrow('unavailable');
    await as(other);
    expect(await step(first, 'handover', handover.pin)).toBe('ok');
    expect(
      (
        await db.query(
          'select phase,worker_earnings_centavos from public.deliveries where order_id=$1',
          [second],
        )
      ).rows[0],
    ).toEqual({ phase: 'arrived', worker_earnings_centavos: 0 });
    await owner();
    await db.query(
      "update public.deliveries set wait_until=now()-interval '1 second' where order_id=$1",
      [second],
    );
    await as(other);
    expect(
      await step(second, 'report_issue', 'Called the customer and waited at the drop-off.'),
    ).toBe('ok');
    await expect(
      db.query("select public.resolve_delivery_issue($1,true,true,'Reviewed handover attempts')", [
        second,
      ]),
    ).rejects.toThrow('Administrator');
    await as(admin);
    await db.query(
      "select public.resolve_delivery_issue($1,true,true,'Reviewed handover attempts')",
      [second],
    );
    expect(
      (await db.query('select status,payment_status from public.orders where id=$1', [second]))
        .rows[0],
    ).toEqual({ status: 'cancelled', payment_status: 'refunded' });
    expect(
      (
        await db.query(
          'select phase,worker_earnings_centavos from public.deliveries where order_id=$1',
          [second],
        )
      ).rows[0],
    ).toEqual({ phase: 'unsuccessful', worker_earnings_centavos: 1000 });
  });
  it('shares verification across PIN and QR and adjudicates private reports with budgeted rewards', async () => {
    await owner();
    await db.query('update public.menu_items set stock_quantity=30 where id=$1', [item]);
    const {
      rows: [period],
    } = await db.query<{ id: string }>(
      "insert into public.pickup_slots(stall_id,start_time,end_time,max_reservations) values($1,now()+interval '10 minutes',now()+interval '30 minutes',5) returning id",
      [stall],
    );
    await as(admin);
    await db.query('select public.reward_admin(1,500,500)');
    await as(other);
    const meal = await create(crypto.randomUUID(), 1, period.id);
    const {
      rows: [{ code }],
    } = await db.query<{ code: { pin: string; token: string } }>(
      'select public.issue_pickup_credentials($1) as code',
      [meal],
    );
    expect(code.pin).toMatch(/^\d{6}$/);
    await as(seller);
    const checkPin = async (confirm: boolean) =>
      (
        await db.query<{ result: { error?: string } }>(
          'select public.verify_pickup_pin($1,$2,$3) as result',
          [stall, code.pin, confirm],
        )
      ).rows[0].result;
    expect(await checkPin(false)).not.toHaveProperty('error');
    expect(
      (await db.query('select status from public.orders where id=$1', [meal])).rows[0],
    ).toEqual({ status: 'reserved' });
    expect(await checkPin(true)).not.toHaveProperty('error');
    expect(await checkPin(true)).toHaveProperty('error');
    await expect(
      db.query('select public.inspect_pickup_token($1)', [code.token]),
    ).rejects.toThrow();
    await as(other);
    const rewards = async () =>
      (
        await db.query<{
          result: {
            available: { id: string; amount_centavos: number }[];
            history: { action: string }[];
          };
        }>('select public.student_rewards() as result')
      ).rows[0].result;
    const earned = (await rewards()).available;
    expect(earned).toHaveLength(1);
    expect(earned[0].amount_centavos).toBe(500);
    const discount = async (key: string) =>
      (
        await db.query<{ id: string }>(
          "select public.create_reward_reservation($1,$2,$3,$4,'','gcash',8000,null,false,$5) as id",
          [stall, period.id, JSON.stringify([{ id: item, quantity: 1 }]), key, earned[0].id],
        )
      ).rows[0].id;
    await as(student);
    await expect(discount(crypto.randomUUID())).rejects.toThrow('reward is unavailable');
    await as(other);
    const key = crypto.randomUUID();
    const discounted = await discount(key);
    expect(await discount(key)).toBe(discounted);
    await expect(discount(crypto.randomUUID())).rejects.toThrow('reward is unavailable');
    expect(
      (
        await db.query(
          'select total_centavos,reward_discount_centavos,stall_fee_share_centavos from public.orders where id=$1',
          [discounted],
        )
      ).rows[0],
    ).toEqual({
      total_centavos: 8000,
      reward_discount_centavos: 500,
      stall_fee_share_centavos: 1000,
    });
    await as(seller);
    await db.query("select public.cancel_order($1,'Changed lunch plans')", [discounted]);
    await as(other);
    expect((await rewards()).available).toEqual(earned);
    await db.query(
      'insert into public.order_reviews(order_id,customer_id,quality,temperature,packaging,accuracy,experience) values($1,$2,5,4,5,4,5)',
      [meal, other],
    );
    await expect(
      db.query(
        'insert into public.order_reviews(order_id,customer_id,quality,temperature,packaging,accuracy,experience) values($1,$2,5,4,5,4,5)',
        [meal, other],
      ),
    ).rejects.toThrow(/duplicate/);
    const {
      rows: [{ report }],
    } = await db.query<{ report: string }>(
      "select public.submit_order_report($1,'missing_items','Part of my meal was missing') as report",
      [meal],
    );
    await as(seller);
    expect(
      (await db.query('select id from public.order_reports where id=$1', [report])).rows,
    ).toEqual([]);
    await expect(
      db.query(
        "select public.review_order_report($1,'resolved','full_refund','Verified the report')",
        [report],
      ),
    ).rejects.toThrow('Administrator');
    await as(admin);
    await db.query(
      "select public.review_order_report($1,'resolved','full_refund','Verified the report')",
      [report],
    );
    await expect(
      db.query(
        "select public.review_order_report($1,'resolved','full_refund','Verified the report')",
        [report],
      ),
    ).rejects.toThrow('open report');
    await as(other);
    expect((await rewards()).available).toEqual([]);
    expect((await rewards()).history.map((event) => event.action)).toContain('revoked');
  });
  it('suspension prevents protected operations', async () => {
    await as(admin);
    await db.query('select public.set_account_suspension($1,true)', [student]);
    await as(student);
    await expect(create()).rejects.toThrow('active student');
    expect((await db.query('select * from public.orders')).rows).toHaveLength(0);
  });
});
