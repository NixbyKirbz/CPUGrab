create function public.register_seller(p_name text,p_location uuid,p_contact text,p_image text) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if not public.is_active_user() or not public.has_role('student') then raise exception 'A verified student account is required for this application'; end if;
 if length(trim(p_name)) not between 1 and 100 or length(trim(p_contact))<7 or p_image='' then raise exception 'Complete the stall name, contact number, and photo'; end if;
 if not exists(select 1 from public.locations where id=p_location and is_active) then raise exception 'Invalid location'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 if exists(select 1 from public.stalls where owner_id=auth.uid()) then raise exception 'You already have a stall application'; end if;
 insert into public.stalls(owner_id,name,location_id,contact_number,image_url,cover_image_url) values(auth.uid(),trim(p_name),p_location,p_contact,p_image,p_image) returning id into result;
 update public.user_roles set role='seller' where user_id=auth.uid();
 return result;
end $$;
create function public.available_pickup_slots(p_stall uuid) returns table(id uuid,start_time timestamptz,end_time timestamptz,max_reservations integer,remaining bigint) language sql stable security definer set search_path='' as $$
 select s.id,s.start_time,s.end_time,s.max_reservations,s.max_reservations-count(o.id) from public.pickup_slots s left join public.orders o on o.pickup_slot_id=s.id and o.status<>'cancelled' where s.stall_id=p_stall and s.is_active and s.start_time>now() and s.start_time<now()+interval '7 days' and exists(select 1 from public.stalls t join public.locations l on l.id=t.location_id where t.id=p_stall and t.approval_status='approved' and t.is_open and l.is_active) group by s.id having count(o.id)<s.max_reservations order by s.start_time $$;
create function public.create_reservation(p_stall uuid,p_slot uuid,p_items jsonb,p_key uuid,p_notes text default '') returns uuid language plpgsql security definer set search_path='' as $$
declare existing uuid; slot public.pickup_slots; settings public.platform_settings; item public.menu_items; line record; qty integer; subtotal integer:=0; markup integer:=0; result uuid;
begin
 if not public.has_role('student') then raise exception 'Sign in with an active student account'; end if;
 if p_key is null or p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 50 or length(p_notes)>500 then raise exception 'Invalid reservation request'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_key::text,0));
 select id into existing from public.orders where student_id=auth.uid() and idempotency_key=p_key;
 if existing is not null then return existing; end if;
 perform 1 from public.stalls s join public.locations l on l.id=s.location_id where s.id=p_stall and s.is_open and s.approval_status='approved' and l.is_active for share of s,l;
 if not found then raise exception 'This stall is not accepting reservations'; end if;
 select * into slot from public.pickup_slots where id=p_slot and stall_id=p_stall for update;
 if not found or not slot.is_active or slot.start_time<=now() or slot.start_time>now()+interval '7 days' then raise exception 'This pickup time is no longer available'; end if;
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
 insert into public.orders(student_id,stall_id,pickup_slot_id,idempotency_key,subtotal_centavos,markup_centavos,reservation_fee_centavos,stall_fee_share_centavos,platform_fee_share_centavos,total_centavos,customer_notes) values(auth.uid(),p_stall,p_slot,p_key,subtotal,markup,settings.reservation_fee_centavos,settings.stall_fee_share_centavos,settings.platform_fee_share_centavos,subtotal+markup+settings.reservation_fee_centavos,p_notes) returning id into result;
 for line in select x from jsonb_array_elements(p_items) x order by x->>'id' loop
   qty=(line.x->>'quantity')::integer;
   select * into item from public.menu_items where id=(line.x->>'id')::uuid;
   insert into public.order_items(order_id,menu_item_id,item_name_snapshot,unit_price_centavos,quantity,markup_centavos,subtotal_centavos) values(result,item.id,item.name,item.price_centavos,qty,settings.default_markup_centavos,(item.price_centavos+settings.default_markup_centavos)*qty);
   update public.menu_items set stock_quantity=stock_quantity-qty where id=item.id and stock_quantity is not null;
 end loop;
 insert into public.order_status_history(order_id,new_status,changed_by) values(result,'reserved',auth.uid());
 insert into public.notifications(user_id,order_id,title,message) values(auth.uid(),result,'Reservation placed','Your meal is reserved. Pay in cash at pickup.');
 insert into public.notifications(user_id,order_id,title,message) select owner_id,result,'New reservation','A student reserved a meal at your stall.' from public.stalls where id=p_stall and owner_id is not null;
 return result;
end $$;
create function public.issue_pickup_token(p_order uuid) returns text language plpgsql security definer set search_path='' as $$
declare o public.orders; token text; expiry timestamptz;
begin
 select * into o from public.orders where id=p_order for update;
 if not found or o.student_id<>auth.uid() or not public.is_active_user() or o.status not in ('reserved','ready') then raise exception 'No active pickup found'; end if;
 select end_time+interval '2 hours' into expiry from public.pickup_slots where id=o.pickup_slot_id;
 if expiry<=now() then raise exception 'This pickup code has expired. Contact the stall'; end if;
 token=encode(extensions.gen_random_bytes(32),'hex');
 insert into public.pickup_tokens(order_id,token_hash,expires_at) values(p_order,encode(extensions.digest(token,'sha256'),'hex'),expiry) on conflict(order_id) do update set token_hash=excluded.token_hash,expires_at=excluded.expires_at,created_at=now(),used_at=null;
 return token;
end $$;
create function public.mark_order_ready(p_order uuid) returns void language plpgsql security definer set search_path='' as $$
declare o public.orders;
begin
 select * into o from public.orders where id=p_order for update;
 if not found or not public.can_manage_stall(o.stall_id) then raise exception 'Not authorized'; end if;
 if o.status<>'reserved' then raise exception 'Only reserved orders can be marked ready'; end if;
 update public.orders set status='ready',ready_at=now(),updated_at=now() where id=p_order;
 insert into public.order_status_history(order_id,previous_status,new_status,changed_by) values(p_order,o.status,'ready',auth.uid());
 insert into public.notifications(user_id,order_id,title,message) values(o.student_id,p_order,'Your meal is ready!','Show your pickup QR at the stall.');
end $$;
create function public.cancel_order(p_order uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare o public.orders; line record; slot_start timestamptz;
begin
 select * into o from public.orders where id=p_order for update;
 if not found or not public.is_active_user() or not (o.student_id=auth.uid() or public.can_manage_stall(o.stall_id)) then raise exception 'Not authorized'; end if;
 if o.status not in ('reserved','ready') or o.payment_status='paid' then raise exception 'This reservation cannot be cancelled'; end if;
 if length(trim(p_reason)) not between 3 and 500 then raise exception 'Provide a cancellation reason'; end if;
 select start_time into slot_start from public.pickup_slots where id=o.pickup_slot_id for update;
 if o.student_id=auth.uid() and (o.status<>'reserved' or slot_start<=now()+interval '15 minutes') and not public.can_manage_stall(o.stall_id) then raise exception 'Contact the stall to cancel within 15 minutes of pickup or after it is ready'; end if;
 update public.orders set status='cancelled',cancellation_reason=trim(p_reason),cancelled_at=now(),updated_at=now() where id=p_order;
 update public.pickup_tokens set used_at=now() where order_id=p_order;
 for line in select * from public.order_items where order_id=p_order order by menu_item_id loop update public.menu_items set stock_quantity=stock_quantity+line.quantity where id=line.menu_item_id and stock_quantity is not null; end loop;
 insert into public.order_status_history(order_id,previous_status,new_status,changed_by,reason) values(p_order,o.status,'cancelled',auth.uid(),p_reason);
 insert into public.notifications(user_id,order_id,title,message) values(o.student_id,p_order,'Reservation cancelled',p_reason);
 insert into public.notifications(user_id,order_id,title,message) select owner_id,p_order,'Reservation cancelled',p_reason from public.stalls where id=o.stall_id and owner_id is not null;
end $$;
create function public.inspect_pickup_token(p_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.orders; t public.pickup_tokens; s public.pickup_slots;
begin
 select * into t from public.pickup_tokens where token_hash=encode(extensions.digest(p_token,'sha256'),'hex');
 select * into o from public.orders where id=t.order_id;
 if o.id is null or not public.can_manage_stall(o.stall_id) then raise exception 'Invalid pickup code for your stall'; end if;
 if t.used_at is not null or o.status not in ('reserved','ready') or t.expires_at<=now() then raise exception 'This pickup code is used, cancelled, or expired'; end if;
 select * into s from public.pickup_slots where id=o.pickup_slot_id;
 if now()<s.start_time-interval '15 minutes' then raise exception 'Pickup opens 15 minutes before the selected time'; end if;
 return jsonb_build_object('id',o.id,'order_number',o.order_number,'payment_status',o.payment_status,'total_centavos',o.total_centavos);
end $$;
create function public.redeem_pickup_token(p_token text,p_cash_received boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.orders; t public.pickup_tokens; result jsonb;
begin
 -- Lock the order first, matching cancellation and token rotation lock order.
 select o1.* into o from public.orders o1 join public.pickup_tokens t1 on t1.order_id=o1.id where t1.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') for update of o1;
 if not found then raise exception 'Invalid pickup code'; end if;
 select * into t from public.pickup_tokens where order_id=o.id for update;
 result=public.inspect_pickup_token(p_token);
 if o.payment_status='unpaid' and not p_cash_received then raise exception 'Acknowledge cash received before pickup'; end if;
 update public.orders set status='completed',payment_status='paid',completed_at=now(),updated_at=now() where id=o.id;
 update public.pickup_tokens set used_at=now() where id=t.id;
 insert into public.order_status_history(order_id,previous_status,new_status,changed_by) values(o.id,o.status,'completed',auth.uid());
 insert into public.notifications(user_id,order_id,title,message) values(o.student_id,o.id,'Order picked up','Enjoy your meal! Your order is completed.');
 return result;
end $$;
create function public.acknowledge_cash_payment(p_order uuid) returns void language plpgsql security definer set search_path='' as $$
declare o public.orders;
begin
 select * into o from public.orders where id=p_order for update;
 if not found or not public.can_manage_stall(o.stall_id) or o.status not in ('reserved','ready') then raise exception 'Not authorized or order is inactive'; end if;
 update public.orders set payment_status='paid',updated_at=now() where id=p_order;
end $$;
create function public.complete_order(p_token text,p_cash_received boolean default false) returns jsonb language sql security invoker set search_path='' as $$ select public.redeem_pickup_token(p_token,p_cash_received) $$;
create function public.update_menu_availability(p_item uuid,p_available boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.menu_items where id=p_item and public.can_manage_stall(stall_id) and not is_archived) then raise exception 'Not authorized'; end if;
 update public.menu_items set is_available=p_available where id=p_item;
end $$;
create function public.manage_seller_approval(p_stall uuid,p_status text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.has_role('admin') or p_status not in ('approved','suspended','pending') then raise exception 'Not authorized'; end if;
 update public.stalls set approval_status=p_status,is_open=case when p_status='approved' then is_open else false end where id=p_stall;
end $$;
create function public.set_account_suspension(p_user uuid,p_suspended boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.has_role('admin') or p_user=auth.uid() or exists(select 1 from public.user_roles where user_id=p_user and role='admin') then raise exception 'Not authorized'; end if;
 update public.profiles set is_suspended=p_suspended where id=p_user;
end $$;
revoke all on all functions in schema public from public,anon,authenticated;
grant execute on function public.is_active_user(),public.has_role(public.app_role),public.can_manage_stall(uuid),public.can_view_order(uuid) to anon,authenticated;
grant execute on function public.register_seller(text,uuid,text,text),public.available_pickup_slots(uuid),public.create_reservation(uuid,uuid,jsonb,uuid,text),public.issue_pickup_token(uuid),public.mark_order_ready(uuid),public.cancel_order(uuid,text),public.inspect_pickup_token(text),public.redeem_pickup_token(text,boolean),public.acknowledge_cash_payment(uuid),public.complete_order(text,boolean),public.update_menu_availability(uuid,boolean),public.manage_seller_approval(uuid,text),public.set_account_suspension(uuid,boolean) to authenticated;
