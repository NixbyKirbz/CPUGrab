-- CPUGrab: integer-centavo accounting and database-enforced authorization.
create extension if not exists pgcrypto with schema extensions;
create type public.app_role as enum ('student','seller','admin');
create type public.order_status as enum ('reserved','ready','completed','cancelled');
create table public.profiles (id uuid primary key references auth.users on delete cascade, full_name text not null default '', student_id text, avatar_url text, is_suspended boolean not null default false, notifications_enabled boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.user_roles (user_id uuid primary key references public.profiles on delete cascade, role public.app_role not null default 'student', created_at timestamptz not null default now());
create table public.locations (id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 100), description text not null default '', image_url text not null default '', is_active boolean not null default true, display_order integer not null default 0, created_at timestamptz not null default now());
create table public.stalls (id uuid primary key default gen_random_uuid(), owner_id uuid references public.profiles, location_id uuid not null references public.locations, name text not null check(length(name) between 1 and 100), description text not null default '', image_url text not null default '', cover_image_url text not null default '', contact_number text not null default '', opening_hours text not null default 'Mon–Fri · 7:00 AM – 5:00 PM', is_open boolean not null default false, approval_status text not null default 'pending' check(approval_status in ('pending','approved','suspended')), created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.stall_members (id uuid primary key default gen_random_uuid(), stall_id uuid not null references public.stalls, user_id uuid not null references public.profiles, permission_level text not null default 'staff' check(permission_level in ('owner','staff')), unique(stall_id,user_id));
create table public.categories (id uuid primary key default gen_random_uuid(), name text not null unique, icon text not null default 'utensils', display_order integer not null default 0);
create table public.menu_items (id uuid primary key default gen_random_uuid(), stall_id uuid not null references public.stalls, category_id uuid not null references public.categories, name text not null check(length(name) between 1 and 120), description text not null default '', image_url text not null default '', price_centavos integer not null check(price_centavos between 0 and 10000000), is_available boolean not null default true, is_archived boolean not null default false, stock_quantity integer check(stock_quantity>=0), created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.pickup_slots (id uuid primary key default gen_random_uuid(), stall_id uuid not null references public.stalls, start_time timestamptz not null, end_time timestamptz not null, max_reservations integer not null default 20 check(max_reservations between 1 and 500), is_active boolean not null default true, check(end_time>start_time), unique(stall_id,start_time));
create sequence public.order_number_seq start 2300;
create table public.orders (id uuid primary key default gen_random_uuid(), order_number text not null unique default ('CPU-' || nextval('public.order_number_seq')), student_id uuid not null references public.profiles, stall_id uuid not null references public.stalls, pickup_slot_id uuid not null references public.pickup_slots, idempotency_key uuid not null, status public.order_status not null default 'reserved', payment_method text not null default 'cash' check(payment_method='cash'), payment_status text not null default 'unpaid' check(payment_status in ('unpaid','paid')), subtotal_centavos integer not null check(subtotal_centavos>=0), markup_centavos integer not null check(markup_centavos>=0), reservation_fee_centavos integer not null check(reservation_fee_centavos>=0), stall_fee_share_centavos integer not null check(stall_fee_share_centavos>=0), platform_fee_share_centavos integer not null check(platform_fee_share_centavos>=0), total_centavos integer not null check(total_centavos = subtotal_centavos+markup_centavos+reservation_fee_centavos), customer_notes text not null default '' check(length(customer_notes)<=500), cancellation_reason text, created_at timestamptz not null default now(), ready_at timestamptz, completed_at timestamptz, cancelled_at timestamptz, updated_at timestamptz not null default now(), unique(student_id,idempotency_key), check(reservation_fee_centavos=stall_fee_share_centavos+platform_fee_share_centavos));
create table public.order_items (id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders, menu_item_id uuid not null references public.menu_items, item_name_snapshot text not null, unit_price_centavos integer not null check(unit_price_centavos>=0), quantity integer not null check(quantity between 1 and 99), markup_centavos integer not null check(markup_centavos>=0), subtotal_centavos integer not null check(subtotal_centavos=(unit_price_centavos+markup_centavos)*quantity), unique(order_id,menu_item_id));
create table public.pickup_tokens (id uuid primary key default gen_random_uuid(), order_id uuid not null unique references public.orders, token_hash text not null unique, created_at timestamptz not null default now(), expires_at timestamptz not null, used_at timestamptz);
create table public.favorites (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade, stall_id uuid references public.stalls, menu_item_id uuid references public.menu_items, created_at timestamptz not null default now(), check(num_nonnulls(stall_id,menu_item_id)=1));
create unique index favorite_stalls_unique on public.favorites(user_id,stall_id) where stall_id is not null;
create unique index favorite_items_unique on public.favorites(user_id,menu_item_id) where menu_item_id is not null;
create table public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade, order_id uuid references public.orders, title text not null, message text not null, is_read boolean not null default false, created_at timestamptz not null default now());
create table public.order_status_history (id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders, previous_status public.order_status, new_status public.order_status not null, changed_by uuid references public.profiles, reason text, created_at timestamptz not null default now());
create table public.platform_settings (id integer primary key default 1 check(id=1), reservation_fee_centavos integer not null default 1500 check(reservation_fee_centavos between 0 and 10000), stall_fee_share_centavos integer not null default 1000 check(stall_fee_share_centavos>=0), platform_fee_share_centavos integer not null default 500 check(platform_fee_share_centavos>=0), default_markup_centavos integer not null default 0 check(default_markup_centavos in (0,200,300,400,500)), university_email_domains text[] not null default '{}', updated_at timestamptz not null default now(), check(reservation_fee_centavos=stall_fee_share_centavos+platform_fee_share_centavos));
insert into public.platform_settings(id) values(1);
create table public.push_subscriptions (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade, endpoint text not null unique, subscription_keys jsonb not null, created_at timestamptz not null default now());
create index stalls_location_idx on public.stalls(location_id);
create index menu_stall_idx on public.menu_items(stall_id,category_id) where not is_archived;
create index menu_search_idx on public.menu_items using gin(to_tsvector('simple',name));
create index orders_student_idx on public.orders(student_id,created_at desc);
create index orders_stall_idx on public.orders(stall_id,status,pickup_slot_id);
create index orders_slot_idx on public.orders(pickup_slot_id) where status <> 'cancelled';
create index slots_stall_idx on public.pickup_slots(stall_id,start_time);
create index notifications_user_idx on public.notifications(user_id,created_at desc);
create index order_items_order_idx on public.order_items(order_id);

create function public.is_active_user() returns boolean language sql stable security definer set search_path = '' as $$ select exists(select 1 from public.profiles where id=auth.uid() and not is_suspended) $$;
create function public.has_role(p_role public.app_role) returns boolean language sql stable security definer set search_path = '' as $$ select public.is_active_user() and exists(select 1 from public.user_roles where user_id=auth.uid() and role=p_role) $$;
create function public.can_manage_stall(p_stall uuid) returns boolean language sql stable security definer set search_path = '' as $$ select public.has_role('admin') or (public.has_role('seller') and exists(select 1 from public.stalls s where s.id=p_stall and s.approval_status='approved' and (s.owner_id=auth.uid() or exists(select 1 from public.stall_members m where m.stall_id=s.id and m.user_id=auth.uid())))) $$;
create function public.can_view_order(p_order uuid) returns boolean language sql stable security definer set search_path = '' as $$ select public.is_active_user() and exists(select 1 from public.orders o where o.id=p_order and (o.student_id=auth.uid() or public.can_manage_stall(o.stall_id))) $$;
create function public.handle_signup() returns trigger language plpgsql security definer set search_path = '' as $$
declare domains text[];
begin
 select university_email_domains into domains from public.platform_settings where id=1;
 if coalesce(new.raw_user_meta_data->>'account_type','student')='student' and cardinality(domains)>0 and not (lower(split_part(new.email,'@',2))=any(domains)) then raise exception 'Use an approved university email address'; end if;
 insert into public.profiles(id,full_name,student_id) values(new.id,left(coalesce(new.raw_user_meta_data->>'full_name',''),120),nullif(new.raw_user_meta_data->>'student_id',''));
 insert into public.user_roles(user_id,role) values(new.id,'student');
 return new;
end $$;
create trigger on_auth_signup after insert on auth.users for each row execute function public.handle_signup();
create function public.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$ begin new.updated_at=now(); return new; end $$;
create trigger profiles_updated before update on public.profiles for each row execute function public.touch_updated_at();
create trigger stalls_updated before update on public.stalls for each row execute function public.touch_updated_at();
create trigger menu_updated before update on public.menu_items for each row execute function public.touch_updated_at();

-- Deny by default. Sensitive writes only through narrowly scoped RPCs.
do $$ declare t text; begin foreach t in array array['profiles','user_roles','locations','stalls','stall_members','categories','menu_items','pickup_slots','orders','order_items','pickup_tokens','favorites','notifications','order_status_history','platform_settings','push_subscriptions'] loop execute format('alter table public.%I enable row level security',t); execute format('revoke all on public.%I from anon, authenticated',t); end loop; end $$;
grant select on public.locations,public.stalls,public.categories,public.menu_items,public.platform_settings to anon,authenticated;
grant select on public.profiles,public.user_roles,public.stall_members,public.pickup_slots,public.orders,public.order_items,public.favorites,public.notifications,public.order_status_history,public.push_subscriptions to authenticated;
grant update(full_name,student_id,avatar_url,notifications_enabled) on public.profiles to authenticated;
grant update(is_read) on public.notifications to authenticated;
grant insert,delete on public.favorites,public.push_subscriptions to authenticated;
grant insert,update,delete on public.locations to authenticated;
grant update on public.platform_settings to authenticated;
grant insert on public.menu_items,public.pickup_slots to authenticated;
grant update(name,description,image_url,price_centavos,category_id,is_available,is_archived,stock_quantity) on public.menu_items to authenticated;
grant update(is_active,max_reservations) on public.pickup_slots to authenticated;
grant update(name,description,image_url,cover_image_url,contact_number,opening_hours,is_open) on public.stalls to authenticated;
create policy profiles_read on public.profiles for select to authenticated using(id=auth.uid() or public.has_role('admin'));
create policy profiles_update on public.profiles for update to authenticated using(id=auth.uid() and public.is_active_user()) with check(id=auth.uid());
create policy roles_read on public.user_roles for select to authenticated using(user_id=auth.uid() or public.has_role('admin'));
create policy locations_read on public.locations for select using(is_active or public.has_role('admin'));
create policy locations_admin on public.locations for all to authenticated using(public.has_role('admin')) with check(public.has_role('admin'));
create policy stalls_read on public.stalls for select using(approval_status='approved' or owner_id=auth.uid() or public.can_manage_stall(id));
create policy stalls_update on public.stalls for update to authenticated using(public.can_manage_stall(id)) with check(public.can_manage_stall(id));
create policy members_read on public.stall_members for select to authenticated using(user_id=auth.uid() or public.can_manage_stall(stall_id));
create policy categories_read on public.categories for select using(true);
create policy menus_read on public.menu_items for select using((not is_archived and exists(select 1 from public.stalls s join public.locations l on l.id=s.location_id where s.id=stall_id and s.approval_status='approved' and l.is_active)) or public.can_manage_stall(stall_id));
create policy menus_insert on public.menu_items for insert to authenticated with check(public.can_manage_stall(stall_id));
create policy menus_update on public.menu_items for update to authenticated using(public.can_manage_stall(stall_id)) with check(public.can_manage_stall(stall_id));
create policy slots_read on public.pickup_slots for select to authenticated using((is_active and exists(select 1 from public.stalls where id=stall_id and approval_status='approved')) or public.can_manage_stall(stall_id));
create policy slots_manage on public.pickup_slots for all to authenticated using(public.can_manage_stall(stall_id)) with check(public.can_manage_stall(stall_id));
create policy orders_read on public.orders for select to authenticated using(public.is_active_user() and (student_id=auth.uid() or public.can_manage_stall(stall_id)));
create policy items_read on public.order_items for select to authenticated using(public.can_view_order(order_id));
create policy favorites_owner on public.favorites for all to authenticated using(user_id=auth.uid() and public.is_active_user()) with check(user_id=auth.uid() and public.is_active_user());
create policy notifications_read on public.notifications for select to authenticated using(user_id=auth.uid() and public.is_active_user());
create policy notifications_update on public.notifications for update to authenticated using(user_id=auth.uid() and public.is_active_user()) with check(user_id=auth.uid());
create policy history_read on public.order_status_history for select to authenticated using(public.can_view_order(order_id));
create policy settings_read on public.platform_settings for select using(true);
create policy settings_update on public.platform_settings for update to authenticated using(public.has_role('admin')) with check(public.has_role('admin'));
create policy push_owner on public.push_subscriptions for all to authenticated using(user_id=auth.uid() and public.is_active_user()) with check(user_id=auth.uid() and public.is_active_user());

-- Public images only. Tokens and private order data never enter Storage.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('campus-images','campus-images',true,5242880,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
create policy images_read on storage.objects for select using(bucket_id='campus-images');
create policy images_upload on storage.objects for insert to authenticated with check(bucket_id='campus-images' and (storage.foldername(name))[1]=auth.uid()::text and public.is_active_user());
create policy images_remove on storage.objects for delete to authenticated using(bucket_id='campus-images' and owner_id=auth.uid()::text);

alter publication supabase_realtime add table public.menu_items,public.stalls,public.orders,public.notifications,public.platform_settings,public.locations;
revoke all on all functions in schema public from public,anon,authenticated;
grant execute on function public.is_active_user(),public.has_role(public.app_role),public.can_manage_stall(uuid),public.can_view_order(uuid) to anon,authenticated;
