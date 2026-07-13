import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../hooks/useAuth";
import { Panel, Field, ErrorBlock, LoadingBlock } from "../components/ui.jsx";

function slugify(v) {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export default function OnboardingPage() {
  const { user, orgId, loading: authLoading, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [orgName, setOrgName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugAvailable, setSlugAvailable] = useState(null);
  const [checkingSlug, setCheckingSlug] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // If this account already belongs to an org, skip straight to the app —
  // this page is only ever for brand-new accounts creating their workspace.
  useEffect(() => {
    if (!authLoading) {
      if (orgId) navigate("/dashboard", { replace: true });
      else setChecking(false);
    }
  }, [authLoading, orgId]);

  useEffect(() => {
    if (!slugTouched) setSlug(slugify(orgName));
  }, [orgName]);

  useEffect(() => {
    if (!slug) { setSlugAvailable(null); return; }
    setCheckingSlug(true);
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc("is_slug_available", { p_slug: slug });
      setSlugAvailable(data ?? null);
      setCheckingSlug(false);
    }, 400);
    return () => clearTimeout(t);
  }, [slug]);

  async function submit(e) {
    e.preventDefault();
    setError(""); setBusy(true);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
    const { data, error } = await supabase.rpc("create_organization", { p_org_name: orgName, p_slug: slug, p_timezone: timezone });
    if (error) { setBusy(false); setError(error.message); return; }
    await refreshProfile();
    setBusy(false);
    navigate("/dashboard", { replace: true });
  }

  if (authLoading || checking) return <LoadingBlock label="Setting things up…" />;
  if (!user) return null;

  return (
    <div className="max-w-md mx-auto">
      <Panel className="cv-card">
        <div className="cv-graphite font-mono text-[11px] tracking-widest mb-1 uppercase">Create your workspace</div>
        <div className="cv-graphite text-sm mb-5">A couple of quick details and you'll have a working booking page.</div>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Organization or business name">
            <input value={orgName} onChange={(e) => setOrgName(e.target.value)} className="cv-input w-full py-2" placeholder="Acme Consulting" required />
          </Field>
          <Field label="Your booking URL">
            <div className="flex items-center gap-1">
              <span className="cv-faint font-mono text-sm">schedlr.com/</span>
              <input
                value={slug}
                onChange={(e) => { setSlug(slugify(e.target.value)); setSlugTouched(true); }}
                className="cv-input flex-1 py-2 font-mono text-sm"
                placeholder="acme-consulting"
                required
              />
            </div>
            {slug && (
              <div className="mt-1 font-mono text-[11px]" style={{ color: checkingSlug ? "var(--faint)" : slugAvailable ? "var(--ink)" : "var(--stamp)" }}>
                {checkingSlug ? "Checking…" : slugAvailable ? "Available ✓" : "Already taken — try another"}
              </div>
            )}
          </Field>
          {error && <ErrorBlock message={error} />}
          <button
            disabled={busy || !orgName || !slug || slugAvailable === false}
            type="submit"
            className="cv-btn-primary w-full px-4 py-2.5 font-mono text-xs tracking-widest uppercase"
          >
            {busy ? "Creating…" : "Create workspace"}
          </button>
        </form>
      </Panel>
      <div className="cv-note font-mono text-[11px] mt-4 px-4 py-3">
        Your 14-day free trial starts now — no card required. Invite your team once you're in.
      </div>
    </div>
  );
}
