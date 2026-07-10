-- ============================================================================
-- SCHEDLR MULTI-TENANT MIGRATION — STAGE 2A: Membership-based security rules
-- ============================================================================
-- Safe to run now: does NOT touch the tables the anonymous public booking
-- page reads directly (event_types, blocked_dates, recurring_days_off,
-- vacations, partial_blocks) — those get properly locked down in Stage 4
-- alongside the secure booking-function rebuild, so the live site never
-- breaks in between. Everything below only affects staff-facing data, and
-- your staff access keeps working because you're already a real member of
-- the CVOA organization (confirmed in Stage 1).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Reusable membership checks
-- ---------------------------------------------------------------------------
create or replace function is_org_member(check_org_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from organization_members om
    where om.organization_id = check_org_id and om.user_id = auth.uid() and om.status = 'active'
  );
$$;

create or replace function is_org_admin(check_org_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from organization_members om
    where om.organization_id = check_org_id and om.user_id = auth.uid()
      and om.status = 'active' and om.role in ('owner', 'admin')
  );
$$;

create or replace function is_org_owner(check_org_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from organization_members om
    where om.organization_id = check_org_id and om.user_id = auth.uid()
      and om.status = 'active' and om.role = 'owner'
  );
$$;

-- ---------------------------------------------------------------------------
-- organizations — members can read their own org; billing/sensitive fields
-- never exposed to anyone outside it. Admins can update; only the owner
-- can delete.
-- ---------------------------------------------------------------------------
alter table organizations enable row level security;
drop policy if exists "organizations_member_select" on organizations;
create policy "organizations_member_select" on organizations for select using (is_org_member(id));
drop policy if exists "organizations_admin_update" on organizations;
create policy "organizations_admin_update" on organizations for update using (is_org_admin(id));
drop policy if exists "organizations_owner_delete" on organizations;
create policy "organizations_owner_delete" on organizations for delete using (is_org_owner(id));
drop policy if exists "organizations_authenticated_insert" on organizations;
create policy "organizations_authenticated_insert" on organizations for insert with check (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- organization_members — see your own org's roster; admins manage roles;
-- a safeguard trigger stops anyone from promoting themselves.
-- ---------------------------------------------------------------------------
alter table organization_members enable row level security;
drop policy if exists "org_members_select" on organization_members;
create policy "org_members_select" on organization_members for select using (is_org_member(organization_id));
drop policy if exists "org_members_admin_write" on organization_members;
create policy "org_members_admin_write" on organization_members for insert with check (is_org_admin(organization_id));
drop policy if exists "org_members_update" on organization_members;
create policy "org_members_update" on organization_members for update
  using (is_org_admin(organization_id) or auth.uid() = user_id);
drop policy if exists "org_members_admin_delete" on organization_members;
create policy "org_members_admin_delete" on organization_members for delete using (is_org_admin(organization_id));

create or replace function prevent_self_role_escalation()
returns trigger language plpgsql as $$
begin
  if auth.uid() = old.user_id and new.role <> old.role and not is_org_admin(old.organization_id) then
    raise exception 'You cannot change your own role.';
  end if;
  return new;
end;
$$;
drop trigger if exists org_members_no_self_promote on organization_members;
create trigger org_members_no_self_promote before update on organization_members
  for each row execute procedure prevent_self_role_escalation();

-- ---------------------------------------------------------------------------
-- organization_invitations — admins of that org only
-- ---------------------------------------------------------------------------
alter table organization_invitations enable row level security;
drop policy if exists "invitations_admin_all" on organization_invitations;
create policy "invitations_admin_all" on organization_invitations for all
  using (is_org_admin(organization_id)) with check (is_org_admin(organization_id));

-- ---------------------------------------------------------------------------
-- billing_plans — public read (needed for a future pricing page); nobody
-- writes through the app, only you via direct SQL as the platform owner
-- ---------------------------------------------------------------------------
alter table billing_plans enable row level security;
drop policy if exists "billing_plans_select_all" on billing_plans;
create policy "billing_plans_select_all" on billing_plans for select using (true);

-- ---------------------------------------------------------------------------
-- booking_management_tokens — no direct access at all; only security-definer
-- functions (built in Stage 5) may touch this table
-- ---------------------------------------------------------------------------
alter table booking_management_tokens enable row level security;

-- ---------------------------------------------------------------------------
-- bookings / group_attendees / waitlist — reads scoped to your own org's
-- members; inserts stay open to the public for now (guests still need to
-- book without an account) — organization_id gets attached properly in
-- Stage 2B, tightened further in Stage 4.
-- ---------------------------------------------------------------------------
drop policy if exists "bookings_staff_select" on bookings;
create policy "bookings_staff_select" on bookings for select using (is_org_member(organization_id));
drop policy if exists "bookings_staff_update" on bookings;
create policy "bookings_staff_update" on bookings for update using (is_org_member(organization_id));
drop policy if exists "bookings_staff_delete" on bookings;
create policy "bookings_staff_delete" on bookings for delete using (is_org_member(organization_id));

drop policy if exists "group_attendees_staff_select" on group_attendees;
create policy "group_attendees_staff_select" on group_attendees for select using (is_org_member(organization_id));

drop policy if exists "waitlist_staff_select" on waitlist;
create policy "waitlist_staff_select" on waitlist for select using (is_org_member(organization_id));
drop policy if exists "waitlist_staff_update" on waitlist;
create policy "waitlist_staff_update" on waitlist for update using (is_org_member(organization_id));

-- ---------------------------------------------------------------------------
-- audit_log — admins of that org only (was previously admin-of-anything;
-- now correctly scoped per org too)
-- ---------------------------------------------------------------------------
drop policy if exists "audit_log_admin_select" on audit_log;
create policy "audit_log_admin_select" on audit_log for select using (is_org_admin(organization_id));

-- ---------------------------------------------------------------------------
-- org_settings — members read, admins write. (Still one row for CVOA today;
-- the "only one row ever" structural bug gets fixed in Stage 3.)
-- ---------------------------------------------------------------------------
drop policy if exists "org_settings_select_all" on org_settings;
create policy "org_settings_select_all" on org_settings for select using (is_org_member(organization_id));
drop policy if exists "org_settings_admin_write" on org_settings;
create policy "org_settings_admin_write" on org_settings for update using (is_org_admin(organization_id));

-- ============================================================================
-- Verify: as you (signed into the live app), everything on Home, Team
-- Availability, Analytics, and Settings should look completely unchanged.
-- The public booking page should also look unchanged (its tables weren't
-- touched in this stage). If anything looks different, stop and tell me
-- before we go further.
-- ============================================================================
