-- Public location deactivation also hides its stalls.
drop policy stalls_read on public.stalls;
create policy stalls_read on public.stalls for select using(
 (approval_status='approved' and exists(select 1 from public.locations l where l.id=location_id and l.is_active))
 or owner_id=auth.uid() or public.can_manage_stall(id)
);
-- Enforce confirmed email domains on reservations as well as signup. A seller
-- signup request may use a personal email, but must never bypass student access.
create function public.check_student_reservation() returns trigger language plpgsql security definer set search_path='' as $$
declare domains text[]; email_domain text;
begin
 select university_email_domains into domains from public.platform_settings where id=1;
 select lower(split_part(email,'@',2)) into email_domain from auth.users where id=new.student_id;
 if cardinality(domains)>0 and not(email_domain=any(domains)) then raise exception 'A verified university email is required for student reservations'; end if;
 return new;
end $$;
create trigger validate_student_reservation before insert on public.orders for each row execute function public.check_student_reservation();
revoke all on function public.check_student_reservation() from public,anon,authenticated;
