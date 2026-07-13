-- ============================================================================
-- CRITICAL FIX: the public slot-availability function had NO organization
-- filter at all — a second organization's bookings could affect what looks
-- available on CVOA's public booking page, and vice versa. This replaces it
-- with an org-scoped version.
-- ============================================================================

drop function if exists public_booking_slots(date, date);

create or replace function public_booking_slots(p_org_id uuid, p_from date, p_to date)
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
  where b.organization_id = p_org_id and b.booking_date between p_from and p_to and b.status <> 'canceled';
$$;

grant execute on function public_booking_slots(uuid, date, date) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Temporary bridge until Stage 4 builds real /book/:slug routing — lets the
-- public booking page resolve "which organization is this" safely, without
-- exposing anything beyond the id itself. Right now every public page still
-- always resolves to CVOA; Stage 4 replaces the hardcoded slug with a real
-- URL parameter.
-- ---------------------------------------------------------------------------
create or replace function get_org_id_by_slug(p_slug text)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select id from organizations where slug = p_slug;
$$;
grant execute on function get_org_id_by_slug(text) to anon, authenticated;
