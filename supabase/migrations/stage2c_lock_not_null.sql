-- ============================================================================
-- SCHEDLR MULTI-TENANT MIGRATION — STAGE 2C: Lock the vault door
-- ============================================================================
-- Now that every insert path has been verified to correctly stamp
-- organization_id, this makes it a hard requirement at the database level.
-- If any row anywhere still has a blank organization_id, the specific line
-- below for that table will fail loudly (rather than silently allowing bad
-- data) — if that happens, stop and tell me which line failed rather than
-- skipping it.
-- ============================================================================

alter table event_types alter column organization_id set not null;
alter table bookings alter column organization_id set not null;
alter table group_attendees alter column organization_id set not null;
alter table blocked_dates alter column organization_id set not null;
alter table recurring_days_off alter column organization_id set not null;
alter table vacations alter column organization_id set not null;
alter table partial_blocks alter column organization_id set not null;
alter table waitlist alter column organization_id set not null;
alter table audit_log alter column organization_id set not null;
alter table org_settings alter column organization_id set not null;

-- ============================================================================
-- Done. Stage 2 (membership-based security + mandatory organization_id) is
-- now complete. Next: Stage 3 — real signup that creates a brand-new
-- organization, and an invitation flow that replaces today's open
-- "create staff account" button.
-- ============================================================================
