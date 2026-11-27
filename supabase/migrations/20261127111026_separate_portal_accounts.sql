alter table public.profiles add column account_kind text not null default 'student'
  check(account_kind in ('student','seller'));

update public.profiles p set account_kind='seller'
from auth.users u
where p.id=u.id and (
  exists(select 1 from public.user_roles r where r.user_id=p.id and r.role='seller')
  or u.raw_user_meta_data->>'account_type'='seller'
);
create index profile_student_number_lookup on public.profiles (lower(trim(student_id)))
where account_kind='student' and student_id is not null;

create function cpugrab_private.guard_student_number() returns trigger
language plpgsql security definer set search_path='' as $$
declare normalized text;
begin
  if new.account_kind<>'student' or new.student_id is null then return new; end if;
  normalized:=lower(trim(new.student_id));
  if tg_op='UPDATE' and normalized is not distinct from lower(trim(old.student_id)) then return new; end if;
  if length(normalized) not between 3 and 40 or normalized !~ '^[a-z0-9][a-z0-9 ._/-]*$' then
    raise exception 'Enter a valid student number';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(normalized,7));
  if exists(
    select 1 from public.profiles p where p.id<>new.id and p.account_kind='student'
      and p.student_id is not null and lower(trim(p.student_id))=normalized
  ) then raise exception 'This student number is already registered'; end if;
  new.student_id:=trim(new.student_id);
  return new;
end;
$$;
create trigger guard_student_number before insert or update of student_id on public.profiles
for each row execute function cpugrab_private.guard_student_number();
revoke all on function cpugrab_private.guard_student_number() from public,anon,authenticated;

create or replace function public.handle_signup() returns trigger
language plpgsql security definer set search_path='' as $$
declare domains text[]; kind text;
begin
  kind:=case when new.raw_user_meta_data->>'account_type'='seller' then 'seller' else 'student' end;
  select university_email_domains into domains from public.platform_settings where id=1;
  if kind='student' and cardinality(domains)>0 and not(lower(split_part(new.email,'@',2))=any(domains)) then
    raise exception 'Use an approved university email address';
  end if;
  insert into public.profiles(id,full_name,student_id,account_kind)
  values(new.id,left(coalesce(new.raw_user_meta_data->>'full_name',''),120),
    case when kind='student' then nullif(trim(new.raw_user_meta_data->>'student_id'),'') end,kind);
  insert into public.user_roles(user_id,role) values(new.id,'student');
  return new;
end;
$$;

create or replace function public.has_role(p_role public.app_role) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.profiles p join public.user_roles r on r.user_id=p.id
    where p.id=auth.uid() and not p.is_suspended and r.role=p_role
      and (p_role<>'student' or p.account_kind='student')
  );
$$;

create or replace function public.register_seller(p_name text,p_location uuid,p_contact text,p_image text)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and account_kind='seller' and not is_suspended) then
    raise exception 'Sign in with a separate Stall Portal account to apply';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  select id into result from public.stalls where owner_id=auth.uid() order by created_at,id limit 1;
  if result is not null then return result; end if;
  if length(trim(p_name)) not between 1 and 100 or length(trim(p_contact))<7 or p_image='' then
    raise exception 'Complete the stall name, contact number, and photo';
  end if;
  if not exists(select 1 from public.locations where id=p_location and is_active) then
    raise exception 'Invalid location';
  end if;
  insert into public.stalls(owner_id,name,location_id,contact_number,image_url,cover_image_url)
  values(auth.uid(),trim(p_name),p_location,p_contact,p_image,p_image) returning id into result;
  update public.user_roles set role='seller' where user_id=auth.uid() and role='student';
  return result;
end;
$$;

create function public.student_login_email(p_student_number text) returns text
language sql stable security definer set search_path='' as $$
  select case when count(*)=1 then min(u.email) end
  from public.profiles p join auth.users u on u.id=p.id
  join public.user_roles r on r.user_id=p.id and r.role='student'
  where p.account_kind='student' and not p.is_suspended
    and p.student_id is not null and lower(trim(p.student_id))=lower(trim(p_student_number));
$$;
revoke all on function public.student_login_email(text) from public,anon,authenticated;
grant execute on function public.student_login_email(text) to service_role;
