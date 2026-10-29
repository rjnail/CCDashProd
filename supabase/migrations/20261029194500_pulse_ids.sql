-- Review only. Do not apply this file to production or any live database.
-- Apply only after 20261029133000_pulse_meeting.sql, and only on a named development database.
-- Voting ballots stay private until a round is closed. Closed rounds store totals, not a public voter list.
-- Team membership does not grant giving, donor, personnel, or care records.

alter table public.pulse_items drop constraint if exists pulse_items_issue_status_check;

alter table public.pulse_items
  add constraint pulse_items_issue_status_check
  check (
    issue_status is null
    or issue_status in ('open', 'discussing', 'long_term', 'solved')
  );

-- Item locking stays in details.version (JSON) together with updated_at.
-- pulse_items has no version column. Do not add one beside the JSON lock.

create table if not exists public.pulse_vote_rounds (
  id uuid primary key default gen_random_uuid(),
  team text not null check (team in ('executive', 'pastoral', 'leadership')),
  status text not null check (status in ('open', 'closed')),
  opened_by uuid not null references auth.users (id),
  opened_at timestamptz not null default now(),
  closed_by uuid references auth.users (id),
  closed_at timestamptz,
  totals jsonb,
  suggested jsonb,
  confirmed jsonb
);

create unique index if not exists pulse_one_open_vote_round
  on public.pulse_vote_rounds (team)
  where status = 'open';

create table if not exists public.pulse_votes (
  round_id uuid not null references public.pulse_vote_rounds (id) on delete cascade,
  voter_id uuid not null references auth.users (id),
  issue_id uuid not null references public.pulse_items (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (round_id, voter_id, issue_id)
);

create table if not exists public.pulse_issue_resolutions (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.pulse_items (id) on delete cascade,
  team text not null,
  idempotency_key text not null unique,
  resolution text not null,
  actor_id uuid not null references auth.users (id),
  linked_action_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.pulse_insight_dismissals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  insight_id text not null,
  surface text not null check (surface in ('dashboard', 'pulse')),
  team text not null default '',
  reason text not null,
  created_at timestamptz not null default now(),
  unique (user_id, insight_id, surface, team)
);

alter table public.pulse_vote_rounds enable row level security;
alter table public.pulse_votes enable row level security;
alter table public.pulse_issue_resolutions enable row level security;
alter table public.pulse_insight_dismissals enable row level security;

create policy pulse_vote_rounds_select on public.pulse_vote_rounds
  for select to authenticated
  using (public.is_pulse_member(team));

create policy pulse_votes_select_own on public.pulse_votes
  for select to authenticated
  using (voter_id = auth.uid());

create policy pulse_resolutions_select on public.pulse_issue_resolutions
  for select to authenticated
  using (public.is_pulse_member(team));

create policy pulse_dismissals_select_own on public.pulse_insight_dismissals
  for select to authenticated
  using (user_id = auth.uid());

revoke all on public.pulse_vote_rounds, public.pulse_votes, public.pulse_issue_resolutions, public.pulse_insight_dismissals from anon, authenticated;
grant select on public.pulse_vote_rounds, public.pulse_votes, public.pulse_issue_resolutions, public.pulse_insight_dismissals to authenticated;

create or replace function public.pulse_team_roster(p_team text)
returns table (user_id uuid, display_name text, capability text)
language sql
stable
security definer
set search_path = public
as $$
  select m.user_id, p.display_name, m.capability
  from public.pulse_team_members m
  join public.user_profiles p on p.id = m.user_id
  where m.team = p_team
    and m.capability in ('viewer', 'contributor', 'facilitator')
    and public.is_pulse_member(p_team);
$$;

revoke all on function public.pulse_team_roster(text) from public;
grant execute on function public.pulse_team_roster(text) to authenticated;
