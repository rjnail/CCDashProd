-- Review only. Do not apply this file to production or to Supabase project ejeollcwplqmgwruqkez.
-- Apply only on a named development database, after 20261029201000_pulse_tangent_signal.sql.
-- This extends Pulse scorecard rows. It does not add a second target store or change source snapshots.
-- Completed meeting archives are not updated.

alter table public.pulse_items
  add column if not exists scorecard_role text;

alter table public.pulse_items
  drop constraint if exists pulse_items_scorecard_role_check;

alter table public.pulse_items
  add constraint pulse_items_scorecard_role_check
  check (
    scorecard_role is null
    or scorecard_role in ('selection', 'reading', 'meta')
  );

update public.pulse_items
set scorecard_role = case
  when metric_key = '__scorecard_ready__' then 'meta'
  when details like '%"role":"reading"%' then 'reading'
  when kind = 'headline' and details like '%"role":"manual"%' then 'selection'
  when kind = 'headline' and details like '%"role":"scorecard"%' then 'selection'
  else scorecard_role
end
where kind = 'headline'
  and scorecard_role is null;

create unique index if not exists pulse_scorecard_selection_once
  on public.pulse_items (team, metric_key, campus, period_label)
  where scorecard_role = 'selection' and removed_at is null;

create table if not exists public.pulse_scorecard_audit (
  id uuid primary key default gen_random_uuid(),
  team text,
  metric_key text not null,
  scope text not null,
  field_name text not null,
  previous_value text,
  new_value text,
  reason text not null default '',
  actor_id uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

alter table public.pulse_scorecard_audit enable row level security;

drop policy if exists pulse_scorecard_audit_select on public.pulse_scorecard_audit;
create policy pulse_scorecard_audit_select on public.pulse_scorecard_audit
  for select to authenticated
  using (team is null or public.is_pulse_member(team));

revoke all on public.pulse_scorecard_audit from anon, authenticated;
grant select on public.pulse_scorecard_audit to authenticated;

-- Giving rows are executive and church-wide only. financial_insights is an existing
-- user_profiles column used by the app; this repo does not create that table.
alter table public.pulse_items
  drop constraint if exists pulse_items_giving_scope_check;

alter table public.pulse_items
  add constraint pulse_items_giving_scope_check
  check (
    metric_key is distinct from 'giving'
    or (
      team = 'executive'
      and coalesce(campus, 'church-wide') = 'church-wide'
    )
  );

create or replace function public.pulse_can_read_giving()
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
      and (role = 'admin' or financial_insights is true)
  );
$$;

revoke all on function public.pulse_can_read_giving() from public;
grant execute on function public.pulse_can_read_giving() to authenticated;

drop policy if exists pulse_items_select on public.pulse_items;
create policy pulse_items_select on public.pulse_items
  for select to authenticated
  using (
    public.is_pulse_member(team)
    and (
      metric_key is distinct from 'giving'
      or (
        team = 'executive'
        and coalesce(campus, 'church-wide') = 'church-wide'
        and public.pulse_can_read_giving()
      )
    )
  );

drop policy if exists pulse_items_write on public.pulse_items;
create policy pulse_items_write on public.pulse_items
  for insert to authenticated
  with check (
    public.is_pulse_editor(team)
    and (
      metric_key is distinct from 'giving'
      or (
        team = 'executive'
        and coalesce(campus, 'church-wide') = 'church-wide'
        and public.pulse_can_read_giving()
      )
    )
  );

drop policy if exists pulse_items_update on public.pulse_items;
create policy pulse_items_update on public.pulse_items
  for update to authenticated
  using (
    public.is_pulse_editor(team)
    and (
      metric_key is distinct from 'giving'
      or (
        team = 'executive'
        and coalesce(campus, 'church-wide') = 'church-wide'
        and public.pulse_can_read_giving()
      )
    )
  )
  with check (
    public.is_pulse_editor(team)
    and (
      metric_key is distinct from 'giving'
      or (
        team = 'executive'
        and coalesce(campus, 'church-wide') = 'church-wide'
        and public.pulse_can_read_giving()
      )
    )
  );

drop policy if exists pulse_items_delete on public.pulse_items;
create policy pulse_items_delete on public.pulse_items
  for delete to authenticated
  using (
    public.is_pulse_editor(team)
    and (
      metric_key is distinct from 'giving'
      or (
        team = 'executive'
        and coalesce(campus, 'church-wide') = 'church-wide'
        and public.pulse_can_read_giving()
      )
    )
  );

drop policy if exists pulse_archives_insert on public.pulse_archives;
create policy pulse_archives_insert on public.pulse_archives
  for insert to authenticated
  with check (
    public.is_pulse_editor(team)
    and (team = 'pastoral' or campus = 'church-wide')
    and (
      giving_snapshot is null
      or (
        team = 'executive'
        and campus = 'church-wide'
        and public.pulse_can_read_giving()
      )
    )
  );
