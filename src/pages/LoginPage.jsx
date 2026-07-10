import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { supabase } from "../lib/supabaseClient";
import { Panel, Field, ErrorBlock } from "../components/ui.jsx";

export default function LoginPage() {
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState("signin"); // 'signin' | 'signup' | 'forgot'
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(""); setNotice(""); setBusy(true);

    if (mode === "forgot") {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      setBusy(false);
      if (error) { setError(error.message); return; }
      setNotice("If an account exists for that email, a reset link is on its way — check your inbox (and spam).");
      return;
    }

    const { error } = mode === "signin" ? await signIn(email, password) : await signUp(email, password, name);
    setBusy(false);
    if (error) { setError(error.message); return; }
    navigate("/team");
  }

  return (
    <div className="max-w-sm mx-auto">
      <Panel className="cv-card">
        <div className="cv-graphite font-mono text-[11px] tracking-widest mb-4 uppercase">
          {mode === "signin" ? "Staff sign in" : mode === "signup" ? "Create staff account" : "Reset your password"}
        </div>
        <form onSubmit={submit} className="space-y-4">
          {mode === "signup" && (
            <Field label="Full name">
              <input value={name} onChange={(e) => setName(e.target.value)} className="cv-input w-full py-2" placeholder="J. Ramirez" required />
            </Field>
          )}
          <Field label="Email">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="cv-input w-full py-2" required />
          </Field>
          {mode !== "forgot" && (
            <Field label="Password">
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="cv-input w-full py-2" required minLength={6} />
            </Field>
          )}
          {error && <ErrorBlock message={error} />}
          {notice && <div className="cv-note font-mono text-[11px] px-4 py-3">{notice}</div>}
          <button disabled={busy} type="submit" className="cv-btn-primary w-full px-4 py-2.5 font-mono text-xs tracking-widest uppercase">
            {busy ? "Please wait…" : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}
          </button>
        </form>

        <div className="mt-4 space-y-2 text-center">
          {mode === "signin" && (
            <button onClick={() => { setMode("forgot"); setError(""); setNotice(""); }} className="cv-link block w-full font-mono text-xs tracking-widest uppercase">
              Forgot password?
            </button>
          )}
          <button
            onClick={() => { setMode(mode === "signup" ? "signin" : mode === "forgot" ? "signin" : "signup"); setError(""); setNotice(""); }}
            className="cv-link block w-full font-mono text-xs tracking-widest uppercase"
          >
            {mode === "signup" ? "Already have an account? Sign in" : mode === "forgot" ? "Back to sign in" : "New team member? Create an account"}
          </button>
        </div>
      </Panel>
      {mode === "signup" && (
        <div className="cv-note font-mono text-[11px] mt-4 px-4 py-3">
          New accounts are created with placeholder name/initials — an admin should confirm and edit each teammate's
          details, and grant admin rights, from Supabase's Table Editor (team_members table) after they sign up.
        </div>
      )}
    </div>
  );
}
