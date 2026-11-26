-- A one-time administrator invitation configured only by the project owner.
-- No email address or privileged credential is embedded in source control.
create schema if not exists cpugrab_private;
revoke all on schema cpugrab_private from public,anon,authenticated;
create table cpugrab_private.admin_bootstrap (email text primary key check(email=lower(email)),created_at timestamptz not null default now());
revoke all on cpugrab_private.admin_bootstrap from public,anon,authenticated;
create function cpugrab_private.bootstrap_verified_admin() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.email_confirmed_at is not null and exists(select 1 from cpugrab_private.admin_bootstrap where email=lower(new.email)) then
  update public.user_roles set role='admin' where user_id=new.id;
  if found then delete from cpugrab_private.admin_bootstrap where email=lower(new.email); end if;
 end if;
 return new;
end $$;
revoke all on function cpugrab_private.bootstrap_verified_admin() from public,anon,authenticated;
create trigger zz_bootstrap_admin_insert after insert on auth.users for each row execute function cpugrab_private.bootstrap_verified_admin();
create trigger zz_bootstrap_admin_verify after update of email_confirmed_at on auth.users for each row execute function cpugrab_private.bootstrap_verified_admin();
