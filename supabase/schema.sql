-- ============================================================================
-- CVOA Scheduler — Database schema + Row Level Security
-- Run this once in your Supabase project's SQL editor (Database > SQL Editor).
-- Safe to re-run: uses "if not exists" / "or replace" where possible.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. TEAM MEMBERS
-- One row per staff account, linked 1:1 to a Supabase Auth user.
-- A row is created automatically when someone signs up (see trigger below),
-- but you'll want to fill in name/role/initials/slug yourself afterward.
-- ---------------------------------------------------------------------------
create table if not exists team_members (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default 'New Team Member',
  role text not null default '',
  initials text not null default '??',
  avatar_url text,
  slug text unique,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);
alter table team_members add column if not exists avatar_url text;

-- Computes initials as first letter of first name + last letter of last name,
-- ignoring punctuation and common suffixes (Jr, Sr, II, III, J.D., M.D., etc).
create or replace function compute_initials(full_name text)
returns text
language plpgsql
immutable
as $$
declare
  cleaned text;
  words text[];
  suffixes text[] := array['jr','sr','ii','iii','iv','v','md','jd','phd','esq'];
  filtered text[] := array[]::text[];
  w text;
begin
  cleaned := regexp_replace(coalesce(full_name, ''), '[.,]', '', 'g');
  words := regexp_split_to_array(trim(cleaned), '\s+');
  foreach w in array words loop
    if length(w) > 0 and lower(w) <> all(suffixes) then
      filtered := array_append(filtered, w);
    end if;
  end loop;
  if array_length(filtered, 1) is null or array_length(filtered, 1) = 0 then
    return upper(left(coalesce(full_name, '??'), 2));
  end if;
  return upper(left(filtered[1], 1) || left(filtered[array_length(filtered, 1)], 1));
end;
$$;

-- Auto-create a team_members row whenever someone signs up via Supabase Auth.
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.team_members (id, name, initials, slug)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    compute_initials(coalesce(new.raw_user_meta_data->>'name', new.email)),
    lower(regexp_replace(coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)), '[^a-zA-Z0-9]+', '-', 'g'))
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ---------------------------------------------------------------------------
-- 2. EVENT TYPES
-- The durations/sessions guests can pick from. Seeded with the defaults from
-- the prototype; edit freely in the table editor or via the Settings page later.
-- ---------------------------------------------------------------------------
create table if not exists event_types (
  id text primary key,
  code text not null,
  title text not null,
  duration_minutes int not null,
  is_group boolean not null default false,
  capacity int,
  fixed_minutes int,
  sort_order int not null default 0
);

insert into event_types (id, code, title, duration_minutes, sort_order) values
  ('e15', '01', '15 Minute Meeting', 15, 1),
  ('e30', '02', '30 Minute Meeting', 30, 2),
  ('e45', '03', '45 Minute Meeting', 45, 3),
  ('e60', '04', '60 Minute Meeting', 60, 4)
on conflict (id) do nothing;

insert into event_types (id, code, title, duration_minutes, is_group, capacity, fixed_minutes, sort_order) values
  ('group', '05', 'New Member Orientation (Group)', 60, true, 8, 600, 5)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. AVAILABILITY: single-date blocks, recurring days off, vacations, breaks
-- ---------------------------------------------------------------------------
create table if not exists blocked_dates (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references team_members(id) on delete cascade,
  blocked_date date not null,
  created_at timestamptz not null default now(),
  unique (member_id, blocked_date)
);

create table if not exists recurring_days_off (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references team_members(id) on delete cascade,
  weekday int not null check (weekday between 0 and 6),
  unique (member_id, weekday)
);

create table if not exists vacations (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references team_members(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  label text not null default 'Time off',
  created_at timestamptz not null default now()
);

create table if not exists partial_blocks (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references team_members(id) on delete cascade,
  recurring boolean not null default true,
  block_date date,
  start_minutes int not null,
  end_minutes int not null,
  label text not null default 'Time off',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 4. BOOKINGS
-- ---------------------------------------------------------------------------
create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  event_type_id text references event_types(id),
  member_id uuid references team_members(id),
  booking_date date not null,
  start_minutes int not null,
  duration_minutes int not null,
  guest_name text not null,
  guest_email text not null,
  guest_phone text,
  notes text,
  status text not null default 'upcoming' check (status in ('upcoming','completed','no-show','canceled')),
  urgent boolean not null default false,
  series_id uuid,
  series_index int,
  series_total int,
  created_at timestamptz not null default now()
);

create index if not exists bookings_member_date_idx on bookings (member_id, booking_date);
create index if not exists bookings_email_idx on bookings (lower(guest_email));

alter table bookings add column if not exists confirmation_sent boolean not null default false;
alter table bookings add column if not exists reminder_24h_sent boolean not null default false;
alter table bookings add column if not exists reminder_1h_sent boolean not null default false;

-- ---------------------------------------------------------------------------
-- Spam protection: enforced in the database, so it can't be bypassed even if
-- someone disables JavaScript or calls the API directly. Blocks a burst of
-- bookings from the same email address. Tune the numbers to taste.
-- ---------------------------------------------------------------------------
create or replace function enforce_booking_rate_limit()
returns trigger as $$
declare
  recent_count int;
  daily_count int;
begin
  select count(*) into recent_count from bookings
    where lower(guest_email) = lower(new.guest_email) and created_at > now() - interval '10 minutes';
  if recent_count >= 3 then
    raise exception 'Too many booking attempts. Please wait a few minutes and try again.';
  end if;

  select count(*) into daily_count from bookings
    where lower(guest_email) = lower(new.guest_email) and created_at > now() - interval '24 hours';
  if daily_count >= 10 then
    raise exception 'Too many bookings from this email today. Please contact us directly.';
  end if;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists bookings_rate_limit on bookings;
create trigger bookings_rate_limit before insert on bookings
  for each row execute procedure enforce_booking_rate_limit();

create table if not exists group_attendees (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  name text not null,
  email text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 5. WAITLIST
-- ---------------------------------------------------------------------------
create table if not exists waitlist (
  id uuid primary key default gen_random_uuid(),
  event_type_id text references event_types(id),
  member_id uuid references team_members(id), -- null = "any available"
  waitlist_date date not null,
  guest_name text not null,
  guest_email text not null,
  status text not null default 'waiting' check (status in ('waiting','notified')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 6. SETTINGS (single row) + AUDIT LOG
-- ---------------------------------------------------------------------------
create table if not exists org_settings (
  id int primary key default 1,
  org_name text not null default 'Schedlr',
  buffer_minutes int not null default 15,
  notice_hours int not null default 4,
  daily_cap int not null default 6,
  accent_color text not null default '#B3261E',
  logo_url text,
  constraint single_row check (id = 1)
);
insert into org_settings (id) values (1) on conflict (id) do nothing;
alter table org_settings add column if not exists org_name text not null default 'Schedlr';

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references team_members(id),
  action text not null,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- STORAGE (avatars + branding logo): set these up by clicking, not SQL —
-- Supabase blocks creating storage policies from the SQL Editor on most
-- projects. See the "Photos & logo" section in the setup instructions.
-- ============================================================================

-- ============================================================================
-- ROW LEVEL SECURITY
-- Guiding rule: staff can read everyone's availability (so the team overview
-- and booking engine work) but can only WRITE their own. Guests (anon/public)
-- can create bookings and join the waitlist, but can't browse other people's
-- booking data directly — the "manage my booking" flow instead goes through
-- the get_bookings_by_email() function below, which only returns matches for
-- the exact email provided.
-- ============================================================================

alter table team_members enable row level security;
alter table event_types enable row level security;
alter table blocked_dates enable row level security;
alter table recurring_days_off enable row level security;
alter table vacations enable row level security;
alter table partial_blocks enable row level security;
alter table bookings enable row level security;
alter table group_attendees enable row level security;
alter table waitlist enable row level security;
alter table org_settings enable row level security;
alter table audit_log enable row level security;

-- team_members: anyone can see the roster (needed for the public booking page
-- to list who you can book with); only the row's own owner can update it.
drop policy if exists "team_members_select_all" on team_members;
create policy "team_members_select_all" on team_members for select using (true);
drop policy if exists "team_members_update_self" on team_members;
create policy "team_members_update_self" on team_members for update using (auth.uid() = id);

-- event_types: public read (needed for the booking page); no public writes.
drop policy if exists "event_types_select_all" on event_types;
create policy "event_types_select_all" on event_types for select using (true);
drop policy if exists "event_types_staff_write" on event_types;
create policy "event_types_staff_write" on event_types for all using (auth.role() = 'authenticated');

-- availability tables: public read (booking page needs it to compute open
-- slots); only the owning staff member can insert/update/delete their own rows.
drop policy if exists "blocked_dates_select_all" on blocked_dates;
create policy "blocked_dates_select_all" on blocked_dates for select using (true);
drop policy if exists "blocked_dates_write_self" on blocked_dates;
create policy "blocked_dates_write_self" on blocked_dates for all using (auth.uid() = member_id) with check (auth.uid() = member_id);

drop policy if exists "recurring_days_off_select_all" on recurring_days_off;
create policy "recurring_days_off_select_all" on recurring_days_off for select using (true);
drop policy if exists "recurring_days_off_write_self" on recurring_days_off;
create policy "recurring_days_off_write_self" on recurring_days_off for all using (auth.uid() = member_id) with check (auth.uid() = member_id);

drop policy if exists "vacations_select_all" on vacations;
create policy "vacations_select_all" on vacations for select using (true);
drop policy if exists "vacations_write_self" on vacations;
create policy "vacations_write_self" on vacations for all using (auth.uid() = member_id) with check (auth.uid() = member_id);

drop policy if exists "partial_blocks_select_all" on partial_blocks;
create policy "partial_blocks_select_all" on partial_blocks for select using (true);
drop policy if exists "partial_blocks_write_self" on partial_blocks;
create policy "partial_blocks_write_self" on partial_blocks for all using (auth.uid() = member_id) with check (auth.uid() = member_id);

-- bookings: public (anon) can INSERT a booking (that's how guests book) but
-- cannot SELECT/UPDATE/DELETE directly — staff (authenticated) can do all of
-- that for the dashboard. Guests manage their own booking through the
-- get_bookings_by_email() / cancel_booking_by_email() functions below.
drop policy if exists "bookings_insert_public" on bookings;
create policy "bookings_insert_public" on bookings for insert with check (true);
drop policy if exists "bookings_staff_select" on bookings;
create policy "bookings_staff_select" on bookings for select using (auth.role() = 'authenticated');
drop policy if exists "bookings_staff_update" on bookings;
create policy "bookings_staff_update" on bookings for update using (auth.role() = 'authenticated');
drop policy if exists "bookings_staff_delete" on bookings;
create policy "bookings_staff_delete" on bookings for delete using (auth.role() = 'authenticated');

drop policy if exists "group_attendees_insert_public" on group_attendees;
create policy "group_attendees_insert_public" on group_attendees for insert with check (true);
drop policy if exists "group_attendees_staff_select" on group_attendees;
create policy "group_attendees_staff_select" on group_attendees for select using (auth.role() = 'authenticated');

-- waitlist: public can join; only staff can view/manage the list.
drop policy if exists "waitlist_insert_public" on waitlist;
create policy "waitlist_insert_public" on waitlist for insert with check (true);
drop policy if exists "waitlist_staff_select" on waitlist;
create policy "waitlist_staff_select" on waitlist for select using (auth.role() = 'authenticated');
drop policy if exists "waitlist_staff_update" on waitlist;
create policy "waitlist_staff_update" on waitlist for update using (auth.role() = 'authenticated');

-- org_settings: public read (booking page needs buffer/notice/cap); staff write.
drop policy if exists "org_settings_select_all" on org_settings;
create policy "org_settings_select_all" on org_settings for select using (true);
drop policy if exists "org_settings_staff_write" on org_settings;
create policy "org_settings_admin_write" on org_settings for update using (
  exists (select 1 from team_members tm where tm.id = auth.uid() and tm.is_admin = true)
);

-- audit_log: staff only, both read and write.
drop policy if exists "audit_log_staff_all" on audit_log;
create policy "audit_log_admin_select" on audit_log for select using (
  exists (select 1 from team_members tm where tm.id = auth.uid() and tm.is_admin = true)
);
create policy "audit_log_staff_insert" on audit_log for insert with check (auth.role() = 'authenticated');

-- ============================================================================
-- FUNCTIONS for the public "manage my booking" self-service flow.
-- SECURITY DEFINER lets these bypass RLS internally, but they only ever
-- return/affect rows matching the exact email passed in — a guest can never
-- see or touch someone else's booking through these.
-- ============================================================================

create or replace function get_bookings_by_email(p_email text)
returns setof bookings
language sql
security definer
set search_path = public
as $$
  select * from bookings
  where lower(guest_email) = lower(p_email)
    and status = 'upcoming'
  order by booking_date, start_minutes;
$$;

create or replace function cancel_booking_by_email(p_booking_id uuid, p_email text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected int;
begin
  update bookings set status = 'canceled'
  where id = p_booking_id and lower(guest_email) = lower(p_email);
  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

create or replace function reschedule_booking_by_email(p_booking_id uuid, p_email text, p_new_date date, p_new_start_minutes int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected int;
begin
  update bookings set booking_date = p_new_date, start_minutes = p_new_start_minutes
  where id = p_booking_id and lower(guest_email) = lower(p_email) and status = 'upcoming';
  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

-- Exposes ONLY scheduling data (no guest name/email/phone/notes) so the public
-- booking page can compute open slots without being able to read anyone's
-- personal information. This is the one safe "hole" through the RLS wall.
create or replace function public_booking_slots(p_from date, p_to date)
returns table (
  id uuid, member_id uuid, event_type_id text, booking_date date,
  start_minutes int, duration_minutes int, status text, is_group boolean,
  capacity int, attendee_count bigint
)
language sql
security definer
set search_path = public
as $$
  select b.id, b.member_id, b.event_type_id, b.booking_date, b.start_minutes, b.duration_minutes, b.status,
         et.is_group, et.capacity, coalesce(ga.cnt, 0) as attendee_count
  from bookings b
  join event_types et on et.id = b.event_type_id
  left join (select booking_id, count(*) as cnt from group_attendees group by booking_id) ga on ga.booking_id = b.id
  where b.booking_date between p_from and p_to and b.status <> 'canceled';
$$;

grant execute on function get_bookings_by_email(text) to anon, authenticated;
grant execute on function cancel_booking_by_email(uuid, text) to anon, authenticated;
grant execute on function reschedule_booking_by_email(uuid, text, date, int) to anon, authenticated;
grant execute on function public_booking_slots(date, date) to anon, authenticated;

-- ============================================================================
-- Done. Next: Authentication > Providers, make sure Email is enabled.
-- Then create your first staff account from the app's sign-up screen, and
-- edit that person's row in team_members (name/role/initials/is_admin) via
-- Table Editor. Repeat for each teammate.
-- ============================================================================
