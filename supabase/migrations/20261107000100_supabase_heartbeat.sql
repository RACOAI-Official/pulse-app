-- A minimal database request for an external uptime monitor.
create function public.pulse_heartbeat()
returns boolean
language sql
stable
as $$
  select true;
$$;

revoke all on function public.pulse_heartbeat() from public, authenticated;
grant execute on function public.pulse_heartbeat() to anon;
