alter table public.locations add column is_delivery_dropoff boolean not null default false;
alter table public.stalls add column delivery_enabled boolean not null default false,
  add column delivery_closes_at time not null default '17:00';
alter table public.platform_settings add column delivery_fee_centavos integer not null default 1500
  check (delivery_fee_centavos between 0 and 10000),
  add column group_delivery_fee_centavos integer not null default 1000 check (group_delivery_fee_centavos between 0 and 10000),
  add column group_delivery_max_orders integer not null default 3 check (group_delivery_max_orders between 2 and 4);
grant update (delivery_enabled, delivery_closes_at) on public.stalls to authenticated;
grant update (is_delivery_dropoff) on public.locations to authenticated;

alter table public.orders add column delivery_fee_centavos integer not null default 0
  check (delivery_fee_centavos >= 0);
do $$
declare total_constraint name;
begin
  select conname into strict total_constraint from pg_catalog.pg_constraint
  where conrelid = 'public.orders'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) like '%total_centavos =%subtotal_centavos%';
  execute format('alter table public.orders drop constraint %I', total_constraint);
end $$;
alter table public.orders add constraint order_total_includes_delivery check (
  total_centavos = subtotal_centavos + markup_centavos + reservation_fee_centavos + delivery_fee_centavos
);

create table public.delivery_workers (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  full_name text not null check (length(full_name) between 1 and 120),
  student_number text not null check (length(student_number) between 1 and 40),
  contact text not null check (length(contact) between 7 and 100),
  demo_verification text not null check (length(demo_verification) between 3 and 120),
  review_status text not null default 'pending' check (review_status in ('pending','approved','declined','suspended')),
  available_from timestamptz,
  available_until timestamptz,
  next_class_at timestamptz,
  preferred_areas uuid[] not null default '{}',
  updated_at timestamptz not null default now()
);

create table public.deliveries (
  order_id uuid primary key references public.orders(id),
  customer_id uuid not null references public.profiles(id),
  stall_id uuid not null references public.stalls(id),
  dropoff_id uuid not null references public.locations(id),
  offered_to uuid not null references public.delivery_workers(user_id),
  worker_id uuid references public.delivery_workers(user_id),
  group_id uuid,
  phase text not null default 'pending' check (
    phase in ('pending','assigned','collected','on_the_way','arrived','completed','cancelled','handover_issue','unsuccessful')
  ),
  offer_expires_at timestamptz not null,
  pickup_start timestamptz not null,
  pickup_end timestamptz not null,
  delivery_until timestamptz not null,
  arrived_at timestamptz,
  completed_at timestamptz,
  settled_at timestamptz,
  worker_earnings_centavos integer not null default 0 check (worker_earnings_centavos >= 0),
  issue_note text check (length(issue_note) between 3 and 500),
  delay_requested_minutes integer check (delay_requested_minutes in (5,10,15)),
  delay_decision text check (delay_decision in ('pending','accepted','declined')),
  wait_until timestamptz,
  customer_ready_at timestamptz,
  recipient_name text check (length(recipient_name) between 1 and 100),
  compensation_centavos integer not null check (compensation_centavos >= 0),
  created_at timestamptz not null default now()
);
create index deliveries_customer_idx on public.deliveries (customer_id);
create index deliveries_stall_idx on public.deliveries (stall_id);
create index deliveries_worker_idx on public.deliveries (worker_id);
create index deliveries_offered_idx on public.deliveries (offered_to);
create index deliveries_group_idx on public.deliveries (group_id) where group_id is not null;
create index deliveries_pending_idx on public.deliveries (offer_expires_at) where phase = 'pending';

create table cpugrab_private.delivery_codes (
  order_id uuid primary key references public.deliveries(order_id),
  pickup_pin text not null,
  pickup_token text not null default encode(extensions.gen_random_bytes(32), 'hex'),
  handover_pin text not null,
  handover_token text not null default encode(extensions.gen_random_bytes(32), 'hex'),
  pickup_attempts integer not null default 0,
  pickup_retry_at timestamptz,
  handover_attempts integer not null default 0,
  handover_retry_at timestamptz,
  check (pickup_pin <> handover_pin)
);
alter table cpugrab_private.delivery_codes enable row level security;
revoke all on cpugrab_private.delivery_codes from public, anon, authenticated;
alter table public.delivery_workers enable row level security;
alter table public.deliveries enable row level security;
revoke all on public.delivery_workers, public.deliveries from public, anon, authenticated;
grant select on public.delivery_workers, public.deliveries to authenticated;
create policy delivery_worker_read on public.delivery_workers for select to authenticated using (
  ((select auth.uid()) = user_id and (select public.is_active_user())) or (select public.has_role('admin'))
);
create policy delivery_read on public.deliveries for select to authenticated using (
  (select public.is_active_user()) and (
    customer_id = (select auth.uid()) or worker_id = (select auth.uid())
    or (phase = 'pending' and offered_to = (select auth.uid()))
    or public.can_manage_stall(stall_id)
  )
);
alter publication supabase_realtime add table public.delivery_workers, public.deliveries;

create function cpugrab_private.delivery_candidate(
  p_stall uuid, p_slot uuid, p_dropoff uuid, p_worker uuid
) returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.pickup_slots slot
    join public.stalls stall on stall.id = slot.stall_id
    join public.locations stall_location on stall_location.id = stall.location_id
    join public.locations dropoff on dropoff.id = p_dropoff
    join public.delivery_workers worker on worker.user_id = p_worker
    join public.profiles profile on profile.id = worker.user_id
    join public.user_roles role on role.user_id = worker.user_id and role.role = 'student'
    where slot.id = p_slot and slot.stall_id = p_stall and slot.is_active
      and stall.delivery_enabled and stall.is_open and stall.approval_status = 'approved'
      and stall_location.is_active and dropoff.is_active and dropoff.is_delivery_dropoff
      and slot.start_time > statement_timestamp() + interval '5 minutes'
      and slot.end_time + interval '15 minutes' <= (
        (timezone('Asia/Manila', statement_timestamp())::date + stall.delivery_closes_at)
        at time zone 'Asia/Manila'
      )
      and worker.review_status = 'approved' and not profile.is_suspended and worker.user_id <> auth.uid()
      and worker.available_from <= statement_timestamp()
      and worker.available_until >= slot.end_time + interval '15 minutes'
      and (worker.next_class_at is null or worker.next_class_at >= slot.end_time + interval '15 minutes')
      and (cardinality(worker.preferred_areas) = 0 or p_dropoff = any(worker.preferred_areas))
      and not exists (
        select 1 from public.deliveries d
        where d.offered_to = worker.user_id
          and (
            (d.phase = 'pending' and d.offer_expires_at > statement_timestamp())
            or d.phase in ('assigned','collected','on_the_way','arrived','handover_issue')
          )
          and tstzrange(d.pickup_start - interval '15 minutes', greatest(d.delivery_until, d.wait_until), '[)')
              && tstzrange(slot.start_time - interval '15 minutes', slot.end_time + interval '15 minutes', '[)')
      )
  );
$$;

create function cpugrab_private.matching_delivery_group(p_stall uuid,p_slot uuid,p_dropoff uuid,p_worker uuid)
returns table(group_id uuid, worker_id uuid, deadline timestamptz) language sql stable set search_path = '' as $$
  select d.group_id,d.offered_to,d.offer_expires_at from public.deliveries d
  join public.orders o on o.id=d.order_id
  join public.delivery_workers w on w.user_id=d.offered_to and w.review_status='approved'
  join public.profiles p on p.id=w.user_id and not p.is_suspended
  join public.user_roles r on r.user_id=w.user_id and r.role='student'
  join public.stalls stall on stall.id=d.stall_id and stall.delivery_enabled and stall.is_open and stall.approval_status='approved'
  join public.locations l on l.id=stall.location_id and l.is_active
  join public.locations dropoff on dropoff.id=d.dropoff_id and dropoff.is_active and dropoff.is_delivery_dropoff
  join public.pickup_slots slot on slot.id=o.pickup_slot_id and slot.is_active
  join public.platform_settings settings on settings.id=1
  where d.group_id is not null and d.phase='pending' and d.offer_expires_at > statement_timestamp()
    and d.stall_id=p_stall and o.pickup_slot_id=p_slot and d.dropoff_id=p_dropoff
    and (p_worker is null or d.offered_to=p_worker) and d.offered_to<>auth.uid()
    and slot.end_time + interval '15 minutes' <= (
      (timezone('Asia/Manila',statement_timestamp())::date + stall.delivery_closes_at) at time zone 'Asia/Manila'
    )
    and w.available_from <= statement_timestamp() and w.available_until >= d.delivery_until
    and (w.next_class_at is null or w.next_class_at >= d.delivery_until)
    and (cardinality(w.preferred_areas)=0 or p_dropoff=any(w.preferred_areas))
    and d.compensation_centavos=settings.group_delivery_fee_centavos
  group by d.group_id,d.offered_to,d.offer_expires_at,settings.group_delivery_max_orders
  having count(*) < settings.group_delivery_max_orders and bool_and(d.customer_id<>auth.uid())
  order by d.offer_expires_at,d.group_id limit 1;
$$;

create function cpugrab_private.delivery_options(p_stall uuid, p_slot uuid, p_group boolean) returns uuid[]
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_role('student') then raise exception 'Sign in with an active student account'; end if;
  return array(
    select l.id from public.locations l
    where l.is_active and l.is_delivery_dropoff
      and (exists (
        select 1 from public.delivery_workers w
        where cpugrab_private.delivery_candidate(p_stall, p_slot, l.id, w.user_id)
      ) or (p_group and exists(select 1 from cpugrab_private.matching_delivery_group(p_stall,p_slot,l.id,null))))
    order by l.display_order, l.name
  );
end;
$$;
create function cpugrab_private.make_delivery_pin() returns text
language sql volatile set search_path = '' as $$
  select lpad(((get_byte(bytes,0)*65536+get_byte(bytes,1)*256+get_byte(bytes,2)) % 1000000)::text,6,'0')
  from (select extensions.gen_random_bytes(3) as bytes) randomness;
$$;

create function cpugrab_private.create_paid_reservation(p_stall uuid,p_slot uuid,p_items jsonb,p_key uuid,p_notes text, p_payment_method text, p_total_centavos integer,p_dropoff uuid,p_group boolean) returns uuid language plpgsql security definer set search_path='' as $$
declare existing public.orders; total integer; slot public.pickup_slots; settings public.platform_settings; item public.menu_items; line record; qty integer; subtotal integer:=0; markup integer:=0; result uuid; checked_at timestamptz; delivery_fee integer := 0; offered_worker uuid; new_pickup_pin text; new_handover_pin text;
  matched_group record; delivery_group uuid; deadline timestamptz;
begin
 if not public.has_role('student') then raise exception 'Sign in with an active student account'; end if;
 if p_key is null or p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 50 or p_notes is null or length(p_notes)>500 then raise exception 'Invalid reservation request'; end if;
 if p_payment_method is null or p_payment_method not in ('gcash','wallet') then raise exception 'Choose GCash or CPUGrab Wallet'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_key::text,0));
 select * into existing from public.orders where student_id=auth.uid() and idempotency_key=p_key;
 if found then
   if (select dropoff_id from public.deliveries where order_id=existing.id) is distinct from p_dropoff
      or (exists(select 1 from public.deliveries where order_id=existing.id and group_id is not null)) is distinct from p_group
      or existing.payment_method is distinct from p_payment_method or existing.total_centavos is distinct from p_total_centavos then
     raise exception 'This checkout was already submitted with different payment details';
   end if;
   return existing.id;
 end if;
 perform 1 from public.stalls s join public.locations l on l.id=s.location_id where s.id=p_stall and s.is_open and s.approval_status='approved' and l.is_active for share of s,l;
 if not found then raise exception 'This stall is not accepting reservations'; end if;
 select * into slot from public.pickup_slots where id=p_slot and stall_id=p_stall for update;
 checked_at = clock_timestamp();
 if slot.id is null or not slot.is_active or slot.start_time <= checked_at
    or slot.end_time >= ((timezone('Asia/Manila', checked_at)::date + 1)::timestamp at time zone 'Asia/Manila') then
  raise exception 'Choose an available pickup time for today';
 end if;
 if (select count(*) from public.orders where pickup_slot_id=p_slot and status<>'cancelled')>=slot.max_reservations then raise exception 'This pickup slot is full. Choose another time'; end if;
 select * into settings from public.platform_settings where id=1 for share;
 if p_dropoff is not null then
   deadline := clock_timestamp()+interval '3 minutes';
   if p_group then
     select * into matched_group from cpugrab_private.matching_delivery_group(p_stall,p_slot,p_dropoff,null);
     if matched_group.worker_id is not null then
       select user_id into offered_worker from public.delivery_workers where user_id=matched_group.worker_id for update skip locked;
       if found then
         select * into matched_group from cpugrab_private.matching_delivery_group(p_stall,p_slot,p_dropoff,offered_worker);
         if found then
           delivery_group := matched_group.group_id;
           deadline := matched_group.deadline;
         else
           offered_worker := null;
         end if;
       end if;
     end if;
     delivery_group := coalesce(delivery_group,gen_random_uuid());
   end if;
   if offered_worker is null then
     select w.user_id into offered_worker from public.delivery_workers w
     where cpugrab_private.delivery_candidate(p_stall,p_slot,p_dropoff,w.user_id)
     order by w.updated_at,w.user_id limit 1 for update skip locked;
     if not cpugrab_private.delivery_candidate(p_stall,p_slot,p_dropoff,offered_worker) then offered_worker := null; end if;
   end if;
   if offered_worker is null then
     raise exception 'No delivery worker is available for this time and drop-off. Choose another time or self-pickup';
   end if;
   delivery_fee := case when p_group then settings.group_delivery_fee_centavos else settings.delivery_fee_centavos end;
 end if;
 if (select count(distinct x->>'id') from jsonb_array_elements(p_items) x)<>jsonb_array_length(p_items) then raise exception 'Duplicate menu items'; end if;
 for line in select x from jsonb_array_elements(p_items) x order by x->>'id' loop
   if (line.x->>'quantity') !~ '^[0-9]+$' then raise exception 'Invalid quantity'; end if;
   qty=(line.x->>'quantity')::integer;
   if qty not between 1 and 99 then raise exception 'Quantity must be between 1 and 99'; end if;
   select * into item from public.menu_items where id=(line.x->>'id')::uuid and stall_id=p_stall for update;
   if not found or not item.is_available or item.is_archived or (item.stock_quantity is not null and item.stock_quantity<qty) then raise exception 'A menu item is unavailable. Refresh your cart'; end if;
   subtotal=subtotal+item.price_centavos*qty; markup=markup+settings.default_markup_centavos*qty;
 end loop;
 total := subtotal + markup + settings.reservation_fee_centavos + delivery_fee;
 if p_total_centavos is distinct from total then
   raise exception 'The order total has changed. Review your cart and try again';
 end if;
 if p_payment_method = 'wallet' then
   perform cpugrab_private.lock_wallet(auth.uid());
   if cpugrab_private.wallet_balance(auth.uid()) < total then
     raise exception 'Insufficient wallet balance. Cash in or switch to GCash';
   end if;
 end if;
 insert into public.orders(
   student_id, stall_id, pickup_slot_id, idempotency_key, subtotal_centavos, markup_centavos,
   reservation_fee_centavos, stall_fee_share_centavos, platform_fee_share_centavos, total_centavos,
   customer_notes, payment_method, payment_status, delivery_fee_centavos
 ) values (
   auth.uid(), p_stall, p_slot, p_key, subtotal, markup, settings.reservation_fee_centavos,
   settings.stall_fee_share_centavos, settings.platform_fee_share_centavos, total, p_notes,
   p_payment_method, 'paid', delivery_fee
 ) returning id into result;
 if p_dropoff is not null then
   insert into public.deliveries (
     order_id,customer_id,stall_id,dropoff_id,offered_to,offer_expires_at,group_id,
     pickup_start,pickup_end,delivery_until,compensation_centavos
   ) values (
     result,auth.uid(),p_stall,p_dropoff,offered_worker,deadline,delivery_group,
     slot.start_time,slot.end_time,slot.end_time+interval '15 minutes',delivery_fee
   );
   loop
     new_pickup_pin := cpugrab_private.make_delivery_pin();
     new_handover_pin := cpugrab_private.make_delivery_pin();
     exit when new_handover_pin <> new_pickup_pin and not exists (
       select 1 from cpugrab_private.delivery_codes c join public.deliveries job on job.order_id=c.order_id
       where job.group_id=delivery_group and (
         c.pickup_pin in (new_pickup_pin,new_handover_pin) or c.handover_pin in (new_pickup_pin,new_handover_pin)
       )
     );
   end loop;
   insert into cpugrab_private.delivery_codes(order_id,pickup_pin,handover_pin)
   values(result,new_pickup_pin,new_handover_pin);
 end if;
 if p_payment_method = 'wallet' then
   insert into cpugrab_private.simulated_wallet_entries (student_id, kind, reference_id, amount_centavos)
   values (auth.uid(), 'order_payment', result, -total);
 end if;
 for line in select x from jsonb_array_elements(p_items) x order by x->>'id' loop
   qty=(line.x->>'quantity')::integer;
   select * into item from public.menu_items where id=(line.x->>'id')::uuid;
   insert into public.order_items(order_id,menu_item_id,item_name_snapshot,unit_price_centavos,quantity,markup_centavos,subtotal_centavos) values(result,item.id,item.name,item.price_centavos,qty,settings.default_markup_centavos,(item.price_centavos+settings.default_markup_centavos)*qty);
   update public.menu_items set stock_quantity=stock_quantity-qty where id=item.id and stock_quantity is not null;
 end loop;
 insert into public.order_status_history(order_id,new_status,changed_by) values(result,'reserved',auth.uid());
 insert into public.notifications(user_id,order_id,title,message) values(auth.uid(),result,'Reservation placed',case when p_dropoff is null then 'Your simulated payment is complete. Show your pickup code at the stall.'
   else 'Waiting for a worker to accept. You will receive a refund if the offer expires.' end);
 insert into public.notifications(user_id,order_id,title,message) select owner_id,result,'New reservation','A student reserved a meal at your stall.' from public.stalls where id=p_stall and owner_id is not null and p_dropoff is null;
 return result;
end $$;

create or replace function public.create_reservation(
  p_stall uuid, p_slot uuid, p_items jsonb, p_key uuid, p_notes text,
  p_payment_method text, p_total_centavos integer
) returns uuid language sql security invoker set search_path = ''
return cpugrab_private.create_paid_reservation(p_stall,p_slot,p_items,p_key,p_notes,p_payment_method,p_total_centavos,null::uuid,false);

drop function cpugrab_private.create_paid_reservation(uuid,uuid,jsonb,uuid,text,text,integer);

create function public.create_delivery_reservation(
  p_stall uuid, p_slot uuid, p_items jsonb, p_key uuid, p_notes text,
  p_payment_method text, p_total_centavos integer, p_dropoff uuid, p_group boolean default false
) returns uuid language sql security invoker set search_path = ''
return cpugrab_private.create_paid_reservation(p_stall,p_slot,p_items,p_key,p_notes,p_payment_method,p_total_centavos,p_dropoff,coalesce(p_group,false));

revoke all on function cpugrab_private.make_delivery_pin(),
  cpugrab_private.delivery_candidate(uuid,uuid,uuid,uuid),
  cpugrab_private.matching_delivery_group(uuid,uuid,uuid,uuid),
  cpugrab_private.create_paid_reservation(uuid,uuid,jsonb,uuid,text,text,integer,uuid,boolean),
  public.create_delivery_reservation(uuid,uuid,jsonb,uuid,text,text,integer,uuid,boolean) from public,anon,authenticated;
grant execute on function cpugrab_private.create_paid_reservation(uuid,uuid,jsonb,uuid,text,text,integer,uuid,boolean),
  public.create_delivery_reservation(uuid,uuid,jsonb,uuid,text,text,integer,uuid,boolean) to authenticated;

create function cpugrab_private.cancel_reservation(p_order uuid,p_reason text,p_expired boolean) returns void language plpgsql security definer set search_path='' as $$
declare o public.orders; line record; slot_start timestamptz; delivery public.deliveries; trip uuid;
begin
 select group_id into trip from public.deliveries where order_id=p_order;
 if trip is not null then perform pg_advisory_xact_lock(hashtextextended(trip::text,3)); end if;
 select * into o from public.orders where id=p_order for update;
 if not found then raise exception 'Not authorized'; end if;
 select * into delivery from public.deliveries where order_id=p_order for update;
 if p_expired then
   if delivery.order_id is null or delivery.phase <> 'pending' or delivery.offer_expires_at > clock_timestamp() then return; end if;
 elsif not public.is_active_user() or not (o.student_id=auth.uid() or public.can_manage_stall(o.stall_id)) then
   raise exception 'Not authorized';
 end if;
 if delivery.phase in ('collected','on_the_way','arrived','handover_issue') then
   raise exception 'Contact support about an order already collected by a delivery worker';
 end if;
 if o.status not in ('reserved','ready') or (o.payment_method='cash' and o.payment_status='paid') then raise exception 'This reservation cannot be cancelled'; end if;
 if p_reason is null or length(trim(p_reason)) not between 3 and 500 then raise exception 'Provide a cancellation reason'; end if;
 select start_time into slot_start from public.pickup_slots where id=o.pickup_slot_id for update;
 if not p_expired and o.student_id=auth.uid() and (o.status<>'reserved' or slot_start<=now()+interval '15 minutes') and not public.can_manage_stall(o.stall_id) then raise exception 'Contact the stall to cancel within 15 minutes of pickup or after it is ready'; end if;
 update public.orders set status='cancelled',
  payment_status=case when o.payment_status='paid' then 'refunded' else o.payment_status end,
  cancellation_reason=trim(p_reason),cancelled_at=now(),updated_at=now() where id=p_order;
 update public.deliveries set phase='cancelled' where order_id=p_order;
 update public.pickup_tokens set used_at=now() where order_id=p_order;
 for line in select * from public.order_items where order_id=p_order order by menu_item_id loop update public.menu_items set stock_quantity=stock_quantity+line.quantity where id=line.menu_item_id and stock_quantity is not null; end loop;
 if o.payment_method='wallet' and o.payment_status='paid' then
   perform cpugrab_private.lock_wallet(o.student_id);
   insert into cpugrab_private.simulated_wallet_entries (student_id, kind, reference_id, amount_centavos)
   values (o.student_id, 'order_refund', o.id, o.total_centavos);
 end if;
 insert into public.order_status_history(order_id,previous_status,new_status,changed_by,reason) values(p_order,o.status,'cancelled',auth.uid(),p_reason);
 insert into public.notifications(user_id,order_id,title,message) values(o.student_id,p_order,'Reservation cancelled',
   case o.payment_method
     when 'wallet' then 'Simulated refund credited to your CPUGrab Wallet. '
     when 'gcash' then 'Simulated refund issued to GCash. '
     else ''
   end || trim(p_reason));
 insert into public.notifications(user_id,order_id,title,message) select owner_id,p_order,'Reservation cancelled',p_reason from public.stalls where id=o.stall_id and owner_id is not null;
end $$;

create or replace function public.cancel_order(p_order uuid,p_reason text) returns void
language sql security invoker set search_path = ''
return cpugrab_private.cancel_reservation(p_order,p_reason,false);
revoke all on function cpugrab_private.cancel_reservation(uuid,text,boolean) from public,anon,authenticated;
grant execute on function cpugrab_private.cancel_reservation(uuid,text,boolean) to authenticated;

create or replace function public.mark_order_ready(p_order uuid) returns void language plpgsql security definer set search_path='' as $$
declare o public.orders;
begin
 select * into o from public.orders where id=p_order for update;
 if not found or not public.can_manage_stall(o.stall_id) then raise exception 'Not authorized'; end if;
 if o.status<>'reserved' then raise exception 'Only reserved orders can be marked ready'; end if;
 if o.payment_status<>'paid' then raise exception 'Payment is required before pickup'; end if;
 if exists(select 1 from public.deliveries where order_id=p_order and phase='pending') then
   raise exception 'Wait for the delivery worker to accept before preparing this order';
 end if;
 update public.orders set status='ready',ready_at=now(),updated_at=now() where id=p_order;
 insert into public.order_status_history(order_id,previous_status,new_status,changed_by) values(p_order,o.status,'ready',auth.uid());
 insert into public.notifications(user_id,order_id,title,message) values(o.student_id,p_order,'Your meal is ready!',case when exists(select 1 from public.deliveries where order_id=p_order)
   then 'Your meal is ready for the delivery worker.' else 'Show your pickup QR at the stall.' end);
end $$;

create or replace function public.issue_pickup_token(p_order uuid) returns text language plpgsql security definer set search_path='' as $$
declare o public.orders; token text; expiry timestamptz;
begin
 select * into o from public.orders where id=p_order for update;
 if not found or o.student_id<>auth.uid() or not public.is_active_user() or o.status not in ('reserved','ready') then raise exception 'No active pickup found'; end if;
 if o.payment_status<>'paid' then raise exception 'Payment is required before pickup'; end if;
 if exists(select 1 from public.deliveries where order_id=p_order) then
   raise exception 'Use the customer handover code for campus deliveries';
 end if;
 select end_time+interval '2 hours' into expiry from public.pickup_slots where id=o.pickup_slot_id;
 if expiry<=now() then raise exception 'This pickup code has expired. Contact the stall'; end if;
 token=encode(extensions.gen_random_bytes(32),'hex');
 insert into public.pickup_tokens(order_id,token_hash,expires_at) values(p_order,encode(extensions.digest(token,'sha256'),'hex'),expiry) on conflict(order_id) do update set token_hash=excluded.token_hash,expires_at=excluded.expires_at,created_at=now(),used_at=null;
 return token;
end $$;


create function cpugrab_private.apply_delivery_worker(p_contact text, p_demo_verification text)
returns void language plpgsql security definer set search_path = '' as $$
declare profile public.profiles;
begin
  if not public.has_role('student') then raise exception 'Sign in with an active student account'; end if;
  select * into strict profile from public.profiles where id = auth.uid();
  if nullif(trim(profile.full_name),'') is null or nullif(trim(profile.student_id),'') is null then
    raise exception 'Add your name and student number to your profile first';
  end if;
  insert into public.delivery_workers (user_id, full_name, student_number, contact, demo_verification)
  values (profile.id, trim(profile.full_name), trim(profile.student_id), trim(p_contact), trim(p_demo_verification))
  on conflict (user_id) do update
    set contact = excluded.contact, demo_verification = excluded.demo_verification,
        review_status = 'pending', updated_at = now()
    where delivery_workers.review_status = 'declined';
  if not found then raise exception 'You already have a delivery worker application'; end if;
end;
$$;

create function cpugrab_private.review_delivery_worker(p_student uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role('admin') then raise exception 'Administrator approval is required'; end if;
  if p_status not in ('approved','declined','suspended') or p_status is null then
    raise exception 'Invalid review decision';
  end if;
  update public.delivery_workers
  set review_status = p_status, available_from = null, available_until = null, updated_at = now()
  where user_id = p_student;
  if not found then raise exception 'Delivery worker application not found'; end if;
end;
$$;

create function cpugrab_private.set_delivery_availability(
  p_until timestamptz, p_class timestamptz, p_areas uuid[], p_from timestamptz
) returns void language plpgsql security definer set search_path = '' as $$
declare starts_at timestamptz := greatest(now(),p_from);
begin
  if not public.has_role('student') then raise exception 'Sign in with an active student account'; end if;
  if p_until is not null and (
    p_until <= starts_at or p_until > ((timezone('Asia/Manila',now())::date + 1)::timestamp at time zone 'Asia/Manila')
    or (p_class is not null and p_class <= starts_at)
  ) then raise exception 'Enter a future availability period for today'; end if;
  if exists (
    select 1 from unnest(p_areas) area
    where not exists(select 1 from public.locations l where l.id = area and l.is_active and l.is_delivery_dropoff)
  ) then raise exception 'Choose approved campus drop-off points'; end if;
  update public.delivery_workers set
    available_from = case when p_until is not null then starts_at end,
    available_until = p_until, next_class_at = p_class,
    preferred_areas = coalesce(p_areas, '{}'), updated_at = now()
  where user_id = auth.uid() and review_status = 'approved';
  if not found then raise exception 'Your delivery worker application must be approved first'; end if;
end;
$$;
create function cpugrab_private.delivery_credentials(p_order uuid, p_stage text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare d public.deliveries; c cpugrab_private.delivery_codes;
begin
  if not public.is_active_user() then raise exception 'Sign in to view the code'; end if;
  select * into d from public.deliveries where order_id = p_order;
  select * into c from cpugrab_private.delivery_codes where order_id = p_order;
  if p_stage = 'pickup' and d.worker_id = auth.uid() and d.phase = 'assigned'
    and statement_timestamp() <= d.pickup_end then
    return jsonb_build_object('pin',c.pickup_pin,'qr','cpugrab:delivery-pickup:'||p_order||':'||c.pickup_token);
  end if;
  if p_stage = 'handover' and d.customer_id = auth.uid()
    and (d.phase in ('collected','on_the_way') or (d.phase = 'arrived' and d.wait_until > statement_timestamp())) then
    return jsonb_build_object('pin',c.handover_pin,'qr','cpugrab:delivery-handover:'||p_order||':'||c.handover_token);
  end if;
  raise exception 'This delivery code is unavailable';
end;
$$;

create function cpugrab_private.verify_delivery_code(p_order uuid, p_stage text, p_code text)
returns text language plpgsql set search_path = '' as $$
declare c cpugrab_private.delivery_codes; attempts integer; retry_at timestamptz; matched boolean;
begin
  select * into strict c from cpugrab_private.delivery_codes where order_id=p_order for update;
  if p_stage = 'pickup' then
    attempts := c.pickup_attempts;
    retry_at := c.pickup_retry_at;
    matched := p_code in (c.pickup_pin,c.pickup_token);
  else
    attempts := c.handover_attempts;
    retry_at := c.handover_retry_at;
    matched := p_code in (c.handover_pin,c.handover_token);
  end if;
  if retry_at > clock_timestamp() then return 'locked'; end if;
  if matched then return 'ok'; end if;
  attempts := case when retry_at is not null then 1 else attempts + 1 end;
  retry_at := case when attempts >= 5 then clock_timestamp() + interval '2 minutes' end;
  if p_stage = 'pickup' then
    update cpugrab_private.delivery_codes set pickup_attempts=attempts,pickup_retry_at=retry_at where order_id=p_order;
  else
    update cpugrab_private.delivery_codes set handover_attempts=attempts,handover_retry_at=retry_at where order_id=p_order;
  end if;
  return case when retry_at is not null then 'locked' else 'invalid_code' end;
end;
$$;

create function cpugrab_private.delivery_action(p_order uuid, p_action text, p_value text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  o public.orders; d public.deliveries; w public.delivery_workers;
  actor uuid := auth.uid();
  code_result text;
  minutes integer;
  proposed_wait timestamptz;
  new_phase text;
  trip uuid;
  offer record;
begin
  if not public.is_active_user() then raise exception 'Sign in with an active account'; end if;
  select group_id into trip from public.deliveries where order_id=p_order;
  if trip is not null then perform pg_advisory_xact_lock(hashtextextended(trip::text,3)); end if;
  select * into o from public.orders where id = p_order for update;
  select * into d from public.deliveries where order_id = p_order for update;
  if d.order_id is null or o.payment_status <> 'paid' then raise exception 'Delivery is unavailable'; end if;

  if p_action = 'collect' then
    if not public.can_manage_stall(d.stall_id) then raise exception 'This delivery belongs to another stall'; end if;
    if d.phase <> 'assigned' or o.status <> 'ready' or now() < d.pickup_start - interval '15 minutes'
      or now() >= d.pickup_end then raise exception 'This order is outside its ready pickup window'; end if;
    code_result := cpugrab_private.verify_delivery_code(p_order,'pickup',trim(p_value));
    if code_result <> 'ok' then return code_result; end if;
    new_phase := 'collected';
  elsif p_action in ('request_delay','set_recipient','confirm_ready') then
    if d.customer_id <> actor or d.phase not in ('assigned','collected','on_the_way','arrived')
      or (d.phase='arrived' and d.wait_until <= now()) then
      raise exception 'These delivery options are unavailable';
    end if;
    if p_action = 'set_recipient' then
      update public.deliveries set recipient_name = nullif(trim(p_value),'') where order_id=p_order;
    elsif p_action = 'confirm_ready' then
      update public.deliveries set customer_ready_at=coalesce(customer_ready_at,clock_timestamp()) where order_id=p_order;
    else
      if p_value not in ('5','10','15') or p_value is null then raise exception 'Choose a delay from the list'; end if;
      if d.delay_decision = 'accepted' then raise exception 'A delay is already arranged'; end if;
      update public.deliveries set delay_requested_minutes = p_value::integer, delay_decision = 'pending'
      where order_id=p_order;
    end if;
    return 'ok';
  else
    select * into w from public.delivery_workers where user_id=actor for update;
    if w.review_status is distinct from 'approved' then raise exception 'An approved delivery worker is required'; end if;
    if p_action in ('accept','decline') then
      if d.offered_to <> actor or d.phase <> 'pending' or d.offer_expires_at <= now() then
        raise exception 'This delivery offer is no longer available';
      end if;
      if p_action = 'decline' then
        for offer in select order_id from public.deliveries where phase='pending' and (order_id=p_order or group_id=d.group_id) order by order_id
        loop
          update public.deliveries set offer_expires_at=clock_timestamp() where order_id=offer.order_id;
          perform cpugrab_private.cancel_reservation(offer.order_id,'Delivery worker declined the offer. Please choose individual delivery or self-pickup.',true);
        end loop;
        return 'ok';
      end if;
      if not exists(select 1 from public.locations where id=d.dropoff_id and is_active and is_delivery_dropoff)
        or not exists(select 1 from public.stalls where id=d.stall_id and delivery_enabled and is_open and approval_status='approved')
        or w.available_until is null or w.available_until < d.delivery_until
        or (w.next_class_at is not null and w.next_class_at < d.delivery_until) then
        raise exception 'This delivery no longer fits your availability';
      end if;
      if d.group_id is not null then
        if (select count(*) from public.deliveries where group_id=d.group_id and phase='pending') < 2 then
          raise exception 'At least two students must book this group delivery';
        end if;
        update public.deliveries set worker_id=actor,phase='assigned' where group_id=d.group_id and phase='pending';
        insert into public.notifications(user_id,order_id,title,message)
        select customer_id,order_id,'Group delivery assigned','A worker accepted your group delivery. Your handover code is unique to your order.'
        from public.deliveries where group_id=d.group_id and phase='assigned';
        insert into public.notifications(user_id,order_id,title,message)
        select s.owner_id,job.order_id,'New group delivery reservation','A delivery worker accepted this order as part of a group trip.'
        from public.deliveries job join public.stalls s on s.id=job.stall_id
        where job.group_id=d.group_id and job.phase='assigned' and s.owner_id is not null;
        return 'ok';
      end if;
      update public.deliveries set worker_id=actor where order_id=p_order;
      new_phase := 'assigned';
      insert into public.notifications(user_id,order_id,title,message)
      select owner_id,p_order,'New delivery reservation','A delivery worker accepted this order.'
      from public.stalls where id=d.stall_id and owner_id is not null;
    else
      if d.worker_id is distinct from actor then raise exception 'This delivery is assigned to another worker'; end if;
      if p_action = 'start' and d.phase = 'collected' then
        new_phase := 'on_the_way';
      elsif p_action = 'arrive' and d.phase = 'on_the_way' then
        new_phase := 'arrived';
        update public.deliveries set arrived_at=clock_timestamp(), wait_until=clock_timestamp() + make_interval(
          mins => 5 + case when d.delay_decision = 'accepted' then d.delay_requested_minutes else 0 end
        ) where order_id=p_order;
      elsif p_action = 'handover' and d.phase='arrived' and d.wait_until > clock_timestamp() then
        code_result := cpugrab_private.verify_delivery_code(p_order,'handover',trim(p_value));
        if code_result <> 'ok' then return code_result; end if;
        new_phase := 'completed';
        update public.deliveries set completed_at=clock_timestamp(),settled_at=clock_timestamp(),
          worker_earnings_centavos=compensation_centavos where order_id=p_order;
        update public.orders set status='completed',completed_at=clock_timestamp() where id=p_order;
        insert into public.order_status_history(order_id,previous_status,new_status,changed_by)
        values(p_order,o.status,'completed',actor);
      elsif p_action = 'report_issue' and d.phase='arrived' and d.wait_until <= clock_timestamp() then
        if p_value is null or length(trim(p_value)) not between 3 and 500 then
          raise exception 'Describe your contact attempts before reporting an issue';
        end if;
        update public.deliveries set issue_note=trim(p_value) where order_id=p_order;
        new_phase := 'handover_issue';
      elsif p_action in ('accept_delay','decline_delay') and d.delay_decision='pending'
        and d.phase in ('assigned','collected','on_the_way','arrived') then
        if p_action = 'accept_delay' then
          minutes := d.delay_requested_minutes;
          proposed_wait := coalesce(d.wait_until, d.delivery_until) + make_interval(mins => minutes);
          if d.wait_until <= clock_timestamp() or w.available_until is null or proposed_wait > w.available_until
            or (w.next_class_at is not null and proposed_wait > w.next_class_at)
            or exists (
              select 1 from public.deliveries other
              where other.offered_to=actor and other.order_id<>p_order
                and (d.group_id is null or other.group_id is distinct from d.group_id)
                and ((other.phase='pending' and other.offer_expires_at>now()) or other.phase in ('assigned','collected','on_the_way','arrived'))
                and tstzrange(other.pickup_start-interval '15 minutes',greatest(other.delivery_until,other.wait_until),'[)')
                    && tstzrange(greatest(d.delivery_until,coalesce(d.wait_until,d.delivery_until)),
                      greatest(d.delivery_until,proposed_wait),'[)')
            ) then raise exception 'This delay overlaps your availability or another delivery'; end if;
          update public.deliveries set delay_decision='accepted',
            wait_until = case when d.phase='arrived' then proposed_wait else wait_until end,
            delivery_until = greatest(delivery_until,proposed_wait) where order_id=p_order;
        else
          update public.deliveries set delay_decision='declined' where order_id=p_order;
        end if;
        insert into public.notifications(user_id,order_id,title,message)
        values(d.customer_id,p_order,'Delivery delay request',
          case when p_action='accept_delay' then 'Your worker accepted the delay.' else 'Your worker could not accept the delay.' end);
        return 'ok';
      else
        raise exception 'This action is unavailable for the current delivery status';
      end if;
    end if;
  end if;

  update public.deliveries set phase=new_phase where order_id=p_order;
  insert into public.notifications(user_id,order_id,title,message)
  values (d.customer_id,p_order,'Campus delivery update',
    case new_phase
      when 'assigned' then 'Your delivery worker accepted the order.'
      when 'collected' then 'Your delivery worker collected the meal.'
      when 'on_the_way' then 'Your delivery worker is on the way.'
      when 'arrived' then 'Your delivery worker is at the campus drop-off point.'
      when 'completed' then 'Your meal was handed over and your delivery is complete.'
      else 'Your handover needs administrator review.'
    end);
  return 'ok';
end;
$$;

create function cpugrab_private.expire_delivery_offers() returns void
language plpgsql security definer set search_path = '' as $$
declare job record;
begin
  for job in select order_id from public.deliveries where phase='pending' and offer_expires_at <= clock_timestamp()
  loop
    perform cpugrab_private.cancel_reservation(job.order_id,'No worker accepted in time. Choose another time or self-pickup.',true);
  end loop;
end;
$$;

-- Supabase-hosted projects provide pg_cron. The local SQL test runtime does not.
do $$
begin
  if exists(select 1 from pg_available_extensions where name='pg_cron') then
    create extension if not exists pg_cron;
    execute $schedule$select cron.schedule('cpugrab-expire-delivery-offers','* * * * *',
      'select cpugrab_private.expire_delivery_offers()')$schedule$;
  end if;
end;
$$;

revoke all on function cpugrab_private.verify_delivery_code(uuid,text,text),
  cpugrab_private.expire_delivery_offers() from public,anon,authenticated;

create function public.delivery_options(p_stall uuid, p_slot uuid, p_group boolean default false) returns uuid[]
language sql stable security invoker set search_path = ''
return cpugrab_private.delivery_options(p_stall,p_slot,p_group);
revoke all on function cpugrab_private.delivery_options(uuid,uuid,boolean), public.delivery_options(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function cpugrab_private.delivery_options(uuid,uuid,boolean), public.delivery_options(uuid,uuid,boolean) to authenticated;

create function public.apply_delivery_worker(p_contact text, p_demo_verification text) returns void
language sql security invoker set search_path = ''
return cpugrab_private.apply_delivery_worker(p_contact,p_demo_verification);
revoke all on function cpugrab_private.apply_delivery_worker(text,text), public.apply_delivery_worker(text,text) from public,anon,authenticated;
grant execute on function cpugrab_private.apply_delivery_worker(text,text), public.apply_delivery_worker(text,text) to authenticated;

create function public.review_delivery_worker(p_student uuid, p_status text) returns void
language sql security invoker set search_path = ''
return cpugrab_private.review_delivery_worker(p_student,p_status);
revoke all on function cpugrab_private.review_delivery_worker(uuid,text), public.review_delivery_worker(uuid,text) from public,anon,authenticated;
grant execute on function cpugrab_private.review_delivery_worker(uuid,text), public.review_delivery_worker(uuid,text) to authenticated;

create function public.set_delivery_availability(p_until timestamptz, p_class timestamptz, p_areas uuid[], p_from timestamptz default null) returns void
language sql security invoker set search_path = ''
return cpugrab_private.set_delivery_availability(p_until,p_class,p_areas,p_from);
revoke all on function cpugrab_private.set_delivery_availability(timestamptz,timestamptz,uuid[],timestamptz), public.set_delivery_availability(timestamptz,timestamptz,uuid[],timestamptz) from public,anon,authenticated;
grant execute on function cpugrab_private.set_delivery_availability(timestamptz,timestamptz,uuid[],timestamptz), public.set_delivery_availability(timestamptz,timestamptz,uuid[],timestamptz) to authenticated;

create function public.delivery_credentials(p_order uuid, p_stage text) returns jsonb
language sql stable security invoker set search_path = ''
return cpugrab_private.delivery_credentials(p_order,p_stage);
revoke all on function cpugrab_private.delivery_credentials(uuid,text), public.delivery_credentials(uuid,text) from public,anon,authenticated;
grant execute on function cpugrab_private.delivery_credentials(uuid,text), public.delivery_credentials(uuid,text) to authenticated;

create function public.delivery_action(p_order uuid, p_action text, p_value text) returns text
language sql security invoker set search_path = ''
return cpugrab_private.delivery_action(p_order,p_action,p_value);
revoke all on function cpugrab_private.delivery_action(uuid,text,text), public.delivery_action(uuid,text,text) from public,anon,authenticated;
grant execute on function cpugrab_private.delivery_action(uuid,text,text), public.delivery_action(uuid,text,text) to authenticated;

create function cpugrab_private.resolve_delivery_issue(p_order uuid, p_refund boolean, p_compensate boolean, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.orders; d public.deliveries;
begin
  if not public.has_role('admin') then raise exception 'Administrator access is required'; end if;
  if p_refund is null or p_compensate is null or p_reason is null or length(trim(p_reason)) not between 3 and 500 then
    raise exception 'Provide a resolution reason';
  end if;
  select * into o from public.orders where id=p_order for update;
  select * into d from public.deliveries where order_id=p_order for update;
  if d.phase is distinct from 'handover_issue' or o.payment_status <> 'paid' then
    raise exception 'This delivery has no open handover issue';
  end if;
  update public.orders set status='cancelled', cancelled_at=clock_timestamp(), cancellation_reason=trim(p_reason),
    payment_status=case when p_refund then 'refunded' else payment_status end where id=p_order;
  if p_refund and o.payment_method='wallet' then
    perform cpugrab_private.lock_wallet(o.student_id);
    insert into cpugrab_private.simulated_wallet_entries(student_id,kind,reference_id,amount_centavos)
    values(o.student_id,'order_refund',p_order,o.total_centavos);
  end if;
  update public.deliveries set phase='unsuccessful',settled_at=clock_timestamp(),
    worker_earnings_centavos=case when p_compensate then compensation_centavos else 0 end where order_id=p_order;
  insert into public.order_status_history(order_id,previous_status,new_status,changed_by,reason)
  values(p_order,o.status,'cancelled',auth.uid(),trim(p_reason));
  insert into public.notifications(user_id,order_id,title,message)
  values(o.student_id,p_order,'Handover issue resolved',trim(p_reason) || case
    when p_refund and o.payment_method='wallet' then ' A simulated refund was credited to your wallet.'
    when p_refund and o.payment_method='gcash' then ' A simulated GCash refund was issued.'
    else '' end);
end;
$$;

create function public.resolve_delivery_issue(p_order uuid, p_refund boolean, p_compensate boolean, p_reason text)
returns void language sql security invoker set search_path = ''
return cpugrab_private.resolve_delivery_issue(p_order,p_refund,p_compensate,p_reason);
revoke all on function cpugrab_private.resolve_delivery_issue(uuid,boolean,boolean,text),
  public.resolve_delivery_issue(uuid,boolean,boolean,text) from public,anon,authenticated;
grant execute on function cpugrab_private.resolve_delivery_issue(uuid,boolean,boolean,text),
  public.resolve_delivery_issue(uuid,boolean,boolean,text) to authenticated;
