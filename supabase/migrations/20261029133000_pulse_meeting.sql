-- Review only. Do not apply this file to production.
-- Community OS / Pulse Meeting workspace tables.
-- Applying it changes database permissions. Wait until a development database is named.
-- Team membership does not grant giving, donor, personnel, or care records.
-- Giving continues to use the existing Financials policies.

create table if not exists public.pulse_team_members (
  user_id uuid not null references auth.users (id) on delete cascade,
  team text not null check (team in ('executive', 'pastoral', 'leadership')),
  capability text not null check (capability in ('viewer', 'contributor', 'facilitator', 'membership_admin')),
  created_at timestamptz not null default now(),
  primary key (user_id, team, capability)
);

create table if not exists public.pulse_items (
  id uuid primary key default gen_random_uuid(),
  team text not null check (team in ('executive', 'pastoral', 'leadership')),
  kind text not null check (kind in ('rock', 'todo', 'issue', 'headline')),
  title text not null,
  details text not null default '',
  owner_id uuid references auth.users (id),
  due_on date,
  quarter text,
  progress integer,
  rock_status text check (rock_status in ('on_track', 'off_track', 'complete')),
  priority integer,
  issue_status text check (issue_status in ('open', 'discussing', 'solved')),
  decision text not null default '',
  metric_key text,
  campus text,
  period_label text,
  removed_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pulse_sessions (
  id uuid primary key default gen_random_uuid(),
  team text not null check (team in ('executive', 'pastoral', 'leadership')),
  started_at timestamptz not null default now(),
  paused_ms integer not null default 0,
  paused_at timestamptz,
  stage integer not null default 0 check (stage between 0 and 6),
  status text not null default 'active' check (status in ('active', 'finished')),
  notes text not null default '',
  headlines text not null default '',
  decision text not null default '',
  campus text not null default 'church-wide' check (campus in ('church-wide', 'mount-pleasant', 'alma', 'st-johns')),
  created_by uuid references auth.users (id),
  updated_at timestamptz not null default now(),
  constraint pulse_sessions_scope check (team = 'pastoral' or campus = 'church-wide')
);

create unique index if not exists pulse_one_active_session
  on public.pulse_sessions (team)
  where status = 'active';

create table if not exists public.pulse_archives (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.pulse_sessions (id),
  team text not null check (team in ('executive', 'pastoral', 'leadership')),
  campus text not null default 'church-wide' check (campus in ('church-wide', 'mount-pleasant', 'alma', 'st-johns')),
  finished_at timestamptz not null default now(),
  rating integer not null check (rating between 1 and 10),
  snapshot jsonb not null,
  giving_snapshot jsonb,
  constraint pulse_archives_scope check (team = 'pastoral' or campus = 'church-wide'),
  constraint pulse_archives_giving_scope check (
    giving_snapshot is null
    or (team = 'executive' and campus = 'church-wide')
  )
);

alter table public.pulse_team_members enable row level security;
alter table public.pulse_items enable row level security;
alter table public.pulse_sessions enable row level security;
alter table public.pulse_archives enable row level security;

create or replace function public.pulse_is_profile_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_profiles
    where id = auth.uid()
      and role = 'admin'
  );
$$;

revoke all on function public.pulse_is_profile_admin() from public;
grant execute on function public.pulse_is_profile_admin() to authenticated;

create or replace function public.is_pulse_member(p_team text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.pulse_team_members
    where user_id = auth.uid()
      and team = p_team
      and capability in ('viewer', 'contributor', 'facilitator')
  );
$$;

revoke all on function public.is_pulse_member(text) from public;
grant execute on function public.is_pulse_member(text) to authenticated;

create or replace function public.is_pulse_editor(p_team text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.pulse_team_members
    where user_id = auth.uid()
      and team = p_team
      and capability in ('contributor', 'facilitator')
  );
$$;

revoke all on function public.is_pulse_editor(text) from public;
grant execute on function public.is_pulse_editor(text) to authenticated;

create policy pulse_members_select on public.pulse_team_members
  for select to authenticated
  using (user_id = auth.uid() or public.pulse_is_profile_admin());

create policy pulse_items_select on public.pulse_items
  for select to authenticated
  using (public.is_pulse_member(team));

create policy pulse_items_write on public.pulse_items
  for insert to authenticated
  with check (public.is_pulse_editor(team));

create policy pulse_items_update on public.pulse_items
  for update to authenticated
  using (public.is_pulse_editor(team))
  with check (public.is_pulse_editor(team));

create policy pulse_items_delete on public.pulse_items
  for delete to authenticated
  using (public.is_pulse_editor(team));

create policy pulse_sessions_select on public.pulse_sessions
  for select to authenticated
  using (public.is_pulse_member(team));

create policy pulse_sessions_write on public.pulse_sessions
  for insert to authenticated
  with check (public.is_pulse_editor(team));

create policy pulse_sessions_update on public.pulse_sessions
  for update to authenticated
  using (public.is_pulse_editor(team))
  with check (public.is_pulse_editor(team));

create policy pulse_archives_select on public.pulse_archives
  for select to authenticated
  using (public.is_pulse_member(team));

create policy pulse_archives_insert on public.pulse_archives
  for insert to authenticated
  with check (public.is_pulse_editor(team));

create or replace function public.pulse_archives_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'Completed meeting snapshots are immutable';
  end if;
  if position('"key":"giving"' in new.snapshot::text) > 0
     or position('"metricKey":"giving"' in new.snapshot::text) > 0 then
    raise exception 'Giving stays out of the shared meeting snapshot';
  end if;
  if new.team <> 'executive' or new.campus <> 'church-wide' then
    new.giving_snapshot := null;
  end if;
  return new;
end;
$$;

revoke all on function public.pulse_archives_before_write() from public;

drop trigger if exists pulse_archives_before_write on public.pulse_archives;
create trigger pulse_archives_before_write
  before insert or update on public.pulse_archives
  for each row
  execute function public.pulse_archives_before_write();

revoke all on public.pulse_team_members, public.pulse_items, public.pulse_sessions, public.pulse_archives from anon, authenticated;
grant select, insert, update, delete on public.pulse_items, public.pulse_sessions to authenticated;
grant select (
  id,
  session_id,
  team,
  campus,
  finished_at,
  rating,
  snapshot
), insert on public.pulse_archives to authenticated;
grant select on public.pulse_team_members to authenticated;
