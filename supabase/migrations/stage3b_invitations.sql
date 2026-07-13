-- ============================================================================
-- SCHEDLR MULTI-TENANT MIGRATION — STAGE 3B: Invitations
-- ============================================================================
-- Replaces the wide-open "create a staff account" button for joining an
-- EXISTING organization. From here forward, joining CVOA (or any org)
-- requires a real invitation from an admin — self-serve signup only ever
-- creates a brand-new organization (Stage 3A), never joins someone else's.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- create_invitation: admin/owner generates a one-time, unguessable link.
-- The plaintext token is returned exactly once — only its hash is stored,
-- so even you can't look up a past invite's raw link again later.
-- ---------------------------------------------------------------------------
create or replace function create_invitation(p_org_id uuid, p_email text, p_role text default 'staff')
returns text
language plpgsql
security definer
set search_path = public
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

  plain_token := encode(gen_random_bytes(24), 'hex');
  hashed := encode(digest(plain_token, 'sha256'), 'hex');

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
set search_path = public
stable
as $$
  select o.name, oi.email, oi.role, oi.status, oi.expires_at
  from organization_invitations oi
  join organizations o on o.id = oi.organization_id
  where oi.token_hash = encode(digest(p_token, 'sha256'), 'hex');
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
set search_path = public
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
    where token_hash = encode(digest(p_token, 'sha256'), 'hex');

  if inv is null then raise exception 'This invitation link is invalid.'; end if;
  if inv.status <> 'pending' then raise exception 'This invitation has already been used or was revoked.'; end if;
  if inv.expires_at < now() then
    update organization_invitations set status = 'expired' where id = inv.id;
    raise exception 'This invitation has expired — ask for a new one.';
  end if;

  select email into caller_email from auth.users where id = auth.uid();
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
          lower(regexp_replace(caller_name, '[^a-zA-Z0-9]+', '-', 'g')), inv.invited_by, true);

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
set search_path = public
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
