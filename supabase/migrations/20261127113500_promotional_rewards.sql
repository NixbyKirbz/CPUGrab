create table cpugrab_private.reward_policy (
  id boolean primary key default true check(id),
  orders_required integer not null default 5 check(orders_required between 1 and 100),
  reward_centavos integer not null default 500 check(reward_centavos between 1 and 50000),
  budget_centavos integer not null default 0 check(budget_centavos>=0),
  started_at timestamptz not null default now()
);
insert into cpugrab_private.reward_policy default values;

create table cpugrab_private.rewards (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id),
  amount_centavos integer not null check(amount_centavos>0),
  orders_required integer not null check(orders_required>0),
  redeemed_order_id uuid unique references public.orders(id),
  revoked_at timestamptz,
  issued_at timestamptz not null default now()
);
create index rewards_student_idx on cpugrab_private.rewards(student_id,issued_at);
create table cpugrab_private.reward_history (
  id uuid primary key default gen_random_uuid(),
  reward_id uuid not null references cpugrab_private.rewards(id),
  order_id uuid references public.orders(id),
  action text not null check(action in ('earned','redeemed','restored','revoked')),
  created_at timestamptz not null default now()
);
create index reward_history_reward_idx on cpugrab_private.reward_history(reward_id,created_at);
alter table cpugrab_private.reward_policy enable row level security;
alter table cpugrab_private.rewards enable row level security;
alter table cpugrab_private.reward_history enable row level security;
revoke all on cpugrab_private.reward_policy,cpugrab_private.rewards,cpugrab_private.reward_history from public,anon,authenticated;

alter table public.orders add column reward_id uuid references cpugrab_private.rewards(id),
  add column reward_discount_centavos integer not null default 0 check(reward_discount_centavos>=0),
  drop constraint order_total_includes_delivery,
  add constraint order_total_includes_delivery check(
    total_centavos=subtotal_centavos+markup_centavos+reservation_fee_centavos+delivery_fee_centavos-reward_discount_centavos
    and (reward_id is null)=(reward_discount_centavos=0) and total_centavos>0
    or (reward_id is null and reward_discount_centavos=0 and total_centavos=0
      and subtotal_centavos+markup_centavos+reservation_fee_centavos+delivery_fee_centavos=0)
  );
create index orders_reward_eligibility_idx on public.orders(student_id,completed_at)
where status='completed' and payment_status='paid' and payment_method in ('gcash','wallet');

create function cpugrab_private.reward_eligible_count(p_student uuid,p_started timestamptz) returns bigint
language sql stable set search_path='' as $$
  select count(*) from public.orders
    where student_id=p_student and completed_at>=p_started and status='completed' and payment_status='paid'
      and payment_method in ('gcash','wallet');
$$;

create function cpugrab_private.sync_promotional_rewards() returns trigger
language plpgsql security definer set search_path='' as $$
declare settings cpugrab_private.reward_policy; available_orders bigint; applied bigint; budget_used bigint;
  reward uuid; prior cpugrab_private.rewards; transition_to_eligible boolean;
begin
  transition_to_eligible:=new.status='completed' and new.payment_status='paid'
    and (old.status<>'completed' or old.payment_status<>'paid') and new.payment_method in ('gcash','wallet');
  if not transition_to_eligible and not (old.payment_status='paid' and new.payment_status='refunded') then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.student_id::text,15));
  select * into settings from cpugrab_private.reward_policy where id for update;
  if new.payment_status='refunded' then
    update cpugrab_private.rewards set redeemed_order_id=null where redeemed_order_id=new.id returning id into reward;
    if reward is not null then
      insert into cpugrab_private.reward_history(reward_id,order_id,action) values(reward,new.id,'restored');
    end if;
  end if;
  available_orders:=cpugrab_private.reward_eligible_count(new.student_id,settings.started_at);
  select coalesce(sum(orders_required),0) into applied from cpugrab_private.rewards
    where student_id=new.student_id and revoked_at is null;
  if new.payment_status='refunded' then
    for prior in select * from cpugrab_private.rewards where student_id=new.student_id and redeemed_order_id is null and revoked_at is null
      order by issued_at desc,id for update loop
      exit when applied<=available_orders;
      update cpugrab_private.rewards set revoked_at=clock_timestamp() where id=prior.id;
      insert into cpugrab_private.reward_history(reward_id,order_id,action) values(prior.id,new.id,'revoked');
      applied:=applied-prior.orders_required;
    end loop;
    return new;
  end if;
  if settings.budget_centavos<=0 or available_orders-applied<settings.orders_required then return new; end if;
  select coalesce(sum(amount_centavos),0) into budget_used from cpugrab_private.rewards where revoked_at is null;
  if budget_used+settings.reward_centavos<=settings.budget_centavos then
    insert into cpugrab_private.rewards(student_id,amount_centavos,orders_required)
    values(new.student_id,settings.reward_centavos,settings.orders_required) returning id into reward;
    insert into cpugrab_private.reward_history(reward_id,order_id,action) values(reward,new.id,'earned');
    insert into public.notifications(user_id,order_id,title,message)
    values(new.student_id,new.id,'You earned a CPUGrab reward','Apply your promotional discount at checkout.');
  end if;
  return new;
end;
$$;
create trigger sync_promotional_rewards after update of status,payment_status on public.orders
for each row execute function cpugrab_private.sync_promotional_rewards();

create function cpugrab_private.student_rewards() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare settings cpugrab_private.reward_policy; eligible bigint; applied bigint;
begin
  if not public.has_role('student') then raise exception 'Student access is required'; end if;
  select * into settings from cpugrab_private.reward_policy where id;
  eligible:=cpugrab_private.reward_eligible_count(auth.uid(),settings.started_at);
  select coalesce(sum(orders_required),0) into applied from cpugrab_private.rewards where student_id=auth.uid() and revoked_at is null;
  return jsonb_build_object(
    'eligible',eligible,'progress',greatest(eligible-applied,0),'threshold',settings.orders_required,
    'reward_centavos',settings.reward_centavos,'funded',settings.budget_centavos>0,
    'available',coalesce((select jsonb_agg(jsonb_build_object('id',id,'amount_centavos',amount_centavos) order by issued_at,id)
      from cpugrab_private.rewards where student_id=auth.uid() and redeemed_order_id is null and revoked_at is null),'[]'::jsonb),
    'history',coalesce((select jsonb_agg(to_jsonb(entry) order by created_at desc) from (
      select h.id,h.action,h.created_at,h.order_id,r.amount_centavos
      from cpugrab_private.reward_history h join cpugrab_private.rewards r on r.id=h.reward_id
      where r.student_id=auth.uid() order by h.created_at desc limit 50
    ) entry),'[]'::jsonb)
  );
end;
$$;

create function cpugrab_private.reward_admin(p_threshold integer,p_reward integer,p_budget integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare settings cpugrab_private.reward_policy; spent bigint; redemptions bigint;
  customers bigint; repeat_customers bigint; order_count bigint; satisfaction numeric;
begin
  if not public.has_role('admin') then raise exception 'Administrator access is required'; end if;
  select * into settings from cpugrab_private.reward_policy where id for update;
  select coalesce(sum(amount_centavos),0),count(redeemed_order_id) into spent,redemptions
    from cpugrab_private.rewards where revoked_at is null;
  if p_threshold is not null then
    if p_budget<spent then raise exception 'Budget cannot be below rewards already committed'; end if;
    update cpugrab_private.reward_policy set orders_required=p_threshold,reward_centavos=p_reward,budget_centavos=p_budget
    where id returning * into settings;
  end if;
  select count(*),count(*) filter(where meals>1),coalesce(sum(meals),0) into customers,repeat_customers,order_count
  from (select count(*) meals from public.orders where status='completed' and payment_status='paid' group by student_id) reservations;
  select round(avg((quality+temperature+packaging+accuracy+experience)::numeric/5),2) into satisfaction
    from public.order_reviews;
  return jsonb_build_object('threshold',settings.orders_required,'reward_centavos',settings.reward_centavos,
    'budget_centavos',settings.budget_centavos,'committed_centavos',spent,'redemptions',redemptions,
    'customers',customers,'repeat_customers',repeat_customers,'completed_orders',order_count,'satisfaction',satisfaction);
end;
$$;

create function public.student_rewards() returns jsonb
language sql stable security invoker set search_path='' return cpugrab_private.student_rewards();
create function public.reward_admin(p_threshold integer default null,p_reward integer default null,p_budget integer default null) returns jsonb
language sql security invoker set search_path='' return cpugrab_private.reward_admin(p_threshold,p_reward,p_budget);
revoke all on function cpugrab_private.sync_promotional_rewards(),cpugrab_private.reward_eligible_count(uuid,timestamptz),
  cpugrab_private.student_rewards(),public.student_rewards(),cpugrab_private.reward_admin(integer,integer,integer),
  public.reward_admin(integer,integer,integer) from public,anon,authenticated;
grant execute on function cpugrab_private.student_rewards(),public.student_rewards(),
  cpugrab_private.reward_admin(integer,integer,integer),public.reward_admin(integer,integer,integer) to authenticated;

create function cpugrab_private.create_paid_reservation(p_stall uuid,p_slot uuid,p_items jsonb,p_key uuid,p_notes text, p_payment_method text, p_total_centavos integer,p_dropoff uuid,p_group boolean,p_reward uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare existing public.orders; total integer; slot public.pickup_slots; settings public.platform_settings; item public.menu_items; line record; qty integer; subtotal integer:=0; markup integer:=0; result uuid; checked_at timestamptz; delivery_fee integer := 0; offered_worker uuid; new_pickup_pin text; new_handover_pin text;
  matched_group record; delivery_group uuid; deadline timestamptz; discount integer:=0;
begin
 if not public.has_role('student') then raise exception 'Sign in with an active student account'; end if;
 if p_key is null or p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 50 or p_notes is null or length(p_notes)>500 then raise exception 'Invalid reservation request'; end if;
 if p_payment_method is null or p_payment_method not in ('gcash','wallet') then raise exception 'Choose GCash or CPUGrab Wallet'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_key::text,0));
 select * into existing from public.orders where student_id=auth.uid() and idempotency_key=p_key;
 if found then
   if (select dropoff_id from public.deliveries where order_id=existing.id) is distinct from p_dropoff
      or (exists(select 1 from public.deliveries where order_id=existing.id and group_id is not null)) is distinct from p_group
      or existing.reward_id is distinct from p_reward
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
 if p_reward is not null then
   select r.amount_centavos into discount from cpugrab_private.rewards r
   where r.id=p_reward and r.student_id=auth.uid() and r.redeemed_order_id is null and r.revoked_at is null for update;
   if not found or discount>=total then raise exception 'This reward is unavailable for this order'; end if;
   total:=total-discount;
 end if;
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
   customer_notes, payment_method, payment_status, delivery_fee_centavos, reward_id, reward_discount_centavos
 ) values (
   auth.uid(), p_stall, p_slot, p_key, subtotal, markup, settings.reservation_fee_centavos,
   settings.stall_fee_share_centavos, settings.platform_fee_share_centavos, total, p_notes,
   p_payment_method, 'paid', delivery_fee, p_reward, discount
 ) returning id into result;
 if p_reward is not null then
   update cpugrab_private.rewards set redeemed_order_id=result where id=p_reward;
   insert into cpugrab_private.reward_history(reward_id,order_id,action) values(p_reward,result,'redeemed');
 end if;
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

-- The existing checkout entry points use the same validation and pricing without a reward.
create or replace function cpugrab_private.create_paid_reservation(
  p_stall uuid,p_slot uuid,p_items jsonb,p_key uuid,p_notes text,p_payment_method text,
  p_total_centavos integer,p_dropoff uuid,p_group boolean
) returns uuid
language sql security invoker set search_path=''
return cpugrab_private.create_paid_reservation(p_stall,p_slot,p_items,p_key,p_notes,p_payment_method,p_total_centavos,p_dropoff,p_group,null::uuid);

create function public.create_reward_reservation(
  p_stall uuid,p_slot uuid,p_items jsonb,p_key uuid,p_notes text,p_payment_method text,
  p_total_centavos integer,p_dropoff uuid,p_group boolean,p_reward uuid
) returns uuid
language sql security invoker set search_path=''
return cpugrab_private.create_paid_reservation(p_stall,p_slot,p_items,p_key,p_notes,p_payment_method,p_total_centavos,p_dropoff,p_group,p_reward);
revoke all on function cpugrab_private.create_paid_reservation(uuid,uuid,jsonb,uuid,text,text,integer,uuid,boolean,uuid),
  public.create_reward_reservation(uuid,uuid,jsonb,uuid,text,text,integer,uuid,boolean,uuid) from public,anon,authenticated;
grant execute on function cpugrab_private.create_paid_reservation(uuid,uuid,jsonb,uuid,text,text,integer,uuid,boolean,uuid),
  public.create_reward_reservation(uuid,uuid,jsonb,uuid,text,text,integer,uuid,boolean,uuid) to authenticated;
