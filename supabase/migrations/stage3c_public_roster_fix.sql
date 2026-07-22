-- ============================================================================
-- FIX: the public booking page couldn't see any team members at all.
--
-- organization_members is correctly locked down to "must be a member to
-- view" for staff pages — but that also silently blocked the anonymous
-- public booking page from ever seeing who's bookable. This adds one
-- narrow, safe exception: a function that returns only display-safe fields
-- (name, role, photo) for ONE specific organization's bookable staff —
-- nothing sensitive, and never leaks across organizations.
-- ============================================================================

create or replace function get_public_org_roster(p_org_id uuid)
returns table (user_id uuid, display_name text, initials text, avatar_url text, job_title text)
language sql
security definer
set search_path = public
stable
as $$
  select user_id, display_name, initials, avatar_url, job_title
  from organization_members
  where organization_id = p_org_id and status = 'active' and is_bookable = true;
$$;

grant execute on function get_public_org_roster(uuid) to anon, authenticated;
