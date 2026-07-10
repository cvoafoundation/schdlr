-- ============================================================================
-- SCHEDLR MULTI-TENANT MIGRATION — STAGE 3A: Real organization signup
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Fix a structural bug: org_settings was built assuming exactly one row
-- would ever exist (literally blocked by a database rule). A second
-- organization signing up would have hit a wall trying to save their
-- settings. This lets each organization have its own row instead.
-- ---------------------------------------------------------------------------
alter table org_settings drop constraint if exists single_row;
alter table org_settings add constraint org_settings_org_unique unique (organization_id);

do $$
begin
  if not exists (select 1 from pg_class where relname = 'org_settings_id_seq') then
    create sequence org_settings_id_seq owned by org_settings.id;
    perform setval('org_settings_id_seq', greatest((select max(id) from org_settings), 1));
  end if;
end $$;
alter table org_settings alter column id set default nextval('org_settings_id_seq');

-- ---------------------------------------------------------------------------
-- create_organization: the entire "new customer signs up" flow in one
-- atomic step. If anything inside fails, everything rolls back — no
-- half-created organizations left behind.
-- ---------------------------------------------------------------------------
create or replace function create_organization(p_org_name text, p_slug text, p_timezone text default 'America/New_York')
returns table (organization_id uuid, slug text)
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org_id uuid;
  clean_slug text;
  caller_name text;
  caller_initials text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to create an organization.';
  end if;

  if exists (select 1 from organization_members where user_id = auth.uid() and status = 'active') then
    raise exception 'Your account already belongs to an organization.';
  end if;

  clean_slug := lower(regexp_replace(trim(p_slug), '[^a-zA-Z0-9]+', '-', 'g'));
  clean_slug := trim(both '-' from clean_slug);
  if clean_slug = '' or clean_slug is null then
    raise exception 'Please choose a valid booking URL (letters, numbers, and dashes only).';
  end if;
  if exists (select 1 from organizations where organizations.slug = clean_slug) then
    raise exception 'That booking URL is already taken — please choose another.';
  end if;
  if trim(p_org_name) = '' then
    raise exception 'Please enter an organization name.';
  end if;

  select coalesce(nullif(trim(raw_user_meta_data->>'name'), ''), split_part(email, '@', 1))
    into caller_name from auth.users where id = auth.uid();
  caller_initials := compute_initials(caller_name);

  insert into organizations (name, slug, timezone, created_by, subscription_status, is_complimentary, trial_ends_at)
  values (trim(p_org_name), clean_slug, p_timezone, auth.uid(), 'trialing', false, now() + interval '14 days')
  returning id into new_org_id;

  insert into organization_members (organization_id, user_id, role, display_name, initials, booking_slug, is_bookable)
  values (new_org_id, auth.uid(), 'owner', caller_name, caller_initials, lower(regexp_replace(caller_name, '[^a-zA-Z0-9]+', '-', 'g')), true);

  insert into org_settings (organization_id, org_name, buffer_minutes, notice_hours, daily_cap, accent_color)
  values (new_org_id, trim(p_org_name), 15, 4, 6, '#B3261E');

  insert into event_types (id, code, title, duration_minutes, organization_id, sort_order) values
    (gen_random_uuid()::text, '01', '15 Minute Meeting', 15, new_org_id, 1),
    (gen_random_uuid()::text, '02', '30 Minute Meeting', 30, new_org_id, 2),
    (gen_random_uuid()::text, '03', '45 Minute Meeting', 45, new_org_id, 3),
    (gen_random_uuid()::text, '04', '60 Minute Meeting', 60, new_org_id, 4);
  insert into event_types (id, code, title, duration_minutes, is_group, capacity, fixed_minutes, organization_id, sort_order)
  values (gen_random_uuid()::text, '05', 'Group Orientation', 60, true, 8, 600, new_org_id, 5);

  return query select new_org_id, clean_slug;
end;
$$;

grant execute on function create_organization(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Quick check: is a booking-URL slug available? Used by the signup form to
-- give instant feedback before submitting.
-- ---------------------------------------------------------------------------
create or replace function is_slug_available(p_slug text)
returns boolean
language sql
security definer
stable
as $$
  select not exists (
    select 1 from organizations
    where slug = lower(regexp_replace(trim(p_slug), '[^a-zA-Z0-9]+', '-', 'g'))
  );
$$;
grant execute on function is_slug_available(text) to anon, authenticated;
