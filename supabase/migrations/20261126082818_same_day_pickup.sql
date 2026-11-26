create or replace function public.available_pickup_slots(p_stall uuid)
returns table(id uuid, start_time timestamptz, end_time timestamptz, max_reservations integer, remaining bigint)
language sql stable security definer set search_path='' as $$
 select s.id, s.start_time, s.end_time, s.max_reservations, s.max_reservations - count(o.id)
 from public.pickup_slots s
 left join public.orders o on o.pickup_slot_id = s.id and o.status <> 'cancelled'
 where s.stall_id = p_stall
   and s.is_active
   and s.start_time > statement_timestamp()
   and s.end_time < ((timezone('Asia/Manila', statement_timestamp())::date + 1)::timestamp at time zone 'Asia/Manila')
   and exists (
     select 1 from public.stalls t join public.locations l on l.id = t.location_id
     where t.id = p_stall and t.approval_status = 'approved' and t.is_open and l.is_active
   )
 group by s.id
 having count(o.id) < s.max_reservations
 order by s.start_time
$$;

create or replace function public.create_reservation(p_stall uuid,p_slot uuid,p_items jsonb,p_key uuid,p_notes text default '') returns uuid language plpgsql security definer set search_path='' as $$
declare existing uuid; slot public.pickup_slots; settings public.platform_settings; item public.menu_items; line record; qty integer; subtotal integer:=0; markup integer:=0; result uuid; checked_at timestamptz;
begin
 if not public.has_role('student') then raise exception 'Sign in with an active student account'; end if;
 if p_key is null or p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 50 or length(p_notes)>500 then raise exception 'Invalid reservation request'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_key::text,0));
 select id into existing from public.orders where student_id=auth.uid() and idempotency_key=p_key;
 if existing is not null then return existing; end if;
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
