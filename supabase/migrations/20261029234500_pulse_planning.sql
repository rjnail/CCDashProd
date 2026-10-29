-- Review only. Do not apply this file to production or to Supabase project ejeollcwplqmgwruqkez.
-- Apply only on a named development database, after the earlier unapplied Pulse files:
--   20261029133000_pulse_meeting.sql
--   20261029194500_pulse_ids.sql
--   20261029201000_pulse_tangent_signal.sql
--   20261029220000_pulse_scorecard.sql
--   20261029234500_pulse_planning.sql
-- This file adds Vision drafts, immutable planning versions, and the accountability chart.
-- It does not add a version column to pulse_items, and it does not change the giving scope check.
-- Seat assignment writes person_id only. It does not change team membership, roles, or access.

create table if not exists public.pulse_planning_sections (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('church', 'executive', 'pastoral', 'leadership')),
  section_key text not null check (section_key in (
    'values', 'focus', 'target', 'strategy', 'picture', 'annual',
    'swotStrengths', 'swotWeaknesses', 'swotOpportunities', 'swotThreats'
  )),
  content jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  unique (scope, section_key)
);

create table if not exists public.pulse_planning_versions (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('church', 'executive', 'pastoral', 'leadership')),
  author_id uuid references auth.users (id),
  created_at timestamptz not null default now(),
  sections jsonb not null,
  record_refs jsonb not null default '{"rocks":[],"issues":[]}'::jsonb
);

create table if not exists public.pulse_planning_publications (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null unique references public.pulse_planning_versions (id),
  scope text not null check (scope in ('church', 'executive', 'pastoral', 'leadership')),
  status text not null check (status = 'approved'),
  actor_id uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create table if not exists public.pulse_planning_audit (
  id uuid primary key default gen_random_uuid(),
  scope text not null,
  section_key text,
  previous_value jsonb,
  new_value jsonb,
  actor_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.pulse_seats (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) > 0),
  function_label text not null check (char_length(btrim(function_label)) > 0),
  person_id uuid references auth.users (id) on delete set null,
  parent_id uuid references public.pulse_seats (id),
  accountabilities jsonb not null,
  archived_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  constraint pulse_seats_accountabilities_count check (
    jsonb_typeof(accountabilities) = 'array'
    and jsonb_array_length(accountabilities) between 1 and 5
  )
);

create table if not exists public.pulse_seat_references (
  id uuid primary key default gen_random_uuid(),
  seat_id uuid references public.pulse_seats (id) on delete set null,
  label text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.pulse_seat_audit (
  id uuid primary key default gen_random_uuid(),
  seat_id uuid,
  scope text not null default 'church',
  previous_value jsonb,
  new_value jsonb,
  actor_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists pulse_planning_versions_scope_idx
  on public.pulse_planning_versions (scope, created_at desc);

create index if not exists pulse_seats_parent_idx
  on public.pulse_seats (parent_id);

create or replace function public.pulse_planning_versions_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Saved planning versions cannot be rewritten';
end;
$$;

revoke all on function public.pulse_planning_versions_immutable() from public;

drop trigger if exists pulse_planning_versions_no_rewrite on public.pulse_planning_versions;
create trigger pulse_planning_versions_no_rewrite
  before update or delete on public.pulse_planning_versions
  for each row
  execute function public.pulse_planning_versions_immutable();

drop trigger if exists pulse_planning_publications_no_rewrite on public.pulse_planning_publications;
create trigger pulse_planning_publications_no_rewrite
  before update or delete on public.pulse_planning_publications
  for each row
  execute function public.pulse_planning_versions_immutable();

create or replace function public.pulse_seat_parent_cycle()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  current_id uuid := new.parent_id;
  guard integer := 0;
begin
  if new.parent_id is null then
    return new;
  end if;
  if new.parent_id = new.id then
    raise exception 'A seat cannot report to itself';
  end if;
  while current_id is not null loop
    if current_id = new.id then
      raise exception 'That parent would create a cycle';
    end if;
    select parent_id into current_id from public.pulse_seats where id = current_id;
    guard := guard + 1;
    if guard > 100 then
      raise exception 'Seat hierarchy is too deep';
    end if;
  end loop;
  return new;
end;
$$;

revoke all on function public.pulse_seat_parent_cycle() from public;

drop trigger if exists pulse_seats_parent_cycle on public.pulse_seats;
create trigger pulse_seats_parent_cycle
  before insert or update of parent_id on public.pulse_seats
  for each row
  execute function public.pulse_seat_parent_cycle();

create or replace function public.can_view_pulse_planning()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.pulse_is_profile_admin()
    or exists (
      select 1
      from public.pulse_team_members
      where user_id = auth.uid()
        and capability in ('viewer', 'contributor', 'facilitator')
    );
$$;

create or replace function public.can_edit_church_planning()
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
      and (role = 'admin' or coalesce(can_edit_benchmarks, false))
  );
$$;

create or replace function public.can_edit_team_planning(p_team text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.pulse_is_profile_admin()
    or exists (
      select 1
      from public.pulse_team_members
      where user_id = auth.uid()
        and team = p_team
        and capability = 'facilitator'
    );
$$;

create or replace function public.can_manage_pulse_seats()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.pulse_is_profile_admin();
$$;

revoke all on function public.can_view_pulse_planning() from public;
revoke all on function public.can_edit_church_planning() from public;
revoke all on function public.can_edit_team_planning(text) from public;
revoke all on function public.can_manage_pulse_seats() from public;
grant execute on function public.can_view_pulse_planning() to authenticated;
grant execute on function public.can_edit_church_planning() to authenticated;
grant execute on function public.can_edit_team_planning(text) to authenticated;
grant execute on function public.can_manage_pulse_seats() to authenticated;

create or replace function public.apply_pulse_seat_archive(
  p_seat_id uuid,
  p_expected timestamptz,
  p_subordinate text,
  p_reference text,
  p_actor uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  seat public.pulse_seats%rowtype;
  child_count integer;
  ref_count integer;
begin
  select * into seat
  from public.pulse_seats
  where id = p_seat_id and archived_at is null
  for update;
  if not found then
    raise exception 'That seat is not on the chart';
  end if;
  if seat.updated_at is distinct from p_expected then
    raise exception 'Someone else saved this seat';
  end if;
  select count(*) into child_count
  from public.pulse_seats
  where parent_id = p_seat_id and archived_at is null;
  select count(*) into ref_count
  from public.pulse_seat_references
  where seat_id = p_seat_id;
  if child_count > 0 and p_subordinate not in ('move_to_parent', 'archive_with_seat') then
    raise exception 'Choose what happens to the seats below this one';
  end if;
  if ref_count > 0 and p_reference not in ('keep', 'detach') then
    raise exception 'Choose what happens to records that reference this seat';
  end if;
  if p_subordinate = 'move_to_parent' then
    update public.pulse_seats
      set parent_id = seat.parent_id,
          updated_at = now(),
          updated_by = p_actor
      where parent_id = p_seat_id and archived_at is null;
  elsif p_subordinate = 'archive_with_seat' then
    with recursive branch as (
      select id from public.pulse_seats where parent_id = p_seat_id and archived_at is null
      union all
      select child.id
      from public.pulse_seats child
      join branch on child.parent_id = branch.id
      where child.archived_at is null
    )
    update public.pulse_seats
      set archived_at = now(),
          updated_at = now(),
          updated_by = p_actor
      where id in (select id from branch);
  end if;
  update public.pulse_seats
    set archived_at = now(),
        updated_at = now(),
        updated_by = p_actor
    where id = p_seat_id;
  if p_reference = 'detach' then
    update public.pulse_seat_references
      set seat_id = null
      where seat_id = p_seat_id;
  end if;
  insert into public.pulse_seat_audit (seat_id, scope, previous_value, new_value, actor_id)
  values (
    p_seat_id,
    'church',
    jsonb_build_object('archived', false, 'title', seat.title),
    jsonb_build_object('archived', true, 'subordinates', coalesce(p_subordinate, ''), 'references', coalesce(p_reference, '')),
    p_actor
  );
end;
$$;

revoke all on function public.apply_pulse_seat_archive(uuid, timestamptz, text, text, uuid) from public, anon, authenticated;
grant execute on function public.apply_pulse_seat_archive(uuid, timestamptz, text, text, uuid) to service_role;

alter table public.pulse_planning_sections enable row level security;
alter table public.pulse_planning_versions enable row level security;
alter table public.pulse_planning_publications enable row level security;
alter table public.pulse_planning_audit enable row level security;
alter table public.pulse_seats enable row level security;
alter table public.pulse_seat_references enable row level security;
alter table public.pulse_seat_audit enable row level security;

create policy pulse_planning_sections_select on public.pulse_planning_sections
  for select to authenticated
  using (
    public.can_view_pulse_planning()
    and (
      scope = 'church'
      or public.pulse_is_profile_admin()
      or public.is_pulse_member(scope)
    )
    and (
      section_key not in ('swotStrengths', 'swotWeaknesses', 'swotOpportunities', 'swotThreats')
      or scope = 'church'
      or public.pulse_is_profile_admin()
      or public.is_pulse_member(scope)
    )
  );

create policy pulse_planning_sections_write on public.pulse_planning_sections
  for insert to authenticated
  with check (
    (scope = 'church' and public.can_edit_church_planning())
    or (scope <> 'church' and public.can_edit_team_planning(scope))
  );

create policy pulse_planning_sections_update on public.pulse_planning_sections
  for update to authenticated
  using (
    (scope = 'church' and public.can_edit_church_planning())
    or (scope <> 'church' and public.can_edit_team_planning(scope))
  )
  with check (
    (scope = 'church' and public.can_edit_church_planning())
    or (scope <> 'church' and public.can_edit_team_planning(scope))
  );

create policy pulse_planning_sections_delete on public.pulse_planning_sections
  for delete to authenticated
  using (
    (scope = 'church' and public.can_edit_church_planning())
    or (scope <> 'church' and public.can_edit_team_planning(scope))
  );

create policy pulse_planning_versions_select on public.pulse_planning_versions
  for select to authenticated
  using (
    public.can_view_pulse_planning()
    and (
      scope = 'church'
      or public.pulse_is_profile_admin()
      or public.is_pulse_member(scope)
    )
  );

create policy pulse_planning_versions_insert on public.pulse_planning_versions
  for insert to authenticated
  with check (
    (scope = 'church' and public.can_edit_church_planning())
    or (scope <> 'church' and public.can_edit_team_planning(scope))
  );

create policy pulse_planning_publications_select on public.pulse_planning_publications
  for select to authenticated
  using (
    public.can_view_pulse_planning()
    and (
      scope = 'church'
      or public.pulse_is_profile_admin()
      or public.is_pulse_member(scope)
    )
  );

create policy pulse_planning_publications_insert on public.pulse_planning_publications
  for insert to authenticated
  with check (public.pulse_is_profile_admin());

create policy pulse_planning_audit_select on public.pulse_planning_audit
  for select to authenticated
  using (public.pulse_is_profile_admin() or public.can_edit_church_planning() or public.can_edit_team_planning(scope));

create policy pulse_planning_audit_insert on public.pulse_planning_audit
  for insert to authenticated
  with check (
    (scope = 'church' and public.can_edit_church_planning())
    or (scope <> 'church' and public.can_edit_team_planning(scope))
  );

create policy pulse_seats_select on public.pulse_seats
  for select to authenticated
  using (public.can_view_pulse_planning());

create policy pulse_seats_insert on public.pulse_seats
  for insert to authenticated
  with check (public.can_manage_pulse_seats());

create policy pulse_seats_update on public.pulse_seats
  for update to authenticated
  using (public.can_manage_pulse_seats())
  with check (public.can_manage_pulse_seats());

create policy pulse_seat_references_select on public.pulse_seat_references
  for select to authenticated
  using (public.can_view_pulse_planning());

create policy pulse_seat_references_update on public.pulse_seat_references
  for update to authenticated
  using (public.can_manage_pulse_seats())
  with check (public.can_manage_pulse_seats());

create policy pulse_seat_audit_select on public.pulse_seat_audit
  for select to authenticated
  using (public.can_manage_pulse_seats());

create policy pulse_seat_audit_insert on public.pulse_seat_audit
  for insert to authenticated
  with check (public.can_manage_pulse_seats());

revoke all on public.pulse_planning_sections, public.pulse_planning_versions, public.pulse_planning_publications, public.pulse_planning_audit, public.pulse_seats, public.pulse_seat_references, public.pulse_seat_audit from anon, authenticated;
grant select, insert, update, delete on public.pulse_planning_sections to authenticated;
grant select, insert on public.pulse_planning_versions to authenticated;
grant select, insert on public.pulse_planning_publications to authenticated;
grant select, insert on public.pulse_planning_audit to authenticated;
grant select, insert, update on public.pulse_seats to authenticated;
grant select, update on public.pulse_seat_references to authenticated;
grant select, insert on public.pulse_seat_audit to authenticated;
