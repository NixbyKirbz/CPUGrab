-- Supabase auto-confirmation does not prove email ownership.
create or replace function cpugrab_private.bootstrap_verified_admin() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 return new;
end $$;
