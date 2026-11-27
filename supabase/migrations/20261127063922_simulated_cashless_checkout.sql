-- Preserve historical cash records and require an explicit payment method for new reservations.
alter table public.orders
  alter column payment_method drop default,
  alter column payment_status drop default,
  drop constraint orders_payment_method_check,
  drop constraint orders_payment_status_check,
  add constraint orders_payment_method_check check (payment_method in ('cash', 'gcash', 'wallet')),
  add constraint orders_payment_status_check check (
    (payment_method = 'cash' and payment_status in ('unpaid', 'paid'))
    or (payment_method in ('gcash', 'wallet') and payment_status in ('paid', 'refunded'))
  );

drop function public.create_reservation(uuid, uuid, jsonb, uuid, text);

create function cpugrab_private.create_paid_reservation(p_stall uuid,p_slot uuid,p_items jsonb,p_key uuid,p_notes text, p_payment_method text, p_total_centavos integer) returns uuid language plpgsql security definer set search_path='' as $$
declare existing public.orders; total integer; slot public.pickup_slots; settings public.platform_settings; item public.menu_items; line record; qty integer; subtotal integer:=0; markup integer:=0; result uuid; checked_at timestamptz;
begin
 if not public.has_role('student') then raise exception 'Sign in with an active student account'; end if;
 if p_key is null or p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 50 or p_notes is null or length(p_notes)>500 then raise exception 'Invalid reservation request'; end if;
 if p_payment_method is null or p_payment_method not in ('gcash','wallet') then raise exception 'Choose GCash or CPUGrab Wallet'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_key::text,0));
 select * into existing from public.orders where student_id=auth.uid() and idempotency_key=p_key;
 if found then
   if existing.payment_method is distinct from p_payment_method or existing.total_centavos is distinct from p_total_centavos then
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
 if (select count(distinct x->>'id') from jsonb_array_elements(p_items) x)<>jsonb_array_length(p_items) then raise exception 'Duplicate menu items'; end if;
 for line in select x from jsonb_array_elements(p_items) x order by x->>'id' loop
   if (line.x->>'quantity') !~ '^[0-9]+$' then raise exception 'Invalid quantity'; end if;
   qty=(line.x->>'quantity')::integer;
   if qty not between 1 and 99 then raise exception 'Quantity must be between 1 and 99'; end if;
   select * into item from public.menu_items where id=(line.x->>'id')::uuid and stall_id=p_stall for update;
   if not found or not item.is_available or item.is_archived or (item.stock_quantity is not null and item.stock_quantity<qty) then raise exception 'A menu item is unavailable. Refresh your cart'; end if;
   subtotal=subtotal+item.price_centavos*qty; markup=markup+settings.default_markup_centavos*qty;
 end loop;
 total := subtotal + markup + settings.reservation_fee_centavos;
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
   customer_notes, payment_method, payment_status
 ) values (
   auth.uid(), p_stall, p_slot, p_key, subtotal, markup, settings.reservation_fee_centavos,
   settings.stall_fee_share_centavos, settings.platform_fee_share_centavos, total, p_notes,
   p_payment_method, 'paid'
 ) returning id into result;
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
 insert into public.notifications(user_id,order_id,title,message) values(auth.uid(),result,'Reservation placed','Your simulated payment is complete. Show your pickup code at the stall.');
 insert into public.notifications(user_id,order_id,title,message) select owner_id,result,'New reservation','A student reserved a meal at your stall.' from public.stalls where id=p_stall and owner_id is not null;
 return result;
end $$;

create function public.create_reservation(
  p_stall uuid, p_slot uuid, p_items jsonb, p_key uuid, p_notes text,
  p_payment_method text, p_total_centavos integer
) returns uuid language sql security invoker set search_path = ''
return cpugrab_private.create_paid_reservation(p_stall, p_slot, p_items, p_key, p_notes, p_payment_method, p_total_centavos);

revoke all on function cpugrab_private.create_paid_reservation(uuid, uuid, jsonb, uuid, text, text, integer),
  public.create_reservation(uuid, uuid, jsonb, uuid, text, text, integer)
from public, anon, authenticated;
grant execute on function cpugrab_private.create_paid_reservation(uuid, uuid, jsonb, uuid, text, text, integer),
  public.create_reservation(uuid, uuid, jsonb, uuid, text, text, integer)
to authenticated;

create or replace function public.cancel_order(p_order uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare o public.orders; line record; slot_start timestamptz;
begin
 select * into o from public.orders where id=p_order for update;
 if not found or not public.is_active_user() or not (o.student_id=auth.uid() or public.can_manage_stall(o.stall_id)) then raise exception 'Not authorized'; end if;
 if o.status not in ('reserved','ready') or (o.payment_method='cash' and o.payment_status='paid') then raise exception 'This reservation cannot be cancelled'; end if;
 if p_reason is null or length(trim(p_reason)) not between 3 and 500 then raise exception 'Provide a cancellation reason'; end if;
 select start_time into slot_start from public.pickup_slots where id=o.pickup_slot_id for update;
 if o.student_id=auth.uid() and (o.status<>'reserved' or slot_start<=now()+interval '15 minutes') and not public.can_manage_stall(o.stall_id) then raise exception 'Contact the stall to cancel within 15 minutes of pickup or after it is ready'; end if;
 update public.orders set status='cancelled',
  payment_status=case when o.payment_status='paid' then 'refunded' else o.payment_status end,
  cancellation_reason=trim(p_reason),cancelled_at=now(),updated_at=now() where id=p_order;
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

create or replace function public.mark_order_ready(p_order uuid) returns void language plpgsql security definer set search_path='' as $$
declare o public.orders;
begin
 select * into o from public.orders where id=p_order for update;
 if not found or not public.can_manage_stall(o.stall_id) then raise exception 'Not authorized'; end if;
 if o.status<>'reserved' then raise exception 'Only reserved orders can be marked ready'; end if;
 if o.payment_status<>'paid' then raise exception 'Payment is required before pickup'; end if;
 update public.orders set status='ready',ready_at=now(),updated_at=now() where id=p_order;
 insert into public.order_status_history(order_id,previous_status,new_status,changed_by) values(p_order,o.status,'ready',auth.uid());
 insert into public.notifications(user_id,order_id,title,message) values(o.student_id,p_order,'Your meal is ready!','Show your pickup QR at the stall.');
end $$;

create or replace function public.issue_pickup_token(p_order uuid) returns text language plpgsql security definer set search_path='' as $$
declare o public.orders; token text; expiry timestamptz;
begin
 select * into o from public.orders where id=p_order for update;
 if not found or o.student_id<>auth.uid() or not public.is_active_user() or o.status not in ('reserved','ready') then raise exception 'No active pickup found'; end if;
 if o.payment_status<>'paid' then raise exception 'Payment is required before pickup'; end if;
 select end_time+interval '2 hours' into expiry from public.pickup_slots where id=o.pickup_slot_id;
 if expiry<=now() then raise exception 'This pickup code has expired. Contact the stall'; end if;
 token=encode(extensions.gen_random_bytes(32),'hex');
 insert into public.pickup_tokens(order_id,token_hash,expires_at) values(p_order,encode(extensions.digest(token,'sha256'),'hex'),expiry) on conflict(order_id) do update set token_hash=excluded.token_hash,expires_at=excluded.expires_at,created_at=now(),used_at=null;
 return token;
end $$;

drop function public.complete_order(text, boolean);
drop function public.redeem_pickup_token(text, boolean);
drop function public.acknowledge_cash_payment(uuid);

create function cpugrab_private.redeem_paid_pickup(p_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.orders; t public.pickup_tokens; result jsonb;
begin
 -- Lock the order first, matching cancellation and token rotation lock order.
 select o1.* into o from public.orders o1 join public.pickup_tokens t1 on t1.order_id=o1.id where t1.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') for update of o1;
 if not found then raise exception 'Invalid pickup code'; end if;
 select * into t from public.pickup_tokens where order_id=o.id for update;
 result=public.inspect_pickup_token(p_token);
 if o.payment_status<>'paid' then raise exception 'Payment is required before pickup'; end if;
 update public.orders set status='completed',completed_at=now(),updated_at=now() where id=o.id;
 update public.pickup_tokens set used_at=now() where id=t.id;
 insert into public.order_status_history(order_id,previous_status,new_status,changed_by) values(o.id,o.status,'completed',auth.uid());
 insert into public.notifications(user_id,order_id,title,message) values(o.student_id,o.id,'Order picked up','Enjoy your meal! Your order is completed.');
 return result;
end $$;

create function public.redeem_pickup_token(p_token text) returns jsonb
language sql security invoker set search_path = ''
return cpugrab_private.redeem_paid_pickup(p_token);

create function public.complete_order(p_token text) returns jsonb
language sql security invoker set search_path = ''
return public.redeem_pickup_token(p_token);

revoke all on function cpugrab_private.redeem_paid_pickup(text),
  public.redeem_pickup_token(text), public.complete_order(text)
from public, anon, authenticated;
grant execute on function cpugrab_private.redeem_paid_pickup(text),
  public.redeem_pickup_token(text), public.complete_order(text)
to authenticated;
