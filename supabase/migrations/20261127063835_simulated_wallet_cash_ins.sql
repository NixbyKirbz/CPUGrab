create table cpugrab_private.simulated_wallet_entries (
  student_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('cash_in', 'order_payment', 'order_refund')),
  reference_id uuid not null,
  amount_centavos integer not null check (
    (kind = 'cash_in' and amount_centavos > 0)
    or (kind = 'order_payment' and amount_centavos <= 0)
    or (kind = 'order_refund' and amount_centavos >= 0)
  ),
  created_at timestamptz not null default now(),
  primary key (student_id, kind, reference_id)
);
alter table cpugrab_private.simulated_wallet_entries enable row level security;
revoke all on cpugrab_private.simulated_wallet_entries from public, anon, authenticated;

create function cpugrab_private.wallet_balance(p_student uuid) returns bigint
language sql stable set search_path = '' as $$
  select coalesce(sum(amount_centavos), 0)
  from cpugrab_private.simulated_wallet_entries
  where student_id = p_student;
$$;

create function cpugrab_private.lock_wallet(p_student uuid) returns void
language sql set search_path = '' as $$
  select pg_advisory_xact_lock(hashtextextended(p_student::text, 1));
$$;

create function cpugrab_private.simulated_wallet_balance() returns bigint
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.has_role('student') then
    raise exception 'Sign in with an active student account';
  end if;
  return cpugrab_private.wallet_balance(auth.uid());
end;
$$;

create function cpugrab_private.simulate_wallet_cash_in(p_amount_centavos integer, p_key uuid)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  student uuid := auth.uid();
  recorded_amount integer;
begin
  if student is null or not public.has_role('student') then
    raise exception 'Sign in with an active student account';
  end if;
  if p_key is null or p_amount_centavos is null or p_amount_centavos <= 0 then
    raise exception 'Enter a positive cash-in amount';
  end if;

  perform cpugrab_private.lock_wallet(student);
  insert into cpugrab_private.simulated_wallet_entries (student_id, kind, reference_id, amount_centavos)
  values (student, 'cash_in', p_key, p_amount_centavos)
  on conflict do nothing;
  select amount_centavos into strict recorded_amount
  from cpugrab_private.simulated_wallet_entries
  where student_id = student and kind = 'cash_in' and reference_id = p_key;
  if recorded_amount <> p_amount_centavos then
    raise exception 'This cash-in was already recorded for a different amount';
  end if;
  return cpugrab_private.wallet_balance(student);
end;
$$;

create function public.simulated_wallet_balance() returns bigint
language sql stable security invoker set search_path = ''
return cpugrab_private.simulated_wallet_balance();

create function public.simulate_wallet_cash_in(p_amount_centavos integer, p_key uuid) returns bigint
language sql security invoker set search_path = ''
return cpugrab_private.simulate_wallet_cash_in(p_amount_centavos, p_key);

revoke all on function cpugrab_private.wallet_balance(uuid), cpugrab_private.lock_wallet(uuid),
  cpugrab_private.simulated_wallet_balance(), cpugrab_private.simulate_wallet_cash_in(integer, uuid),
  public.simulated_wallet_balance(), public.simulate_wallet_cash_in(integer, uuid)
from public, anon, authenticated;
grant execute on function cpugrab_private.simulated_wallet_balance(),
  cpugrab_private.simulate_wallet_cash_in(integer, uuid), public.simulated_wallet_balance(),
  public.simulate_wallet_cash_in(integer, uuid) to authenticated;
