alter table public.stalls
  add column reservation_mode text not null default 'normal' check(reservation_mode in ('normal','busy','paused')),
  add column busy_order_limit integer not null default 5 check(busy_order_limit between 1 and 500),
  add column reservation_opens_at time not null default '07:00',
  add column reservation_closes_at time not null default '17:00',
  add constraint stalls_reservation_hours check(
    reservation_opens_at >= '07:00' and reservation_closes_at <= '17:00'
    and reservation_opens_at < reservation_closes_at
  );
alter table public.pickup_slots add column max_portions integer not null default 10000 check(max_portions between 1 and 10000);
alter table public.menu_items add column preparation_minutes integer not null default 10 check(preparation_minutes between 1 and 120);
grant update (reservation_mode,busy_order_limit,reservation_opens_at,reservation_closes_at) on public.stalls to authenticated;
grant update (max_portions) on public.pickup_slots to authenticated;
grant update (preparation_minutes) on public.menu_items to authenticated;

create function cpugrab_private.slot_usage(p_stall uuid, p_slot uuid)
returns table (
  id uuid,start_time timestamptz,end_time timestamptz,max_reservations integer,
  remaining bigint,portions_left bigint,availability text
) language sql stable set search_path='' as $$
  with supply as (
    select s.id,s.start_time,s.end_time,s.max_portions,
      case when st.reservation_mode='busy' then least(st.busy_order_limit,s.max_reservations)
           else s.max_reservations end as max_reservations,
      s.is_active and st.is_open and l.is_active and st.approval_status='approved'
      and st.reservation_mode<>'paused' and s.start_time>statement_timestamp()
      and timezone('Asia/Manila',s.start_time)::date=timezone('Asia/Manila',statement_timestamp())::date
      and timezone('Asia/Manila',s.end_time)::date=timezone('Asia/Manila',s.start_time)::date
      and timezone('Asia/Manila',s.start_time)::time>=st.reservation_opens_at
      and timezone('Asia/Manila',s.end_time)::time<=st.reservation_closes_at as usable
    from public.pickup_slots s join public.stalls st on st.id=s.stall_id
    join public.locations l on l.id=st.location_id
    where s.stall_id=p_stall and ($2 is null or s.id=$2)
      and timezone('Asia/Manila',s.start_time)::date=timezone('Asia/Manila',statement_timestamp())::date
  ), counters as (
    select supply.*,count(distinct o.id) as orders,coalesce(sum(i.quantity),0) as portions
    from supply
    left join public.orders o on o.pickup_slot_id=supply.id and o.status<>'cancelled'
    left join public.order_items i on i.order_id=o.id
    group by supply.id,supply.start_time,supply.end_time,supply.max_portions,supply.max_reservations,supply.usable
  )
  select id,start_time,end_time,max_reservations,greatest(max_reservations-orders,0),greatest(max_portions-portions,0),
    case when not usable then 'unavailable'
      when orders>=max_reservations or portions>=max_portions then 'full'
      when max_reservations-orders<=3 or max_portions-portions<=5 then 'limited'
      else 'available' end
  from counters order by start_time;
$$;

create or replace function public.available_pickup_slots(p_stall uuid)
returns table(id uuid, start_time timestamptz, end_time timestamptz, max_reservations integer, remaining bigint)
language sql stable security definer set search_path='' as $$
  select u.id,u.start_time,u.end_time,u.max_reservations,u.remaining
  from cpugrab_private.slot_usage(p_stall,null) u
  where u.availability in ('available','limited');
$$;

create function cpugrab_private.pickup_schedule(p_stall uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(to_jsonb(rows) order by rows.start_time),'[]'::jsonb)
  from cpugrab_private.slot_usage(p_stall,null) rows
  where public.has_role('student') and exists(
    select 1 from public.stalls s join public.locations l on l.id=s.location_id
    where s.id=p_stall and s.approval_status='approved' and l.is_active
  );
$$;
create function public.pickup_schedule(p_stall uuid) returns jsonb
language sql stable security invoker set search_path=''
return cpugrab_private.pickup_schedule(p_stall);
revoke all on function cpugrab_private.pickup_schedule(uuid),public.pickup_schedule(uuid) from public,anon,authenticated;
grant execute on function cpugrab_private.pickup_schedule(uuid),public.pickup_schedule(uuid) to authenticated;

create function cpugrab_private.guard_paid_slot_capacity() returns trigger
language plpgsql set search_path='' as $$
declare usage record;
begin
  if new.payment_method not in ('gcash','wallet') then return new; end if;
  perform 1 from public.pickup_slots where id=new.pickup_slot_id for update;
  select * into usage from cpugrab_private.slot_usage(new.stall_id,new.pickup_slot_id);
  if usage.availability is null or usage.availability='unavailable' then
    raise exception 'This pickup period is unavailable. Choose another time.';
  end if;
  if usage.availability='full' then raise exception 'This pickup slot is full. Choose another time'; end if;
  return new;
end;
$$;
create trigger enforce_paid_slot_capacity before insert on public.orders
for each row execute function cpugrab_private.guard_paid_slot_capacity();

create function cpugrab_private.guard_portions() returns trigger
language plpgsql set search_path='' as $$
declare slot_id uuid; stall_id uuid; usage record;
begin
  select o.pickup_slot_id,o.stall_id into slot_id,stall_id
  from public.orders o where o.id=new.order_id and o.payment_method in ('gcash','wallet');
  if slot_id is null then return new; end if;
  select * into usage from cpugrab_private.slot_usage(stall_id,slot_id);
  if usage.portions_left < new.quantity then
    raise exception 'This pickup period does not have enough portion capacity. Choose another time.';
  end if;
  return new;
end;
$$;
create trigger enforce_portions before insert on public.order_items
for each row execute function cpugrab_private.guard_portions();

create function cpugrab_private.break_recommendations(p_start time,p_end time,p_budget integer) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(to_jsonb(choices) order by choices.start_time,choices.total_centavos),'[]'::jsonb)
  from (
    select candidate.item_id,candidate.slot_id,candidate.start_time,candidate.end_time,candidate.total_centavos
    from (
      select distinct on (m.id) m.id as item_id,u.id as slot_id,u.start_time,u.end_time,
        m.price_centavos+p.default_markup_centavos+p.reservation_fee_centavos as total_centavos
      from public.menu_items m
      join public.stalls s on s.id=m.stall_id
      join public.platform_settings p on p.id=1
      cross join lateral cpugrab_private.slot_usage(s.id,null) u
      where public.has_role('student') and p_start<p_end and not m.is_archived and m.is_available
        and (m.stock_quantity is null or m.stock_quantity>0)
        and u.availability in ('available','limited')
        and u.start_time >= statement_timestamp()+make_interval(mins=>m.preparation_minutes)
        and timezone('Asia/Manila',u.start_time)::time>=p_start
        and timezone('Asia/Manila',u.end_time)::time<=p_end
        and m.price_centavos+p.default_markup_centavos+p.reservation_fee_centavos<=p_budget
      order by m.id,u.start_time
    ) candidate order by candidate.start_time,candidate.total_centavos limit 24
  ) choices;
$$;
create function public.break_recommendations(p_start time,p_end time,p_budget integer) returns jsonb
language sql stable security invoker set search_path=''
return cpugrab_private.break_recommendations(p_start,p_end,p_budget);
revoke all on function cpugrab_private.slot_usage(uuid,uuid),cpugrab_private.guard_paid_slot_capacity(),
  cpugrab_private.guard_portions(),cpugrab_private.break_recommendations(time,time,integer),
  public.break_recommendations(time,time,integer) from public,anon,authenticated;
grant execute on function cpugrab_private.break_recommendations(time,time,integer),
  public.break_recommendations(time,time,integer) to authenticated;

create function cpugrab_private.preparation_schedule(p_stall uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.can_manage_stall(p_stall) then raise exception 'Stall access required'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(p) order by p.start_time) from (
      select s.id,s.start_time,s.end_time,s.max_reservations,s.max_portions,
        counts.confirmed,counts.ready,counts.cancelled,counts.completed,
        capacity.remaining,capacity.portions_left,
        coalesce(items.portions,0) as portions,
        coalesce(items.lines,'[]'::jsonb) as lines
      from public.pickup_slots s
      join cpugrab_private.slot_usage(p_stall,null) capacity on capacity.id=s.id
      cross join lateral (
        select count(*) filter(where o.status in ('reserved','ready','completed') and o.payment_status='paid'
          and coalesce(d.phase,'assigned')<>'pending') as confirmed,
          count(*) filter(where o.status='ready') as ready,
          count(*) filter(where o.status='cancelled') as cancelled,
          count(*) filter(where o.status='completed') as completed
        from public.orders o left join public.deliveries d on d.order_id=o.id where o.pickup_slot_id=s.id
      ) counts
      cross join lateral (
        select sum(lines.quantity) as portions,jsonb_agg(to_jsonb(lines) order by lines.prepare_by,lines.name) as lines
        from (
          select i.item_name_snapshot as name,sum(i.quantity) as quantity,
            sum(i.quantity) filter(where o.status='ready') as ready,
            s.start_time-make_interval(mins=>m.preparation_minutes) as prepare_by
          from public.order_items i join public.orders o on o.id=i.order_id
          join public.menu_items m on m.id=i.menu_item_id
          left join public.deliveries d on d.order_id=o.id
          where o.pickup_slot_id=s.id and o.status in ('reserved','ready') and o.payment_status='paid'
            and coalesce(d.phase,'assigned') in ('assigned')
          group by i.menu_item_id,i.item_name_snapshot,m.preparation_minutes
        ) lines
      ) items
      where s.stall_id=p_stall
    ) p
  ),'[]'::jsonb);
end;
$$;
create function public.preparation_schedule(p_stall uuid) returns jsonb
language sql stable security invoker set search_path=''
return cpugrab_private.preparation_schedule(p_stall);
revoke all on function cpugrab_private.preparation_schedule(uuid),public.preparation_schedule(uuid) from public,anon,authenticated;
grant execute on function cpugrab_private.preparation_schedule(uuid),public.preparation_schedule(uuid) to authenticated;
