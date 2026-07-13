import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../hooks/useAuth";
import { Panel, Field, ErrorBlock, LoadingBlock } from "../components/ui.jsx";

export default function AcceptInvitePage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading, signIn, signUp } = useAuth();
  const [preview, setPreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [mode, setMode] = useState("signup");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    async function loadPreview() {
      const { data, error } = await supabase.rpc("get_invitation_preview", { p_token: token }).maybeSingle();
      if (error || !data) setError("This invitation link isn't valid.");
      else setPreview(data);
      setLoadingPreview(false);
    }
    loadPreview();
  }, [token]);

  async function doAccept() {
    setBusy(true); setError("");
    const { error } = await supabase.rpc("accept_invitation", { p_token: token });
    setBusy(false); setAttempted(true);
    if (error) { setError(error.message); return; }
    setAccepted(true);
    setTimeout(() => navigate("/dashboard", { replace: true }), 1200);
  }

  // Already signed in (just created an account, or already had one) — try
  // redeeming the invite automatically rather than making them click again.
  useEffect(() => {
    if (!authLoading && user && preview?.status === "pending" && !accepted && !attempted) doAccept();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, preview]);

  async function submit(e) {
    e.preventDefault();
    setError(""); setBusy(true);
    const { error } = mode === "signup" ? await signUp(preview.email, password, name) : await signIn(preview.email, password);
    setBusy(false);
    if (error) setError(error.message);
    // on success, the effect above fires once `user` populates
  }

  if (loadingPreview || authLoading) return <LoadingBlock label="Checking your invitation…" />;
  if (error && !preview) return <div className="max-w-md mx-auto"><ErrorBlock message={error} /></div>;
  if (!preview) return null;

  if (preview.status !== "pending" && !accepted) {
    const msg = preview.status === "accepted" ? "This invitation has already been used."
      : preview.status === "expired" ? "This invitation has expired — ask whoever invited you for a new one."
      : "This invitation is no longer valid.";
    return <div className="max-w-md mx-auto"><ErrorBlock message={msg} /></div>;
  }

  if (accepted) {
    return (
      <div className="max-w-md mx-auto">
        <Panel className="cv-card text-center py-10">
          <div className="font-display font-bold text-lg mb-2">You're in!</div>
          <div className="cv-graphite text-sm">Taking you to your new team's Home screen…</div>
        </Panel>
      </div>
    );
  }

  if (user) return <LoadingBlock label="Joining the team…" />;

  return (
    <div className="max-w-md mx-auto">
      <Panel className="cv-card">
        <div className="cv-graphite font-mono text-[11px] tracking-widest mb-1 uppercase">You're invited</div>
        <div className="text-sm mb-5">
          Join <strong>{preview.organization_name}</strong> as <strong>{preview.role}</strong>.
        </div>
        <form onSubmit={submit} className="space-y-4">
          {mode === "signup" && (
            <Field label="Full name">
              <input value={name} onChange={(e) => setName(e.target.value)} className="cv-input w-full py-2" required />
            </Field>
          )}
          <Field label="Email">
            <input value={preview.email} disabled className="cv-input w-full py-2 opacity-60" />
          </Field>
          <Field label="Password">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="cv-input w-full py-2" required minLength={6} />
          </Field>
          {error && <ErrorBlock message={error} />}
          <button disabled={busy} type="submit" className="cv-btn-primary w-full px-4 py-2.5 font-mono text-xs tracking-widest uppercase">
            {busy ? "Please wait…" : mode === "signup" ? "Create account & join" : "Sign in & join"}
          </button>
        </form>
        <button onClick={() => setMode(mode === "signup" ? "signin" : "signup")} className="cv-link mt-4 w-full text-center font-mono text-xs tracking-widest uppercase">
          {mode === "signup" ? "Already have an account? Sign in" : "New here? Create an account"}
        </button>
      </Panel>
    </div>
  );
}
