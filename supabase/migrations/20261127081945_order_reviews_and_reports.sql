create table public.order_reviews (
  order_id uuid primary key references public.orders(id),
  customer_id uuid not null references public.profiles(id),
  quality smallint not null check(quality between 1 and 5),
  temperature smallint not null check(temperature between 1 and 5),
  packaging smallint not null check(packaging between 1 and 5),
  accuracy smallint not null check(accuracy between 1 and 5),
  experience smallint not null check(experience between 1 and 5),
  created_at timestamptz not null default now()
);
alter table public.order_reviews enable row level security;
grant select on public.order_reviews to authenticated;
grant insert(order_id,customer_id,quality,temperature,packaging,accuracy,experience) on public.order_reviews to authenticated;
create policy related_reviews on public.order_reviews for select to authenticated using(public.can_view_order(order_id));
create policy customer_review on public.order_reviews for insert to authenticated with check(
  customer_id=(select auth.uid()) and public.has_role('student') and exists(
    select 1 from public.orders o where o.id=order_id and o.student_id=customer_id
      and o.status='completed' and o.payment_status='paid'
  )
);

create table public.order_reports (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  reporter_id uuid not null references public.profiles(id),
  reporter_role text not null check(reporter_role in ('student','seller','worker')),
  category text not null check(category in (
    'missing_items','food_quality','spoiled_food','packaging','late_delivery','not_received',
    'unsafe_delivery','disputed_completion','other'
  )),
  description text not null check(length(trim(description)) between 10 and 2000),
  status text not null default 'submitted' check(status in ('submitted','under_review','awaiting_response','resolved','rejected','closed')),
  created_at timestamptz not null default now()
);
create index order_reports_reporter_idx on public.order_reports(reporter_id,order_id);
create index order_reports_triage_idx on public.order_reports(status,category,created_at);
alter table public.order_reports enable row level security;
grant select on public.order_reports to authenticated;
create policy report_owner_or_reviewer on public.order_reports for select to authenticated using(
  (reporter_id=(select auth.uid()) and public.is_active_user()) or public.has_role('admin')
);

create table public.order_report_updates (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.order_reports(id),
  changed_by uuid not null references public.profiles(id),
  status text not null,
  decision text not null check(decision in ('status_update','full_refund','external_follow_up','no_action')),
  reason text not null check(length(trim(reason)) between 3 and 1000),
  created_at timestamptz not null default now()
);
create index order_report_updates_report_idx on public.order_report_updates(report_id,created_at);
alter table public.order_report_updates enable row level security;
grant select(id,report_id,status,decision,reason,created_at) on public.order_report_updates to authenticated;
create policy related_report_updates on public.order_report_updates for select to authenticated using(
  exists (select 1 from public.order_reports r where r.id=report_id)
);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('order-report-evidence','order-report-evidence',false,5242880,array['image/jpeg','image/png','image/webp']);
create policy private_report_evidence_upload on storage.objects for insert to authenticated with check(
  bucket_id='order-report-evidence' and exists(
    select 1 from public.order_reports r where r.id::text=(storage.foldername(name))[1]
      and r.reporter_id=(select auth.uid()) and r.status in ('submitted','awaiting_response')
  )
);
create policy private_report_evidence_read on storage.objects for select to authenticated using(
  bucket_id='order-report-evidence' and exists(
    select 1 from public.order_reports r where r.id::text=(storage.foldername(name))[1]
  )
);

create function cpugrab_private.submit_order_report(p_order uuid,p_category text,p_description text) returns uuid
language plpgsql security definer set search_path='' as $$
declare participant text; report uuid;
begin
  if not public.is_active_user() then raise exception 'Sign in to report an issue'; end if;
  select case
    when o.student_id=auth.uid() and public.has_role('student') then 'student'
    when public.has_role('seller') and public.can_manage_stall(o.stall_id) then 'seller'
    when d.worker_id=auth.uid() and public.has_role('student') then 'worker' end
  into participant from public.orders o left join public.deliveries d on d.order_id=o.id where o.id=p_order;
  if participant is null then raise exception 'Only order participants can report an issue'; end if;
  insert into public.order_reports(order_id,reporter_id,reporter_role,category,description)
  values(p_order,auth.uid(),participant,p_category,trim(p_description)) returning id into report;
  return report;
end;
$$;

create function cpugrab_private.review_order_report(p_report uuid,p_status text,p_decision text,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare report public.order_reports; o public.orders; trip uuid; note text:=trim(p_reason);
begin
  if not public.has_role('admin') then raise exception 'Administrator access is required'; end if;
  select * into report from public.order_reports where id=p_report for update;
  if not found or report.status='closed' then raise exception 'This report cannot be updated'; end if;
  if p_status is null or p_decision is null or note is null or length(note) not between 3 and 1000 then
    raise exception 'Provide the status and a decision reason';
  end if;
  if p_decision='full_refund' then
    if p_status<>'resolved' or report.status in ('resolved','rejected') then raise exception 'Resolve an open report to issue a refund'; end if;
    select group_id into trip from public.deliveries where order_id=report.order_id;
    if trip is not null then perform pg_advisory_xact_lock(hashtextextended(trip::text,3)); end if;
    select * into o from public.orders where id=report.order_id for update;
    if o.payment_status<>'paid' or o.payment_method not in ('gcash','wallet') then
      raise exception 'The order has no eligible payment to refund';
    end if;
    if exists(select 1 from public.deliveries where order_id=o.id and phase='handover_issue') then
      perform cpugrab_private.resolve_delivery_issue(o.id,true,false,left(note,500));
    elsif o.status in ('reserved','ready') then
      perform cpugrab_private.cancel_reservation(o.id,left(note,500),false);
    else
      update public.orders set payment_status='refunded',updated_at=clock_timestamp() where id=o.id;
      if o.payment_method='wallet' then
        perform cpugrab_private.lock_wallet(o.student_id);
        insert into cpugrab_private.simulated_wallet_entries(student_id,kind,reference_id,amount_centavos,reason)
        values(o.student_id,'order_refund',o.id,o.total_centavos,note);
      end if;
      insert into public.notifications(user_id,order_id,title,message)
      values(o.student_id,o.id,'Simulated refund issued','A refund was issued to your original payment method.');
    end if;
  end if;
  update public.order_reports set status=p_status where id=p_report;
  insert into public.order_report_updates(report_id,changed_by,status,decision,reason)
  values(p_report,auth.uid(),p_status,p_decision,note);
  insert into public.notifications(user_id,order_id,title,message)
  values(report.reporter_id,report.order_id,'Order report updated','Your order report is now ' || replace(p_status,'_',' ') || '.');
end;
$$;

create function public.submit_order_report(p_order uuid,p_category text,p_description text) returns uuid
language sql security invoker set search_path=''
return cpugrab_private.submit_order_report(p_order,p_category,p_description);
create function public.review_order_report(p_report uuid,p_status text,p_decision text,p_reason text) returns void
language sql security invoker set search_path=''
return cpugrab_private.review_order_report(p_report,p_status,p_decision,p_reason);
revoke all on function public.submit_order_report(uuid,text,text),cpugrab_private.submit_order_report(uuid,text,text),
  public.review_order_report(uuid,text,text,text),cpugrab_private.review_order_report(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.submit_order_report(uuid,text,text),cpugrab_private.submit_order_report(uuid,text,text),
  public.review_order_report(uuid,text,text,text),cpugrab_private.review_order_report(uuid,text,text,text) to authenticated;
