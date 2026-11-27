-- Run only on an authorized CPUGrab database. All fixture changes roll back.
-- No credentials, actual payments, outbound email or persistent test accounts.
begin;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('f1111111-1111-4111-8111-111111111111','cpugrab-student-a@test.invalid',now(),'{"full_name":"Transaction test A"}'),
 ('f2222222-2222-4222-8222-222222222222','cpugrab-student-b@test.invalid',now(),'{"full_name":"Transaction test B"}'),
 ('f3333333-3333-4333-8333-333333333333','cpugrab-seller-a@test.invalid',now(),'{"full_name":"Transaction seller A"}'),
 ('f4444444-4444-4444-8444-444444444444','cpugrab-seller-b@test.invalid',now(),'{"full_name":"Transaction seller B"}');
update public.user_roles set role='seller' where user_id in ('f3333333-3333-4333-8333-333333333333','f4444444-4444-4444-8444-444444444444');
update public.stalls set owner_id='f3333333-3333-4333-8333-333333333333',is_open=true where id='00000000-0000-4000-8000-000000000020';
update public.menu_items set stock_quantity=10 where id='00000000-0000-4000-8000-000000000100';
insert into public.pickup_slots(id,stall_id,start_time,end_time,max_reservations) values('f5555555-5555-4555-8555-555555555555','00000000-0000-4000-8000-000000000020',now()+interval '5 minutes',now()+interval '35 minutes',1);
set local role authenticated;
do $$
declare o uuid; again uuid; total integer;
begin
 perform set_config('request.jwt.claim.sub','f1111111-1111-4111-8111-111111111111',true);
 o=public.create_reservation('00000000-0000-4000-8000-000000000020','f5555555-5555-4555-8555-555555555555','[{"id":"00000000-0000-4000-8000-000000000100","quantity":1}]','f6666666-6666-4666-8666-666666666666','Rollback-only test','gcash',8500);
 again=public.create_reservation('00000000-0000-4000-8000-000000000020','f5555555-5555-4555-8555-555555555555','[{"id":"00000000-0000-4000-8000-000000000100","quantity":1}]','f6666666-6666-4666-8666-666666666666','Rollback-only test','gcash',8500);
 if again<>o then raise exception 'Idempotency failed'; end if;
 select total_centavos into total from public.orders where id=o;
 if total<>8500 then raise exception 'Backend price snapshot failed'; end if;
 perform set_config('cpugrab.test_order',o::text,true);
 perform set_config('cpugrab.test_token',public.issue_pickup_token(o),true);
end $$;
do $$
declare rejected boolean:=false;
begin
 perform set_config('request.jwt.claim.sub','f2222222-2222-4222-8222-222222222222',true);
 if exists(select 1 from public.orders where id=current_setting('cpugrab.test_order')::uuid) then raise exception 'Cross-student RLS failed'; end if;
 begin
  perform public.create_reservation('00000000-0000-4000-8000-000000000020','f5555555-5555-4555-8555-555555555555','[{"id":"00000000-0000-4000-8000-000000000100","quantity":1}]','f7777777-7777-4777-8777-777777777777','','gcash',8500);
 exception when others then if position('full' in sqlerrm)>0 then rejected=true; else raise; end if; end;
 if not rejected then raise exception 'Capacity limit failed'; end if;
 rejected=false;
 begin perform 1 from public.pickup_tokens; exception when insufficient_privilege then rejected=true; end;
 if not rejected then raise exception 'Raw token privacy failed'; end if;
 perform set_config('request.jwt.claim.sub','f4444444-4444-4444-8444-444444444444',true);
 rejected=false;
 begin perform public.inspect_pickup_token(current_setting('cpugrab.test_token')); exception when others then if position('Invalid pickup' in sqlerrm)>0 then rejected=true; else raise; end if; end;
 if not rejected then raise exception 'Cross-stall redemption check failed'; end if;
end $$;
do $$
declare rejected boolean:=false; o uuid:=current_setting('cpugrab.test_order')::uuid;
begin
 perform set_config('request.jwt.claim.sub','f3333333-3333-4333-8333-333333333333',true);
 perform public.mark_order_ready(o);
 perform public.redeem_pickup_token(current_setting('cpugrab.test_token'));
 rejected=false;
 begin perform public.redeem_pickup_token(current_setting('cpugrab.test_token')); exception when others then if position('used' in sqlerrm)>0 then rejected=true; else raise; end if; end;
 if not rejected then raise exception 'Duplicate scan check failed'; end if;
 perform set_config('request.jwt.claim.sub','f1111111-1111-4111-8111-111111111111',true);
 if not exists(select 1 from public.orders where id=o and status='completed' and payment_status='paid') then raise exception 'Completion failed'; end if;
 if not exists(select 1 from public.notifications where order_id=o and title='Your meal is ready!') then raise exception 'Ready notification failed'; end if;
end $$;
reset role;
rollback;
select 'PASS: pricing, idempotency, capacity, RLS, cross-stall rejection, prepaid pickup, ready notification, redemption, duplicate rejection. All test data rolled back.' as result;
