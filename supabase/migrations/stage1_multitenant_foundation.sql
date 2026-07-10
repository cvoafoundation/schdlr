-- ============================================================================
-- SCHEDLR MULTI-TENANT MIGRATION — STAGE 1: Foundation tables + backfill
-- ============================================================================
-- What this does:
--   1. Creates organizations, billing_plans, organization_members,
--      organization_invitations, booking_management_tokens
--   2. Adds a (nullable, for now) organization_id to every existing tenant
--      table
--   3. Creates a "CVOA" organization, marks it complimentary (free forever),
--      and assigns every existing row to it
--   4. Makes you (Brandon) the owner
--
-- What this does NOT do yet (later stages):
--   - Rewrite RLS policies to be membership-based (Stage 2)
--   - Enforce organization_id as NOT NULL (happens at the end of Stage 2,
--     once we've verified zero orphaned rows)
--   - Build signup/invitation UI (Stage 3)
--   - Slug-based public booking URLs (Stage 4)
--   - Secure token-based guest booking management (Stage 5)
--   - Org switcher (Stage 6)
--   - Real Stripe wiring (Stage 8)
--
-- Safe to run: uses "if not exists" / "on conflict do nothing" throughout.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Billing plans (configurable pricing — add/edit rows here, no code changes
-- needed to adjust pricing later)
-- ---------------------------------------------------------------------------
create table if not exists billing_plans (
  id text primary key,
  name text not null,
  pricing_model text not null default 'flat' check (pricing_model in ('flat', 'per_seat', 'tiered')),
  monthly_price_cents int,               -- null for contact-only plans
  min_seats int not null default 1,
  max_seats int,                         -- null = unlimited
  stripe_price_id text,                  -- filled in once Stripe products exist
  contact_only boolean not null default false,
  sort_order int not null default 0
);

insert into billing_plans (id, name, monthly_price_cents, min_seats, max_seats, sort_order) values
  ('solo', 'Solo', 999, 1, 1, 1),
  ('team', 'Team', 2499, 2, 5, 2),
  ('business', 'Business', 4999, 6, 15, 3),
  ('organization', 'Organization', 9999, 16, 50, 4)
on conflict (id) do nothing;

insert into billing_plans (id, name, monthly_price_cents, min_seats, max_seats, contact_only, sort_order) values
  ('enterprise', 'Enterprise', null, 51, null, true, 5)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Organizations — the core tenant record
-- ---------------------------------------------------------------------------
create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  logo_url text,
  accent_color text not null default '#B3261E',
  timezone text not null default 'America/New_York',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- billing
  current_plan_id text references billing_plans(id),
  stripe_customer_id text,
  stripe_subscription_id text,
  subscription_status text not null default 'trialing'
    check (subscription_status in ('trialing', 'active', 'past_due', 'canceled', 'complimentary')),
  trial_ends_at timestamptz,
  seat_limit int,
  is_complimentary boolean not null default false,
  is_active boolean not null default true
);

-- ---------------------------------------------------------------------------
-- Organization membership — replaces the old is_admin flag entirely.
-- Also holds the org-specific display profile (initials, booking slug, etc.)
-- so one person can eventually belong to multiple orgs with different
-- roles/identities in each.
-- ---------------------------------------------------------------------------
create table if not exists organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'staff' check (role in ('owner', 'admin', 'staff')),
  status text not null default 'active' check (status in ('active', 'removed')),
  display_name text,
  initials text,
  booking_slug text,
  job_title text,
  avatar_url text,
  is_bookable boolean not null default true,
  invited_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (organization_id, user_id),
  unique (organization_id, booking_slug)
);

-- ---------------------------------------------------------------------------
-- Invitations — the only way to join an existing org (no more open signup
-- into someone else's workspace)
-- ---------------------------------------------------------------------------
create table if not exists organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  email text not null,
  role text not null default 'staff' check (role in ('owner', 'admin', 'staff')),
  token_hash text not null,
  invited_by uuid references auth.users(id),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Secure guest booking management — replaces "type your email" with an
-- unguessable per-booking token. Table only for now; wired up in Stage 5.
-- ---------------------------------------------------------------------------
create table if not exists booking_management_tokens (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days'),
  used_count int not null default 0
);

-- ---------------------------------------------------------------------------
-- Add organization_id to every existing tenant table (nullable for now —
-- becomes NOT NULL at the end of Stage 2, once backfill is verified below)
-- ---------------------------------------------------------------------------
alter table event_types add column if not exists organization_id uuid references organizations(id);
alter table bookings add column if not exists organization_id uuid references organizations(id);
alter table group_attendees add column if not exists organization_id uuid references organizations(id);
alter table blocked_dates add column if not exists organization_id uuid references organizations(id);
alter table recurring_days_off add column if not exists organization_id uuid references organizations(id);
alter table vacations add column if not exists organization_id uuid references organizations(id);
alter table partial_blocks add column if not exists organization_id uuid references organizations(id);
alter table waitlist add column if not exists organization_id uuid references organizations(id);
alter table audit_log add column if not exists organization_id uuid references organizations(id);
alter table org_settings add column if not exists organization_id uuid references organizations(id);

-- ---------------------------------------------------------------------------
-- Backfill: create the CVOA organization, mark it complimentary/exempt from
-- billing, assign every existing row to it, and make you the owner.
-- ---------------------------------------------------------------------------
do $$
declare
  cvoa_org_id uuid;
  owner_user_id uuid;
begin
  -- Create (or find) the CVOA org
  insert into organizations (name, slug, subscription_status, is_complimentary, trial_ends_at)
  values ('CVOA Foundation', 'cvoa', 'complimentary', true, null)
  on conflict (slug) do nothing;

  select id into cvoa_org_id from organizations where slug = 'cvoa';

  -- Find the current admin (you) to make the owner — falls back to the
  -- first team_members row with is_admin = true if more than one exists
  select id into owner_user_id from team_members where is_admin = true order by created_at asc limit 1;

  -- Backfill organization_members from today's team_members table
  insert into organization_members (organization_id, user_id, role, display_name, initials, booking_slug, avatar_url)
  select
    cvoa_org_id,
    tm.id,
    case when tm.id = owner_user_id then 'owner' when tm.is_admin then 'admin' else 'staff' end,
    tm.name,
    tm.initials,
    tm.slug,
    tm.avatar_url
  from team_members tm
  on conflict (organization_id, user_id) do nothing;

  -- Backfill every existing row across every tenant table
  update event_types set organization_id = cvoa_org_id where organization_id is null;
  update bookings set organization_id = cvoa_org_id where organization_id is null;
  update group_attendees set organization_id = cvoa_org_id where organization_id is null;
  update blocked_dates set organization_id = cvoa_org_id where organization_id is null;
  update recurring_days_off set organization_id = cvoa_org_id where organization_id is null;
  update vacations set organization_id = cvoa_org_id where organization_id is null;
  update partial_blocks set organization_id = cvoa_org_id where organization_id is null;
  update waitlist set organization_id = cvoa_org_id where organization_id is null;
  update audit_log set organization_id = cvoa_org_id where organization_id is null;
  update org_settings set organization_id = cvoa_org_id where organization_id is null;
end $$;

-- ---------------------------------------------------------------------------
-- Verification: run these SELECTs yourself after this migration to confirm
-- nothing was missed before we move to Stage 2. Every one of these should
-- return 0 rows.
-- ---------------------------------------------------------------------------
-- select * from event_types where organization_id is null;
-- select * from bookings where organization_id is null;
-- select * from group_attendees where organization_id is null;
-- select * from blocked_dates where organization_id is null;
-- select * from recurring_days_off where organization_id is null;
-- select * from vacations where organization_id is null;
-- select * from partial_blocks where organization_id is null;
-- select * from waitlist where organization_id is null;
-- select * from audit_log where organization_id is null;
-- select * from org_settings where organization_id is null;
-- select * from organization_members where organization_id = (select id from organizations where slug = 'cvoa');
