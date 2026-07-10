-- ============================================================================
-- SCHEDLR MULTI-TENANT MIGRATION — STAGE 2B, part 1 (SQL)
-- ============================================================================

-- Fix: org_settings holds public branding + scheduling-rule data that the
-- anonymous public booking page genuinely needs to function — it was never
-- actually sensitive. Reverting the read side back to public; writes stay
-- admin-only, which is the part that actually mattered.
drop policy if exists "org_settings_select_all" on org_settings;
create policy "org_settings_select_all" on org_settings for select using (true);
