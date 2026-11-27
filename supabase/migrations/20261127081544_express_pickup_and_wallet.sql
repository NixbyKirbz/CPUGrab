create table cpugrab_private.pickup_pin_key (
  id boolean primary key default true check (id),
  secret text not null
);
insert into cpugrab_private.pickup_pin_key(secret) values (encode(extensions.gen_random_bytes(32),'hex'));

create table cpugrab_private.pickup_pins (
  order_id uuid primary key references public.orders(id),
  stall_id uuid not null references public.stalls(id),
  digest bytea not null,
  encrypted_token bytea not null,
  expires_at timestamptz not null,
  unique (stall_id,digest)
);
create table cpugrab_private.pickup_pin_attempts (
  verifier uuid primary key references public.profiles(id) on delete cascade,
  started_at timestamptz not null,
  attempts integer not null
);
alter table cpugrab_private.pickup_pin_key enable row level security;
alter table cpugrab_private.pickup_pins enable row level security;
alter table cpugrab_private.pickup_pin_attempts enable row level security;
revoke all on cpugrab_private.pickup_pin_key,cpugrab_private.pickup_pins,cpugrab_private.pickup_pin_attempts
from public,anon,authenticated;

create function cpugrab_private.issue_pickup_credentials(p_order uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  token text;
  pin text;
  key text;
  stall uuid;
  expiry timestamptz;
begin
  -- The existing generator checks payment, order ownership, and pickup eligibility.
  token := public.issue_pickup_token(p_order);
  select stall_id into strict stall from public.orders where id=p_order;
  select expires_at into strict expiry from public.pickup_tokens where order_id=p_order;
  select secret into strict key from cpugrab_private.pickup_pin_key;
  delete from cpugrab_private.pickup_pins
  where order_id=p_order;
  -- Expired entries are ignored during lookup and recycled if the random PIN collides.
  for attempt in 1..24 loop
    pin := cpugrab_private.make_delivery_pin();
    insert into cpugrab_private.pickup_pins(order_id,stall_id,digest,encrypted_token,expires_at)
    values (p_order,stall,extensions.hmac(pin,key,'sha256'),extensions.pgp_sym_encrypt(token,key),expiry)
    on conflict (stall_id,digest) do update
      set order_id=excluded.order_id,encrypted_token=excluded.encrypted_token,expires_at=excluded.expires_at
      where pickup_pins.expires_at <= clock_timestamp();
    if found then return jsonb_build_object('token',token,'pin',pin); end if;
  end loop;
  raise exception 'Could not allocate a pickup PIN. Try again.';
end;
$$;

create function cpugrab_private.verify_pickup_pin(p_stall uuid,p_pin text,p_confirm boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  actor uuid := auth.uid();
  key text;
  token text;
  result jsonb;
  rate cpugrab_private.pickup_pin_attempts;
begin
  if actor is null or not public.can_manage_stall(p_stall) then raise exception 'Stall access required'; end if;
  if p_pin is null or p_pin !~ '^[0-9]{6}$' or p_confirm is null then
    return jsonb_build_object('error','Enter the six-digit pickup PIN');
  end if;
  insert into cpugrab_private.pickup_pin_attempts(verifier,started_at,attempts)
  values(actor,clock_timestamp(),0)
  on conflict(verifier) do nothing;
  select * into strict rate from cpugrab_private.pickup_pin_attempts where verifier=actor for update;
  if rate.started_at <= clock_timestamp()-interval '2 minutes' then
    update cpugrab_private.pickup_pin_attempts set started_at=clock_timestamp(),attempts=0 where verifier=actor;
  elsif rate.attempts >= 8 then
    return jsonb_build_object('error','Too many incorrect attempts. Try again in two minutes.');
  end if;
  select secret into strict key from cpugrab_private.pickup_pin_key;
  select extensions.pgp_sym_decrypt(p.encrypted_token,key) into token
  from cpugrab_private.pickup_pins p join public.pickup_tokens t on t.order_id=p.order_id
  where p.stall_id=p_stall and p.digest=extensions.hmac(p_pin,key,'sha256')
    and p.expires_at>clock_timestamp() and t.used_at is null;
  if token is not null then
    begin
      if p_confirm then result := cpugrab_private.redeem_paid_pickup(token);
      else result := public.inspect_pickup_token(token); end if;
      return result;
    exception when raise_exception then
      return jsonb_build_object('error',sqlerrm);
    end;
  end if;
  update cpugrab_private.pickup_pin_attempts set attempts=attempts+1 where verifier=actor;
  return jsonb_build_object('error','This PIN is invalid, expired, or already used');
end;
$$;

create function cpugrab_private.find_pickups_by_student(p_stall uuid,p_student_number text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.can_manage_stall(p_stall) then raise exception 'Stall access required'; end if;
  if length(trim(p_student_number)) not between 3 and 40 then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(row_to_json(matches)) from (
      select o.id,o.order_number,s.start_time,o.payment_status
      from public.orders o join public.profiles p on p.id=o.student_id
      join public.pickup_slots s on s.id=o.pickup_slot_id
      where o.stall_id=p_stall and lower(trim(p.student_id))=lower(trim(p_student_number))
        and o.payment_status='paid' and o.status in ('reserved','ready')
        and not exists(select 1 from public.deliveries d where d.order_id=o.id)
      order by s.start_time limit 10
    ) matches
  ),'[]'::jsonb);
end;
$$;

alter table public.orders add column payment_reference uuid unique, add column refund_reference uuid unique;
update public.orders
set payment_reference=gen_random_uuid(),
    refund_reference=case when payment_status='refunded' then gen_random_uuid() end
where payment_method in ('wallet','gcash') and payment_status in ('paid','refunded');

create function cpugrab_private.set_simulated_payment_references() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.payment_method in ('wallet','gcash') and new.payment_status in ('paid','refunded') then
    new.payment_reference:=coalesce(new.payment_reference,gen_random_uuid());
    if new.payment_status='refunded' then
      new.refund_reference:=coalesce(new.refund_reference,gen_random_uuid());
    end if;
  end if;
  return new;
end;
$$;
create trigger simulated_payment_references before insert or update of payment_status on public.orders
for each row execute function cpugrab_private.set_simulated_payment_references();

create table cpugrab_private.gcash_payment_attempts (
  student_id uuid not null references public.profiles(id) on delete cascade,
  reference_id uuid primary key default gen_random_uuid(),
  request_key uuid not null,
  amount_centavos integer not null check(amount_centavos >= 0),
  status text not null check(status in ('failed','cancelled')),
  created_at timestamptz not null default now(),
  unique(student_id,request_key)
);
alter table cpugrab_private.gcash_payment_attempts enable row level security;
revoke all on cpugrab_private.gcash_payment_attempts from public,anon,authenticated;

create function cpugrab_private.record_gcash_attempt(p_key uuid,p_amount integer,p_status text) returns uuid
language plpgsql security definer set search_path='' as $$
declare payment_id uuid;
begin
  if not public.has_role('student') then raise exception 'An active student account is required'; end if;
  insert into cpugrab_private.gcash_payment_attempts as a(student_id,request_key,amount_centavos,status)
  values(auth.uid(),p_key,p_amount,p_status)
  on conflict(student_id,request_key) do update set request_key=excluded.request_key
    where a.amount_centavos=excluded.amount_centavos and a.status=excluded.status
  returning reference_id into payment_id;
  if payment_id is null then raise exception 'This simulation attempt was already recorded'; end if;
  return payment_id;
end;
$$;

alter table cpugrab_private.simulated_wallet_entries add column reason text;
create function cpugrab_private.wallet_history(p_page integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.has_role('student') then raise exception 'An active student account is required'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(activity)) from (
      select * from (
        select e.kind,e.amount_centavos,e.created_at,e.reason,e.reference_id as reference,
          case when e.kind in ('order_payment','order_refund') then e.reference_id end as order_id,
          'wallet'::text as method
        from cpugrab_private.simulated_wallet_entries e where e.student_id=auth.uid()
        union all
        select 'order_payment',-o.total_centavos,o.created_at,null,o.payment_reference,o.id,'gcash'
        from public.orders o where o.student_id=auth.uid() and o.payment_method='gcash' and o.payment_reference is not null
        union all
        select 'order_refund',o.total_centavos,coalesce(o.cancelled_at,o.updated_at),o.cancellation_reason,o.refund_reference,o.id,'gcash'
        from public.orders o where o.student_id=auth.uid() and o.payment_method='gcash' and o.refund_reference is not null
        union all
        select a.status,-a.amount_centavos,a.created_at,null,a.reference_id,null,'gcash'
        from cpugrab_private.gcash_payment_attempts a where a.student_id=auth.uid()
      ) all_activity
      order by created_at desc,reference,kind limit 20 offset (greatest(0,least(coalesce(p_page,0),500)) * 20)
    ) activity
  ),'[]'::jsonb);
end;
$$;

revoke all on function cpugrab_private.set_simulated_payment_references() from public,anon,authenticated;

create function public.issue_pickup_credentials(p_order uuid) returns jsonb
language sql security invoker set search_path=''
return cpugrab_private.issue_pickup_credentials(p_order);
revoke all on function public.issue_pickup_credentials(uuid),cpugrab_private.issue_pickup_credentials(uuid) from public,anon,authenticated;
grant execute on function public.issue_pickup_credentials(uuid),cpugrab_private.issue_pickup_credentials(uuid) to authenticated;

create function public.verify_pickup_pin(p_stall uuid,p_pin text,p_confirm boolean) returns jsonb
language sql security invoker set search_path=''
return cpugrab_private.verify_pickup_pin(p_stall,p_pin,p_confirm);
revoke all on function public.verify_pickup_pin(uuid,text,boolean),cpugrab_private.verify_pickup_pin(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.verify_pickup_pin(uuid,text,boolean),cpugrab_private.verify_pickup_pin(uuid,text,boolean) to authenticated;

create function public.find_pickups_by_student(p_stall uuid,p_student_number text) returns jsonb
language sql security invoker set search_path=''
return cpugrab_private.find_pickups_by_student(p_stall,p_student_number);
revoke all on function public.find_pickups_by_student(uuid,text),cpugrab_private.find_pickups_by_student(uuid,text) from public,anon,authenticated;
grant execute on function public.find_pickups_by_student(uuid,text),cpugrab_private.find_pickups_by_student(uuid,text) to authenticated;

create function public.record_gcash_attempt(p_key uuid,p_amount integer,p_status text) returns uuid
language sql security invoker set search_path=''
return cpugrab_private.record_gcash_attempt(p_key,p_amount,p_status);
revoke all on function public.record_gcash_attempt(uuid,integer,text),cpugrab_private.record_gcash_attempt(uuid,integer,text) from public,anon,authenticated;
grant execute on function public.record_gcash_attempt(uuid,integer,text),cpugrab_private.record_gcash_attempt(uuid,integer,text) to authenticated;

create function public.wallet_history(p_page integer) returns jsonb
language sql security invoker set search_path=''
return cpugrab_private.wallet_history(p_page);
revoke all on function public.wallet_history(integer),cpugrab_private.wallet_history(integer) from public,anon,authenticated;
grant execute on function public.wallet_history(integer),cpugrab_private.wallet_history(integer) to authenticated;
