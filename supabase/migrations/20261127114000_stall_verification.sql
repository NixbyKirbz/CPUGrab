create table public.stall_verifications (
  stall_id uuid primary key references public.stalls(id),
  standards_accepted_at timestamptz,
  verification_status text not null default 'pending' check(verification_status in ('pending','verified','changes_requested')),
  expires_on date,
  reviewer_note text check(length(reviewer_note)<=1000),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz
);
alter table public.stall_verifications enable row level security;
grant select on public.stall_verifications to authenticated;
create policy stall_verification_read on public.stall_verifications for select to authenticated using(
  public.has_role('admin') or (public.is_active_user() and exists(
    select 1 from public.stalls s where s.id=stall_id and s.owner_id=(select auth.uid())
  ))
);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('stall-verification','stall-verification',false,5242880,array['application/pdf','image/jpeg','image/png','image/webp']);
create policy stall_verification_upload on storage.objects for insert to authenticated with check(
  bucket_id='stall-verification' and public.is_active_user() and exists(
    select 1 from public.stalls s where s.id::text=(storage.foldername(name))[1] and s.owner_id=(select auth.uid())
  )
);
create policy stall_verification_file_read on storage.objects for select to authenticated using(
  bucket_id='stall-verification' and (
    public.has_role('admin') or (public.is_active_user() and exists(
      select 1 from public.stalls s where s.id::text=(storage.foldername(name))[1] and s.owner_id=(select auth.uid())
    ))
  )
);

create function cpugrab_private.accept_stall_standards(p_stall uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not public.is_active_user() or not exists(select 1 from public.stalls where id=p_stall and owner_id=auth.uid()) then
    raise exception 'The stall owner must acknowledge these standards';
  end if;
  insert into public.stall_verifications(stall_id,standards_accepted_at) values(p_stall,clock_timestamp())
  on conflict(stall_id) do update set standards_accepted_at=coalesce(stall_verifications.standards_accepted_at,excluded.standards_accepted_at);
end;
$$;
create function public.accept_stall_standards(p_stall uuid) returns void
language sql security invoker set search_path='' return cpugrab_private.accept_stall_standards(p_stall);

create function cpugrab_private.review_stall_documents(p_stall uuid,p_status text,p_expiry date,p_note text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not public.has_role('admin') then raise exception 'Administrator access is required'; end if;
  if p_status='verified' and p_expiry<timezone('Asia/Manila',clock_timestamp())::date then
    raise exception 'Use a current or future expiration date';
  end if;
  insert into public.stall_verifications(stall_id,verification_status,expires_on,reviewer_note,reviewed_by,reviewed_at)
  values(p_stall,p_status,p_expiry,nullif(trim(p_note),''),auth.uid(),clock_timestamp())
  on conflict(stall_id) do update set verification_status=excluded.verification_status,expires_on=excluded.expires_on,
    reviewer_note=excluded.reviewer_note,reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at;
end;
$$;
create function public.review_stall_documents(p_stall uuid,p_status text,p_expiry date,p_note text) returns void
language sql security invoker set search_path='' return cpugrab_private.review_stall_documents(p_stall,p_status,p_expiry,p_note);
revoke all on function cpugrab_private.accept_stall_standards(uuid),public.accept_stall_standards(uuid),
  cpugrab_private.review_stall_documents(uuid,text,date,text),public.review_stall_documents(uuid,text,date,text) from public,anon,authenticated;
grant execute on function cpugrab_private.accept_stall_standards(uuid),public.accept_stall_standards(uuid),
  cpugrab_private.review_stall_documents(uuid,text,date,text),public.review_stall_documents(uuid,text,date,text) to authenticated;

create or replace function public.manage_seller_approval(p_stall uuid,p_status text) returns void
language plpgsql security definer set search_path='' as $$
declare owned boolean;
begin
  if not public.has_role('admin') or p_status is null or p_status not in ('approved','suspended','pending') then
    raise exception 'Administrator access is required';
  end if;
  select owner_id is not null into owned from public.stalls where id=p_stall for update;
  if not found then raise exception 'Stall not found'; end if;
  if p_status='approved' and owned and not exists (
    select 1 from public.stall_verifications v where v.stall_id=p_stall and v.standards_accepted_at is not null
      and v.verification_status='verified' and (v.expires_on is null or v.expires_on>=timezone('Asia/Manila',clock_timestamp())::date)
  ) then raise exception 'Review the stall verification and confirm the owner has accepted the food handling standards before approving'; end if;
  update public.stalls set approval_status=p_status,is_open=case when p_status='approved' then is_open else false end where id=p_stall;
end;
$$;
