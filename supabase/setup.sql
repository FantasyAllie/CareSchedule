-- CareSchedule shared storage for Supabase.
-- Paste this whole file into Supabase → SQL Editor → New query, and press Run. It is safe to run again.
--
-- Only people whose email is in cs_staff can see or change anything. Add your office staff at the bottom.
-- Writing is only possible through the functions below, and only by the person who currently holds the
-- editing lock (one editor at a time). Everyone else can read the rota, so all devices stay in step.

-- ---------- tables ----------
create table if not exists public.cs_staff (
  email     text primary key,
  name      text not null,
  added_at  timestamptz not null default now()
);

create table if not exists public.cs_state (
  id          text primary key default 'main',
  data        jsonb not null,
  version     bigint not null default 1,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

create table if not exists public.cs_lock (
  id            text primary key default 'main',
  holder        uuid,
  holder_name   text,
  device        text,
  since         timestamptz,
  heartbeat     timestamptz,
  request_from  text,
  request_at    timestamptz
);
insert into public.cs_lock (id) values ('main') on conflict do nothing;

-- one copy of the data per day, kept for 30 days (made automatically when saving)
create table if not exists public.cs_backups (
  day         date primary key,
  data        jsonb not null,
  version     bigint not null,
  saved_at    timestamptz not null default now()
);

alter table public.cs_staff   enable row level security;
alter table public.cs_state   enable row level security;
alter table public.cs_lock    enable row level security;
alter table public.cs_backups enable row level security;

-- ---------- who is staff ----------
create or replace function public.cs_is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from cs_staff where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

create or replace function public.cs_my_name() returns text
language sql stable security definer set search_path = public as $$
  select name from cs_staff where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

-- staff can read; nobody can write directly (only through the functions below)
drop policy if exists cs_staff_read  on public.cs_staff;
drop policy if exists cs_state_read  on public.cs_state;
drop policy if exists cs_lock_read   on public.cs_lock;
drop policy if exists cs_backups_read on public.cs_backups;
create policy cs_staff_read   on public.cs_staff   for select to authenticated using (public.cs_is_staff());
create policy cs_state_read   on public.cs_state   for select to authenticated using (public.cs_is_staff());
create policy cs_lock_read    on public.cs_lock    for select to authenticated using (public.cs_is_staff());
create policy cs_backups_read on public.cs_backups for select to authenticated using (public.cs_is_staff());

-- ---------- one editor at a time ----------
-- An editor's device refreshes its heartbeat every 30 seconds; a lock not refreshed for 2 minutes
-- (app closed, phone locked, signal lost) can be taken by someone else.
create or replace function public.cs_lock_view(l public.cs_lock) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'holder_name', l.holder_name, 'device', l.device, 'since', l.since, 'heartbeat', l.heartbeat,
    'mine', l.holder is not distinct from auth.uid() and l.holder is not null,
    'stale', l.holder is null or l.heartbeat < now() - interval '2 minutes',
    'request_from', l.request_from, 'request_at', l.request_at);
$$;

create or replace function public.cs_take_lock(p_device text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l cs_lock;
begin
  if not cs_is_staff() then raise exception 'not_staff'; end if;
  select * into l from cs_lock where id = 'main' for update;
  if l.holder is null or l.holder = auth.uid() or l.heartbeat < now() - interval '2 minutes' then
    update cs_lock set
      holder = auth.uid(), holder_name = cs_my_name(), device = left(p_device, 80),
      since = case when l.holder = auth.uid() then l.since else now() end,
      heartbeat = now(), request_from = null, request_at = null
    where id = 'main' returning * into l;
  end if;
  return cs_lock_view(l);
end $$;

create or replace function public.cs_heartbeat() returns jsonb
language plpgsql security definer set search_path = public as $$
declare l cs_lock;
begin
  if not cs_is_staff() then raise exception 'not_staff'; end if;
  update cs_lock set heartbeat = now() where id = 'main' and holder = auth.uid() returning * into l;
  if not found then select * into l from cs_lock where id = 'main'; end if;
  return cs_lock_view(l);
end $$;

create or replace function public.cs_release() returns jsonb
language plpgsql security definer set search_path = public as $$
declare l cs_lock;
begin
  if not cs_is_staff() then raise exception 'not_staff'; end if;
  update cs_lock set holder = null, holder_name = null, device = null, since = null, heartbeat = null,
    request_from = null, request_at = null
  where id = 'main' and holder = auth.uid();
  select * into l from cs_lock where id = 'main';
  return cs_lock_view(l);
end $$;

-- ask the current editor to hand over
create or replace function public.cs_request_edit() returns jsonb
language plpgsql security definer set search_path = public as $$
declare l cs_lock;
begin
  if not cs_is_staff() then raise exception 'not_staff'; end if;
  update cs_lock set request_from = cs_my_name(), request_at = now()
  where id = 'main' and holder is not null and holder <> auth.uid() returning * into l;
  if not found then select * into l from cs_lock where id = 'main'; end if;
  return cs_lock_view(l);
end $$;

-- what every device checks every few seconds: the rota's version and who is editing.
-- For the editor it also counts as their heartbeat.
create or replace function public.cs_status() returns jsonb
language plpgsql security definer set search_path = public as $$
declare l cs_lock; st cs_state;
begin
  if not cs_is_staff() then raise exception 'not_staff'; end if;
  update cs_lock set heartbeat = now() where id = 'main' and holder = auth.uid() returning * into l;
  if not found then select * into l from cs_lock where id = 'main'; end if;
  select * into st from cs_state where id = 'main';
  return jsonb_build_object('lock', cs_lock_view(l), 'version', coalesce(st.version, 0),
    'updated_at', st.updated_at, 'updated_by', st.updated_by, 'me', cs_my_name());
end $$;

-- ---------- saving ----------
-- Saves the whole rota. Only the lock holder can save, and only on top of the version they last saw.
create or replace function public.cs_save(p_expected bigint, p_data jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare cur cs_state; v bigint;
begin
  if not cs_is_staff() then raise exception 'not_staff'; end if;
  if not exists (select 1 from cs_lock where id = 'main' and holder = auth.uid()) then
    raise exception 'not_editor';
  end if;
  select * into cur from cs_state where id = 'main' for update;
  if not found then
    if p_expected <> 0 then raise exception 'version_conflict'; end if;
    insert into cs_state (id, data, version, updated_by) values ('main', p_data, 1, cs_my_name());
    return 1;
  end if;
  if cur.version <> p_expected then raise exception 'version_conflict'; end if;
  -- first save of the day keeps the previous copy as that day's backup
  insert into cs_backups (day, data, version) values (current_date, cur.data, cur.version) on conflict (day) do nothing;
  delete from cs_backups where day < current_date - 30;
  v := cur.version + 1;
  update cs_state set data = p_data, version = v, updated_at = now(), updated_by = cs_my_name() where id = 'main';
  -- saving counts as being active
  update cs_lock set heartbeat = now() where id = 'main' and holder = auth.uid();
  return v;
end $$;

-- ---------- permissions ----------
revoke all on public.cs_staff, public.cs_state, public.cs_lock, public.cs_backups from anon;
grant select on public.cs_staff, public.cs_state, public.cs_lock, public.cs_backups to authenticated;
revoke execute on function public.cs_status(), public.cs_take_lock(text), public.cs_heartbeat(), public.cs_release(),
  public.cs_request_edit(), public.cs_save(bigint, jsonb), public.cs_is_staff(), public.cs_my_name() from public, anon;
grant execute on function public.cs_status(), public.cs_take_lock(text), public.cs_heartbeat(), public.cs_release(),
  public.cs_request_edit(), public.cs_save(bigint, jsonb), public.cs_is_staff(), public.cs_my_name() to authenticated;

-- ---------- your office staff ----------
-- Add one line per person (the email they will sign in with). Run again whenever you add someone.
-- insert into public.cs_staff (email, name) values ('sarah@yourcompany.co.uk', 'Sarah') on conflict (email) do update set name = excluded.name;
