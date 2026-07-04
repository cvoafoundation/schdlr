import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { Panel, Field, ErrorBlock } from "../components/ui.jsx";

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
    if (password !== confirm) { setError("Passwords don't match."); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setDone(true);
    setTimeout(() => navigate("/team"), 1500);
  }

  return (
    <div className="max-w-sm mx-auto">
      <Panel className="cv-card">
        <div className="cv-graphite font-mono text-[11px] tracking-widest mb-4 uppercase">Set a new password</div>
        {done ? (
          <div className="cv-note font-mono text-[11px] px-4 py-3">Password updated — taking you in…</div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <Field label="New password">
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="cv-input w-full py-2" required minLength={6} />
            </Field>
            <Field label="Confirm new password">
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="cv-input w-full py-2" required minLength={6} />
            </Field>
            {error && <ErrorBlock message={error} />}
            <button disabled={busy} type="submit" className="cv-btn-primary w-full px-4 py-2.5 font-mono text-xs tracking-widest uppercase">
              {busy ? "Saving…" : "Save new password"}
            </button>
          </form>
        )}
      </Panel>
      <div className="cv-note font-mono text-[11px] mt-4 px-4 py-3">
        This page only works when opened from the reset link in your email — Supabase signs you in temporarily just
        long enough to set a new password.
      </div>
    </div>
  );
}
