alter table public.profiles add column wallet_reminder_enabled boolean not null default false,
  add column wallet_reminder_centavos integer not null default 5000 check(wallet_reminder_centavos between 100 and 1000000);
grant update(wallet_reminder_enabled,wallet_reminder_centavos) on public.profiles to authenticated;

create function cpugrab_private.remind_low_wallet_balance() returns trigger
language plpgsql security definer set search_path='' as $$
declare threshold integer; balance bigint;
begin
  select wallet_reminder_centavos into threshold from public.profiles
    where id=new.student_id and account_kind='student' and not is_suspended and wallet_reminder_enabled;
  if threshold is null then return new; end if;
  select coalesce(sum(amount_centavos),0) into balance from cpugrab_private.simulated_wallet_entries where student_id=new.student_id;
  if balance<threshold and balance-new.amount_centavos>=threshold then
    insert into public.notifications(user_id,order_id,title,message)
    values(new.student_id,new.reference_id,'Wallet balance is low','Your CPUGrab Wallet balance fell below your reminder amount.');
  end if;
  return new;
end;
$$;
revoke all on function cpugrab_private.remind_low_wallet_balance() from public,anon,authenticated;
create trigger wallet_balance_reminder after insert on cpugrab_private.simulated_wallet_entries
for each row when (new.kind='order_payment' and new.amount_centavos<0)
execute function cpugrab_private.remind_low_wallet_balance();
