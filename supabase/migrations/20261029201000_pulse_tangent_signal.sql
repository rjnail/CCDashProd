-- Review only. Do not apply this file to production or any live database.
-- Depends on 20261029133000_pulse_meeting.sql.
-- One active tangent signal per open meeting session. No sender name is stored for display.

create table if not exists public.pulse_tangent_alerts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.pulse_sessions (id) on delete cascade,
  team text not null check (team in ('executive', 'pastoral', 'leadership')),
  label text not null,
  triggered_at timestamptz not null default now(),
  dismissed_at timestamptz
);

create unique index if not exists pulse_one_open_tangent
  on public.pulse_tangent_alerts (session_id)
  where dismissed_at is null;

create index if not exists pulse_tangent_recent
  on public.pulse_tangent_alerts (session_id, triggered_at desc);

alter table public.pulse_tangent_alerts enable row level security;

create policy pulse_tangent_select on public.pulse_tangent_alerts
  for select to authenticated
  using (public.is_pulse_member(team) and dismissed_at is null);

revoke all on public.pulse_tangent_alerts from anon, authenticated;
grant select on public.pulse_tangent_alerts to authenticated;
