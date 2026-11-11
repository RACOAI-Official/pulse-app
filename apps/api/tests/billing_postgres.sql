-- Run against local Supabase after phase_09; this transaction rolls back.
-- psql "$DB_URL" -v ON_ERROR_STOP=1 -f apps/api/tests/billing_postgres.sql
begin;
do $$
declare tenant uuid := gen_random_uuid(); checkout uuid; invoice public.billing_invoices;
  bal integer; before_end timestamptz;
begin
  insert into public.tenants(id,name) values(tenant,'Billing test');
  -- New workspace: 7-day trial with 200 credits.
  if not public.pulse_billing_has_access(tenant) then raise exception 'Trial missing'; end if;
  if (select balance from public.credit_accounts where tenant_id=tenant)<>200 then
    raise exception 'Trial credits missing';
  end if;

  -- Credits: consume is idempotent per source and never goes below zero.
  if not public.pulse_credit_consume(tenant,'job-a') then raise exception 'Consume failed'; end if;
  if not public.pulse_credit_consume(tenant,'job-a') then raise exception 'Repeat consume failed'; end if;
  if (select balance from public.credit_accounts where tenant_id=tenant)<>199 then
    raise exception 'Repeat consume charged twice';
  end if;
  if not public.pulse_credit_refund(tenant,'job-a') then raise exception 'Refund failed'; end if;
  if public.pulse_credit_refund(tenant,'job-a') then raise exception 'Double refund'; end if;
  update public.credit_accounts set balance=0 where tenant_id=tenant;
  if public.pulse_credit_consume(tenant,'job-b') then raise exception 'Consumed at zero'; end if;

  -- Expired trial: no access, paid writes blocked, reads fine.
  update public.billing_accounts set trial_ends_at=now()-interval '1 second' where tenant_id=tenant;
  if public.pulse_billing_has_access(tenant) then raise exception 'Expired trial has access'; end if;
  begin
    insert into public.products(tenant_id,handle,title) values(tenant,'unpaid','Unpaid');
    raise exception 'Unpaid product write succeeded';
  exception when raise_exception then
    if sqlerrm='Unpaid product write succeeded' then raise; end if;
  end;
  perform count(*) from public.products where tenant_id=tenant;

  -- Pro monthly via SSLCOMMERZ: access + fresh 4000-credit cycle; settle is idempotent.
  insert into public.billing_checkouts(tenant_id,plan_key,billing_interval,provider,kind,amount_minor,
    currency_code,merchant_transaction_id)
  values(tenant,'pro','month','sslcommerz','purchase',350000,'BDT','BILLING-TEST-1') returning id into checkout;
  perform set_config('request.jwt.claim.role','service_role',true);
  invoice := public.pulse_billing_settle(checkout,'SSL-VALIDATION-1','BANK-1',350000,'BDT',
    now(),now()+interval '1 month',4000,false);
  if invoice.state<>'paid' or not public.pulse_billing_has_access(tenant) then
    raise exception 'Verified payment did not grant access';
  end if;
  if (select balance from public.credit_accounts where tenant_id=tenant)<>4000 then
    raise exception 'Purchase did not grant allowance';
  end if;
  insert into public.products(tenant_id,handle,title) values(tenant,'paid','Paid');
  perform public.pulse_billing_settle(checkout,'SSL-VALIDATION-1','BANK-1',350000,'BDT',
    now(),now()+interval '1 month',4000,false);
  if (select count(*) from public.billing_invoices where checkout_id=checkout)<>1 then
    raise exception 'Duplicate settlement created invoice';
  end if;

  -- Wrong amount rejected.
  insert into public.billing_checkouts(tenant_id,plan_key,billing_interval,provider,kind,amount_minor,
    currency_code,merchant_transaction_id)
  values(tenant,'enterprise','month','sslcommerz','upgrade',425000,'BDT','BILLING-TEST-2') returning id into checkout;
  begin
    perform public.pulse_billing_settle(checkout,'SSL-UP','BANK-UP',100,'BDT',
      now(),now()+interval '1 month',15000,false);
    raise exception 'Wrong amount was accepted';
  exception when raise_exception then
    if sqlerrm='Wrong amount was accepted' then raise; end if;
  end;

  -- Upgrade mid-cycle: plan becomes enterprise, term end kept, credits topped up by the remaining share.
  update public.credit_accounts set balance=1000,cycle_start=now()-interval '15 days',
    cycle_end=now()+interval '15 days' where tenant_id=tenant;
  select paid_through into before_end from public.billing_accounts where tenant_id=tenant;
  perform public.pulse_billing_settle(checkout,'SSL-UP','BANK-UP',425000,'BDT',
    now(),before_end,15000,false);
  if (select plan_key from public.billing_accounts where tenant_id=tenant)<>'enterprise'
     or (select paid_through from public.billing_accounts where tenant_id=tenant)<>before_end then
    raise exception 'Upgrade changed the term or missed the plan';
  end if;
  select balance into bal from public.credit_accounts where tenant_id=tenant;
  if bal not between 6400 and 6600 then raise exception 'Upgrade top-up wrong: %',bal; end if;

  -- Monthly roll: no rollover, allowance from the plan.
  update public.credit_accounts set balance=7,cycle_end=now()-interval '1 minute' where tenant_id=tenant;
  update public.billing_accounts set paid_through=now()+interval '11 months' where tenant_id=tenant;
  perform public.pulse_credit_roll_cycles('{"pro":4000,"enterprise":15000}');
  if (select balance from public.credit_accounts where tenant_id=tenant)<>15000 then
    raise exception 'Roll did not reset to allowance';
  end if;

  -- A delayed older payment never replaces the newer plan.
  insert into public.billing_checkouts(tenant_id,plan_key,billing_interval,provider,kind,amount_minor,
    currency_code,merchant_transaction_id)
  values(tenant,'pro','month','sslcommerz','purchase',350000,'BDT','BILLING-TEST-3') returning id into checkout;
  perform public.pulse_billing_settle(checkout,'SSL-OLD','BANK-OLD',350000,'BDT',
    now()-interval '1 month',now()+interval '1 day',4000,false);
  if (select plan_key from public.billing_accounts where tenant_id=tenant)<>'enterprise' then
    raise exception 'Older payment replaced the newer plan';
  end if;

  update public.billing_accounts set paid_through=now()-interval '1 second' where tenant_id=tenant;
  if public.pulse_billing_has_access(tenant) then raise exception 'Expired term has access'; end if;
end $$;
rollback;
