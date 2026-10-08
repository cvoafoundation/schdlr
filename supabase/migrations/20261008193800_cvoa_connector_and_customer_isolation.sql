-- CVOA is a customer of Schedlr. Authority is imported only by the connector
-- service after verifying a live CVOA session; customer/browser input cannot grant it.
create schema if not exists schedlr_private;
revoke all on schema schedlr_private from public, anon, authenticated;
grant usage on schema schedlr_private to service_role;
create table schedlr_private.cvoa_identities (
  external_id uuid primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade
);
create table schedlr_private.cvoa_workspaces (
  workspace_key text primary key,
  organization_id uuid not null unique references public.organizations(id) on delete cascade
);
alter table schedlr_private.cvoa_identities enable row level security;
alter table schedlr_private.cvoa_workspaces enable row level security;
alter table public.organizations add column managed_by text;
alter table public.organization_members add column membership_source text not null default 'standalone' check (membership_source in ('standalone','cvoa'));
alter table public.organization_members add column cvoa_access_until timestamptz;
create index org_members_user_active_idx on public.organization_members(user_id,organization_id) where status='active';
create index bookings_org_date_idx on public.bookings(organization_id,booking_date);
create index attendees_org_booking_idx on public.group_attendees(organization_id,booking_id);

create or replace function public.is_org_member(check_org_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.organization_members m where m.organization_id=check_org_id and m.user_id=(select auth.uid()) and m.status='active' and (m.membership_source='standalone' or m.cvoa_access_until>now()));
$$;
create or replace function public.is_org_admin(check_org_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.organization_members m where m.organization_id=check_org_id and m.user_id=(select auth.uid()) and m.status='active' and m.role in ('owner','admin') and (m.membership_source='standalone' or m.cvoa_access_until>now()));
$$;
create or replace function public.is_org_owner(check_org_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.organization_members m where m.organization_id=check_org_id and m.user_id=(select auth.uid()) and m.status='active' and m.role='owner' and m.membership_source='standalone');
$$;
revoke all on function public.is_org_member(uuid), public.is_org_admin(uuid), public.is_org_owner(uuid) from public;
grant execute on function public.is_org_member(uuid), public.is_org_admin(uuid), public.is_org_owner(uuid) to anon,authenticated,service_role;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path='' as $$
declare display text := coalesce(nullif(trim(new.raw_user_meta_data->>'name'),''),split_part(new.email,'@',1),'Team member');
begin
 insert into public.team_members(id,name,initials,slug) values(new.id,display,public.compute_initials(display),lower(regexp_replace(display,'[^a-zA-Z0-9]+','-','g'))||'-'||replace(new.id::text,'-',''));
 return new;
end;
$$;

create function public.cvoa_connector_identity(p_external_id uuid,p_user_id uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if p_user_id is not null then insert into schedlr_private.cvoa_identities values(p_external_id,p_user_id) on conflict(external_id) do nothing; end if;
 select user_id into result from schedlr_private.cvoa_identities where external_id=p_external_id;
 return result;
end;
$$;
revoke all on function public.cvoa_connector_identity(uuid,uuid) from public,anon,authenticated;
grant execute on function public.cvoa_connector_identity(uuid,uuid) to service_role;

create function public.cvoa_connector_sync(p_external_id uuid,p_name text,p_workspaces jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare person uuid; space jsonb; org uuid; result jsonb:='[]'; workspace text; label text;
begin
 select user_id into person from schedlr_private.cvoa_identities where external_id=p_external_id;
 if person is null then raise exception 'Connector identity not found.'; end if;
 if jsonb_typeof(p_workspaces)<>'array' or jsonb_array_length(p_workspaces)>2000 then raise exception 'Invalid workspaces.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('cvoa-user:'||person::text,0));
 update public.organization_members set status='removed',cvoa_access_until=now() where user_id=person and membership_source='cvoa';
 update public.team_members set name=left(coalesce(nullif(trim(p_name),''),'CVOA staff'),200),initials=public.compute_initials(p_name) where id=person;
 for space in select value from jsonb_array_elements(p_workspaces) loop
  workspace:=space->>'key'; label:=left(space->>'label',200);
  if workspace is null or workspace !~ '^(national|state:[A-Z]{2}|post:[0-9a-f-]{36})$' or space->>'role' not in ('admin','staff') or label is null then raise exception 'Invalid verified workspace.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('cvoa-space:'||workspace,0));
  select organization_id into org from schedlr_private.cvoa_workspaces where workspace_key=workspace;
  if org is null then
   if workspace='national' then select id into org from public.organizations where slug='cvoa'; end if;
   if org is null then
    org:=gen_random_uuid();
    insert into public.organizations(id,name,slug,created_by,is_complimentary,subscription_status,managed_by)
      values(org,label,'cvoa-'||lower(replace(workspace,':','-')),person,true,'complimentary','cvoa');
    insert into public.org_settings(organization_id,org_name) values(org,label);
    insert into public.event_types(id,organization_id,code,title,duration_minutes,sort_order)
      select org::text||'-e'||d::text,org,lpad(n::text,2,'0'),d::text||' Minute Meeting',d,n from unnest(array[15,30,45,60]) with ordinality as t(d,n);
   else update public.organizations set managed_by='cvoa' where id=org; end if;
   insert into schedlr_private.cvoa_workspaces values(workspace,org);
  end if;
  insert into public.organization_members(organization_id,user_id,role,status,display_name,initials,booking_slug,is_bookable,membership_source,cvoa_access_until)
   values(org,person,space->>'role','active',left(p_name,200),public.compute_initials(p_name),replace(person::text,'-',''),coalesce((space->>'bookable')::boolean,false),'cvoa',now()+interval '5 minutes')
   on conflict(organization_id,user_id) do update set role=excluded.role,status='active',display_name=excluded.display_name,initials=excluded.initials,is_bookable=excluded.is_bookable,membership_source='cvoa',cvoa_access_until=excluded.cvoa_access_until;
  result:=result||jsonb_build_array(jsonb_build_object('key',workspace,'organization_id',org));
 end loop;
 return result;
end;
$$;
revoke all on function public.cvoa_connector_sync(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.cvoa_connector_sync(uuid,text,jsonb) to service_role;

create function schedlr_private.guard_membership() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user not in ('anon','authenticated') then return case when tg_op='DELETE' then old else new end; end if;
 if tg_op='DELETE' then
  if old.membership_source='cvoa' or exists(select 1 from public.organizations where id=old.organization_id and managed_by='cvoa') then raise exception 'Manage CVOA appointments in CVOA.ONE Accounts & Access.'; end if;
  return old;
 end if;
 if new.membership_source='cvoa' or new.cvoa_access_until is not null or exists(select 1 from public.organizations where id=new.organization_id and managed_by='cvoa') then raise exception 'Manage CVOA appointments in CVOA.ONE Accounts & Access.'; end if;
 if tg_op='UPDATE' then
  if new.organization_id<>old.organization_id or new.user_id<>old.user_id or new.membership_source<>old.membership_source or new.cvoa_access_until is distinct from old.cvoa_access_until then raise exception 'Membership identity cannot change.'; end if;
  if new.role<>old.role and (not public.is_org_admin(old.organization_id) or (new.role='owner' and not public.is_org_owner(old.organization_id))) then raise exception 'Only an authorized owner can appoint an owner.'; end if;
  if new.status<>old.status and not public.is_org_admin(old.organization_id) then raise exception 'Only an admin can change membership status.'; end if;
 elsif new.role='owner' and not public.is_org_owner(new.organization_id) then raise exception 'Only an owner can appoint an owner.';
 end if;
 return new;
end;
$$;
create trigger connector_membership_guard before insert or update or delete on public.organization_members for each row execute function schedlr_private.guard_membership();

create function schedlr_private.guard_organization() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user in ('anon','authenticated') then
  if tg_op='INSERT' then raise exception 'Use organization signup.'; end if;
  if new.id<>old.id or new.managed_by is distinct from old.managed_by or new.is_complimentary<>old.is_complimentary or new.subscription_status<>old.subscription_status or new.current_plan_id is distinct from old.current_plan_id or new.stripe_customer_id is distinct from old.stripe_customer_id or new.stripe_subscription_id is distinct from old.stripe_subscription_id or new.seat_limit is distinct from old.seat_limit or new.trial_ends_at is distinct from old.trial_ends_at then raise exception 'Billing and integration fields are managed by the service.'; end if;
 end if;
 return new;
end;
$$;
create trigger connector_organization_guard before insert or update on public.organizations for each row execute function schedlr_private.guard_organization();

create or replace function public.prevent_self_role_escalation() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user in ('anon','authenticated') and auth.uid()=old.user_id and new.role<>old.role and not public.is_org_admin(old.organization_id) then raise exception 'You cannot change your own role.'; end if;
 return new;
end;
$$;

-- Remove permissive legacy policies that OR together with scoped policies.
drop policy if exists event_types_staff_write on public.event_types;
create policy event_types_admin_write on public.event_types for all to authenticated using(public.is_org_admin(organization_id)) with check(public.is_org_admin(organization_id));
drop policy if exists org_settings_staff_write on public.org_settings;
drop policy if exists audit_log_staff_all on public.audit_log;
drop policy if exists audit_log_staff_insert on public.audit_log;
create policy audit_log_scoped_insert on public.audit_log for insert to authenticated with check(public.is_org_member(organization_id) and actor_id=(select auth.uid()));
drop policy if exists team_members_select_all on public.team_members;
create policy team_members_scoped_select on public.team_members for select to authenticated using(id=(select auth.uid()) or exists(select 1 from public.organization_members m where m.user_id=team_members.id and m.status='active' and public.is_org_member(m.organization_id)));
-- Private availability labels are staff-only. Public booking sees only sanitized blocks.
do $$ declare t text; begin
 foreach t in array array['blocked_dates','recurring_days_off','vacations','partial_blocks'] loop
  execute format('drop policy if exists %I on public.%I',t||'_select_all',t);
  execute format('drop policy if exists %I on public.%I',t||'_write_self',t);
  execute format('create policy %I on public.%I for select to authenticated using(public.is_org_member(organization_id))',t||'_scoped_select',t);
  execute format('create policy %I on public.%I for all to authenticated using(public.is_org_member(organization_id) and (member_id=(select auth.uid()) or public.is_org_admin(organization_id))) with check(public.is_org_member(organization_id) and (member_id=(select auth.uid()) or public.is_org_admin(organization_id)) and exists(select 1 from public.organization_members m where m.organization_id=%I.organization_id and m.user_id=%I.member_id and m.status=''active''))',t||'_scoped_write',t,t,t);
 end loop;
end $$;
alter table public.blocked_dates drop constraint blocked_dates_member_id_blocked_date_key;
alter table public.blocked_dates add unique(organization_id,member_id,blocked_date);
alter table public.recurring_days_off drop constraint recurring_days_off_member_id_weekday_key;
alter table public.recurring_days_off add unique(organization_id,member_id,weekday);

create or replace function public.get_public_org_roster(p_org_id uuid) returns table(user_id uuid,display_name text,initials text,avatar_url text,job_title text)
language sql stable security definer set search_path='' as $$
 select m.user_id,m.display_name,m.initials,m.avatar_url,m.job_title from public.organization_members m join public.organizations o on o.id=m.organization_id where m.organization_id=p_org_id and m.status='active' and m.is_bookable and o.is_active;
$$;
create function public.public_availability(p_org_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 with roster as (select user_id from public.get_public_org_roster(p_org_id))
 select jsonb_build_object(
 'blocked_dates',(select coalesce(jsonb_agg(jsonb_build_object('member_id',member_id,'blocked_date',blocked_date)),'[]') from public.blocked_dates where organization_id=p_org_id and member_id in(select user_id from roster)),
 'recurring_days_off',(select coalesce(jsonb_agg(jsonb_build_object('member_id',member_id,'weekday',weekday)),'[]') from public.recurring_days_off where organization_id=p_org_id and member_id in(select user_id from roster)),
 'vacations',(select coalesce(jsonb_agg(jsonb_build_object('member_id',member_id,'start_date',start_date,'end_date',end_date)),'[]') from public.vacations where organization_id=p_org_id and member_id in(select user_id from roster)),
 'partial_blocks',(select coalesce(jsonb_agg(jsonb_build_object('member_id',member_id,'recurring',recurring,'block_date',block_date,'start_minutes',start_minutes,'end_minutes',end_minutes)),'[]') from public.partial_blocks where organization_id=p_org_id and member_id in(select user_id from roster)));
$$;
revoke all on function public.public_availability(uuid) from public;
grant execute on function public.public_availability(uuid) to anon,authenticated;
-- Email knowledge is not authentication. Legacy RPCs now obey caller RLS;
-- private guest management tokens are handled by the secure booking functions.
alter function public.get_bookings_by_email(text) security invoker;
alter function public.cancel_booking_by_email(uuid,text) security invoker;
alter function public.reschedule_booking_by_email(uuid,text,date,integer) security invoker;

-- ============================================================================
-- SCHEDLR MULTI-TENANT MIGRATION — STAGE 3B: Invitations
-- ============================================================================
-- Replaces the wide-open "create a staff account" button for joining an
-- EXISTING organization. From here forward, joining CVOA (or any org)
-- requires a real invitation from an admin — self-serve signup only ever
-- creates a brand-new organization (Stage 3A), never joins someone else's.
-- ============================================================================



-- ---------------------------------------------------------------------------
-- create_invitation: admin/owner generates a one-time, unguessable link.
-- The plaintext token is returned exactly once — only its hash is stored,
-- so even you can't look up a past invite's raw link again later.
-- ---------------------------------------------------------------------------
create or replace function create_invitation(p_org_id uuid, p_email text, p_role text default 'staff')
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  plain_token text;
  hashed text;
begin
  if not is_org_admin(p_org_id) then
    raise exception 'Only an admin or owner can invite teammates.';
  end if;
  if p_role not in ('owner', 'admin', 'staff') then
    raise exception 'Invalid role.';
  end if;

  if exists(select 1 from organizations where id=p_org_id and managed_by='cvoa') then raise exception 'Manage CVOA appointments in CVOA.ONE Accounts & Access.'; end if;
  if p_role='owner' and not is_org_owner(p_org_id) then raise exception 'Only an owner can invite owners.'; end if;
  if p_email is null or length(p_email)>320 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'A valid email is required.'; end if;
  plain_token := replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
  hashed := encode(sha256(convert_to(plain_token,'UTF8')),'hex');

  -- Only one live invite per email per org at a time
  update organization_invitations set status = 'revoked'
    where organization_id = p_org_id and lower(email) = lower(p_email) and status = 'pending';

  insert into organization_invitations (organization_id, email, role, token_hash, invited_by)
  values (p_org_id, lower(trim(p_email)), p_role, hashed, auth.uid());

  insert into audit_log (organization_id, actor_id, action)
  values (p_org_id, auth.uid(), 'invited ' || p_email || ' as ' || p_role);

  return plain_token;
end;
$$;
grant execute on function create_invitation(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- get_invitation_preview: lets the (possibly not-yet-signed-in) recipient
-- see who invited them and to where, before creating an account.
-- ---------------------------------------------------------------------------
create or replace function get_invitation_preview(p_token text)
returns table (organization_name text, email text, role text, status text, expires_at timestamptz)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select o.name, oi.email, oi.role, oi.status, oi.expires_at
  from organization_invitations oi
  join organizations o on o.id = oi.organization_id
  where oi.token_hash = encode(sha256(convert_to(p_token,'UTF8')),'hex');
$$;
grant execute on function get_invitation_preview(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- accept_invitation: the recipient, now authenticated, redeems the token.
-- Checked: token valid + pending + not expired, email matches exactly,
-- and the account doesn't already belong to another org (multi-org
-- membership per person is a later capability, not built yet).
-- ---------------------------------------------------------------------------
create or replace function accept_invitation(p_token text)
returns table (organization_id uuid, slug text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inv record;
  caller_email text;
  caller_name text;
  caller_initials text;
  org_slug text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to accept an invitation.';
  end if;

  select * into inv from organization_invitations
    where token_hash = encode(sha256(convert_to(p_token,'UTF8')),'hex') for update;

  if inv is null then raise exception 'This invitation link is invalid.'; end if;
  if inv.status <> 'pending' then raise exception 'This invitation has already been used or was revoked.'; end if;
  if inv.expires_at < now() then
    update organization_invitations set status = 'expired' where id = inv.id;
    raise exception 'This invitation has expired — ask for a new one.';
  end if;

  if exists(select 1 from organizations where id=inv.organization_id and managed_by='cvoa') then raise exception 'Manage CVOA appointments in CVOA.ONE.'; end if;
  select email into caller_email from auth.users where id = auth.uid() and email_confirmed_at is not null;
  if caller_email is null then raise exception 'Verify your email before accepting an invitation.'; end if;
  if lower(caller_email) <> lower(inv.email) then
    raise exception 'This invitation was sent to a different email address than the one you''re signed in with.';
  end if;

  if exists (select 1 from organization_members where user_id = auth.uid() and status = 'active') then
    raise exception 'Your account already belongs to an organization.';
  end if;

  select coalesce(nullif(trim(raw_user_meta_data->>'name'), ''), split_part(email, '@', 1))
    into caller_name from auth.users where id = auth.uid();
  caller_initials := compute_initials(caller_name);

  insert into organization_members (organization_id, user_id, role, display_name, initials, booking_slug, invited_by, is_bookable)
  values (inv.organization_id, auth.uid(), inv.role, caller_name, caller_initials,
          lower(regexp_replace(caller_name, '[^a-zA-Z0-9]+', '-', 'g'))||'-'||replace(auth.uid()::text,'-',''), inv.invited_by, true);

  update organization_invitations set status = 'accepted', accepted_at = now() where id = inv.id;

  insert into audit_log (organization_id, actor_id, action) values (inv.organization_id, auth.uid(), 'joined the team');

  select slug into org_slug from organizations where id = inv.organization_id;
  return query select inv.organization_id, org_slug;
end;
$$;
grant execute on function accept_invitation(text) to authenticated;

-- ---------------------------------------------------------------------------
-- revoke_invitation: admin cancels a pending invite before it's used
-- ---------------------------------------------------------------------------
create or replace function revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inv_org_id uuid;
begin
  select organization_id into inv_org_id from organization_invitations where id = p_invitation_id;
  if not is_org_admin(inv_org_id) then
    raise exception 'Only an admin or owner can revoke invitations.';
  end if;
  update organization_invitations set status = 'revoked' where id = p_invitation_id and status = 'pending';
end;
$$;
grant execute on function revoke_invitation(uuid) to authenticated;

revoke all on function public.create_invitation(uuid,text,text),public.accept_invitation(text),public.revoke_invitation(uuid) from public,anon;
grant execute on function public.create_invitation(uuid,text,text),public.accept_invitation(text),public.revoke_invitation(uuid) to authenticated;
revoke all on function public.get_invitation_preview(text) from public;
grant execute on function public.get_invitation_preview(text) to anon,authenticated;
-- Invitation table changes must use the validated RPCs, not arbitrary role/token edits.
drop policy if exists invitations_admin_all on public.organization_invitations;
create policy invitations_admin_select on public.organization_invitations for select to authenticated using(public.is_org_admin(organization_id));

-- Secure guest bookings: one atomic transaction, authoritative durations,
-- availability checks, serialized capacity, and private management links.
alter table public.booking_management_tokens drop constraint booking_management_tokens_token_hash_key;
create index booking_management_hash_idx on public.booking_management_tokens(token_hash);
alter table public.booking_management_tokens add column attendee_id uuid references public.group_attendees(id) on delete cascade;
create function schedlr_private.validate_slot(p_org uuid,p_event text,p_member uuid,p_date date,p_start integer,p_exclude uuid default null) returns void
language plpgsql security definer set search_path='' as $$
declare e public.event_types; rules public.org_settings; zone text; instant timestamptz;
begin
 select * into e from public.event_types where id=p_event and organization_id=p_org;
 select * into rules from public.org_settings where organization_id=p_org;
 select timezone into zone from public.organizations where id=p_org and is_active;
 if e.id is null or zone is null or rules.id is null then raise exception 'This booking page is unavailable.'; end if;
 if p_date is null or p_start is null or p_start<540 or p_start+e.duration_minutes>1020 or e.duration_minutes<=0 or e.duration_minutes>480 or extract(dow from p_date) in (0,6) then raise exception 'Choose an available weekday time.'; end if;
 instant:=(p_date::timestamp+make_interval(mins=>p_start)) at time zone zone;
 if instant<now()+make_interval(hours=>rules.notice_hours) or p_date>current_date+365 then raise exception 'This time does not meet the scheduling notice period.'; end if;
 if e.is_group then
  if p_member is not null or p_start is distinct from e.fixed_minutes then raise exception 'Choose the scheduled group session.'; end if;
  return;
 end if;
 if not exists(select 1 from public.get_public_org_roster(p_org) where user_id=p_member) then raise exception 'This staff member is not bookable in this organization.'; end if;
 if exists(select 1 from public.blocked_dates where organization_id=p_org and member_id=p_member and blocked_date=p_date)
 or exists(select 1 from public.recurring_days_off where organization_id=p_org and member_id=p_member and weekday=extract(dow from p_date))
 or exists(select 1 from public.vacations where organization_id=p_org and member_id=p_member and p_date between start_date and end_date)
 or exists(select 1 from public.partial_blocks where organization_id=p_org and member_id=p_member and (recurring or block_date=p_date) and start_minutes<p_start+e.duration_minutes+rules.buffer_minutes and end_minutes+rules.buffer_minutes>p_start)
 or exists(select 1 from public.bookings where organization_id=p_org and member_id=p_member and booking_date=p_date and status<>'canceled' and id is distinct from p_exclude and start_minutes<p_start+e.duration_minutes+rules.buffer_minutes and start_minutes+duration_minutes+rules.buffer_minutes>p_start)
 then raise exception 'That time is no longer available. Choose another time.'; end if;
 if (select count(*) from public.bookings where organization_id=p_org and member_id=p_member and booking_date=p_date and status<>'canceled' and id is distinct from p_exclude)>=rules.daily_cap then raise exception 'This staff member has reached their daily booking limit.'; end if;
end;
$$;
revoke all on function schedlr_private.validate_slot(uuid,text,uuid,date,integer,uuid) from public,anon,authenticated;

create or replace function public.enforce_booking_rate_limit() returns trigger language plpgsql security definer set search_path='' as $$
declare recent integer; daily integer;
begin
 if new.member_id is null then return new; end if;
 select count(distinct coalesce(series_id,id)) filter(where created_at>now()-interval '10 minutes'),count(distinct coalesce(series_id,id)) into recent,daily from public.bookings where organization_id=new.organization_id and lower(guest_email)=lower(new.guest_email) and created_at>now()-interval '24 hours' and (new.series_id is null or series_id is distinct from new.series_id);
 if recent>=3 or daily>=10 then raise exception 'Too many booking attempts. Please wait before trying again.'; end if;
 return new;
end;
$$;
create function public.create_public_booking(p_org_id uuid,p_event_id text,p_member_id uuid,p_dates jsonb,p_start integer,p_name text,p_email text,p_phone text default '',p_notes text default '',p_urgent boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.event_types; date_value jsonb; d date; booking uuid; attendee uuid; token text:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''); hashed text; result jsonb:='[]'; total integer; seq integer:=0; series uuid;
begin
 if p_name is null or trim(p_name)='' or length(p_name)>200 or p_email is null or length(p_email)>320 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or length(p_phone)>100 or length(p_notes)>5000 then raise exception 'Enter a name and valid email address.'; end if;
 if p_dates is null or jsonb_typeof(p_dates)<>'array' then raise exception 'Invalid booking dates.'; end if;
 total:=jsonb_array_length(p_dates);
 if total not between 1 and 6 or (select count(distinct value) from jsonb_array_elements(p_dates))<>total then raise exception 'Choose one to six different dates.'; end if;
 select * into e from public.event_types where id=p_event_id and organization_id=p_org_id;
 if e.id is null then raise exception 'Invalid session.'; end if;
 if e.is_group and total<>1 then raise exception 'Group sessions cannot be booked as a series.'; end if;
 if total>1 then series:=gen_random_uuid(); end if;
 -- All bookings for the same calendar are serialized through this transaction.
 perform pg_advisory_xact_lock(hashtextextended('booking:'||p_org_id::text,0));
 hashed:=encode(sha256(convert_to(token,'UTF8')),'hex');
 for date_value in select value from jsonb_array_elements(p_dates) loop
  d:=(date_value#>>'{}')::date; seq:=seq+1;
  perform schedlr_private.validate_slot(p_org_id,p_event_id,p_member_id,d,p_start);
  if e.is_group then
   select id into booking from public.bookings where organization_id=p_org_id and event_type_id=p_event_id and booking_date=d and status='upcoming' for update;
   if booking is null then
    insert into public.bookings(organization_id,event_type_id,booking_date,start_minutes,duration_minutes,guest_name,guest_email) values(p_org_id,p_event_id,d,p_start,e.duration_minutes,'Group session','group@schedlr.invalid') returning id into booking;
   end if;
   if e.capacity is null or e.capacity<=0 or (select count(*) from public.group_attendees where booking_id=booking)>=e.capacity then raise exception 'This group session is full.'; end if;
   if exists(select 1 from public.group_attendees where booking_id=booking and lower(email)=lower(trim(p_email))) then raise exception 'This email is already registered for this session.'; end if;
   if (select count(*) from public.group_attendees where organization_id=p_org_id and lower(email)=lower(trim(p_email)) and created_at>now()-interval '10 minutes')>=3 then raise exception 'Too many booking attempts. Please wait.'; end if;
   insert into public.group_attendees(organization_id,booking_id,name,email) values(p_org_id,booking,trim(p_name),lower(trim(p_email))) returning id into attendee;
  else
   insert into public.bookings(organization_id,event_type_id,member_id,booking_date,start_minutes,duration_minutes,guest_name,guest_email,guest_phone,notes,urgent,series_id,series_index,series_total)
    values(p_org_id,p_event_id,p_member_id,d,p_start,e.duration_minutes,trim(p_name),lower(trim(p_email)),p_phone,p_notes,coalesce(p_urgent,false),series,seq,total) returning id into booking;
  end if;
  insert into public.booking_management_tokens(booking_id,attendee_id,token_hash,expires_at) values(booking,attendee,hashed,greatest(now()+interval '90 days',(d+14)::timestamptz));
  result:=result||jsonb_build_array(jsonb_build_object('id',booking,'booking_date',d,'start_minutes',p_start,'duration_minutes',e.duration_minutes));
 end loop;
 return jsonb_build_object('bookings',result,'management_token',token);
end;
$$;
revoke all on function public.create_public_booking(uuid,text,uuid,jsonb,integer,text,text,text,text,boolean) from public;
grant execute on function public.create_public_booking(uuid,text,uuid,jsonb,integer,text,text,text,text,boolean) to anon,authenticated;
-- Direct public inserts would bypass the atomic validations above.
drop policy if exists bookings_insert_public on public.bookings;
drop policy if exists group_attendees_insert_public on public.group_attendees;
create policy bookings_member_insert on public.bookings for insert to authenticated with check(public.is_org_member(organization_id));

create function public.manage_public_booking(p_token text,p_action text default 'read',p_booking_id uuid default null,p_new_date date default null,p_new_start integer default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare hashed text; access_row public.booking_management_tokens; b public.bookings; result jsonb;
begin
 if p_token is null or length(p_token)<>64 or p_token !~ '^[0-9a-f]+$' or p_action not in ('read','cancel','reschedule') then raise exception 'A valid private management link is required.'; end if;
 hashed:=encode(sha256(convert_to(p_token,'UTF8')),'hex');
 if p_action<>'read' then
  select * into access_row from public.booking_management_tokens where token_hash=hashed and booking_id=p_booking_id and expires_at>now() limit 1;
  if access_row.id is null then raise exception 'Management link is invalid or expired.'; end if;
  select * into b from public.bookings where id=access_row.booking_id;
  perform pg_advisory_xact_lock(hashtextextended('booking:'||b.organization_id::text,0));
  if p_action='cancel' then
   if access_row.attendee_id is not null then delete from public.group_attendees where id=access_row.attendee_id;
   else update public.bookings set status='canceled' where id=b.id and status='upcoming'; end if;
  else
   if access_row.attendee_id is not null then raise exception 'Cancel your group attendance and book the preferred session instead.'; end if;
   if b.status<>'upcoming' then raise exception 'Only upcoming bookings can be rescheduled.'; end if;
   perform schedlr_private.validate_slot(b.organization_id,b.event_type_id,b.member_id,p_new_date,p_new_start,b.id);
   update public.bookings set booking_date=p_new_date,start_minutes=p_new_start where id=b.id;
   update public.booking_management_tokens set expires_at=greatest(expires_at,(p_new_date+14)::timestamptz) where booking_id=b.id;
  end if;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',bk.id,'organization_id',bk.organization_id,'organization_name',o.name,'booking_date',bk.booking_date,'start_minutes',bk.start_minutes,'duration_minutes',bk.duration_minutes,'member_id',bk.member_id,'host_name',m.display_name,'is_group',t.attendee_id is not null,'status',bk.status) order by bk.booking_date,bk.start_minutes),'[]') into result
 from public.booking_management_tokens t join public.bookings bk on bk.id=t.booking_id join public.organizations o on o.id=bk.organization_id left join public.organization_members m on m.organization_id=bk.organization_id and m.user_id=bk.member_id
 where t.token_hash=hashed and t.expires_at>now() and bk.status='upcoming' and (t.attendee_id is null or exists(select 1 from public.group_attendees where id=t.attendee_id));
 return result;
end;
$$;
revoke all on function public.manage_public_booking(text,text,uuid,date,integer) from public;
grant execute on function public.manage_public_booking(text,text,uuid,date,integer) to anon,authenticated;
-- Cross-company references cannot be forged on staff updates or waitlist inserts.
create function schedlr_private.guard_booking_links() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.event_type_id is not null and not exists(select 1 from public.event_types where id=new.event_type_id and organization_id=new.organization_id) then raise exception 'Session belongs to another organization.'; end if;
 if new.member_id is not null and not exists(select 1 from public.organization_members where organization_id=new.organization_id and user_id=new.member_id and status='active') then raise exception 'Staff member belongs to another organization.'; end if;
 if tg_op='UPDATE' and new.organization_id<>old.organization_id then raise exception 'Booking organization cannot change.'; end if;
 return new;
end;
$$;
create trigger booking_links_guard before insert or update on public.bookings for each row execute function schedlr_private.guard_booking_links();
create trigger waitlist_links_guard before insert or update on public.waitlist for each row execute function schedlr_private.guard_booking_links();
-- Public images stay readable; new uploads belong to an organization/user folder.
do $$ declare p record; begin
 for p in select policyname from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'branding_authenticated_write%' loop execute format('drop policy %I on storage.objects',p.policyname); end loop;
end $$;
create policy schedlr_images_read on storage.objects for select to anon,authenticated using(bucket_id in ('branding','avatars'));
create policy schedlr_branding_insert on storage.objects for insert to authenticated with check(bucket_id='branding' and public.is_org_admin(case when split_part(name,'/',1) ~ '^[0-9a-f-]{36}$' then split_part(name,'/',1)::uuid else null end));
create policy schedlr_branding_update on storage.objects for update to authenticated using(bucket_id='branding' and public.is_org_admin(case when split_part(name,'/',1) ~ '^[0-9a-f-]{36}$' then split_part(name,'/',1)::uuid else null end)) with check(bucket_id='branding' and public.is_org_admin(case when split_part(name,'/',1) ~ '^[0-9a-f-]{36}$' then split_part(name,'/',1)::uuid else null end));
create policy schedlr_branding_delete on storage.objects for delete to authenticated using(bucket_id='branding' and public.is_org_admin(case when split_part(name,'/',1) ~ '^[0-9a-f-]{36}$' then split_part(name,'/',1)::uuid else null end));
create policy schedlr_avatar_insert on storage.objects for insert to authenticated with check(bucket_id='avatars' and split_part(name,'/',1)=(select auth.uid())::text);
create function schedlr_private.guard_team_identity() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user in ('anon','authenticated') and (new.id<>old.id or new.is_admin<>old.is_admin) then raise exception 'Account authority is managed through organization appointments.'; end if;
 return new;
end;
$$;
create trigger team_identity_guard before update on public.team_members for each row execute function schedlr_private.guard_team_identity();
