import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { Panel, Field, ErrorBlock } from "../components/ui.jsx";

export default function LoginPage() {
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState("signin"); // 'signin' | 'signup'
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(""); setBusy(true);
    const { error } = mode === "signin" ? await signIn(email, password) : await signUp(email, password, name);
    setBusy(false);
    if (error) { setError(error.message); return; }
    if (mode === "signup") {
      setError(""); 
      // Supabase may require email confirmation depending on your project's auth settings.
      navigate("/team");
    } else {
      navigate("/team");
    }
  }

  return (
    <div className="max-w-sm mx-auto">
      <Panel className="cv-card">
        <div className="cv-graphite font-mono text-[11px] tracking-widest mb-4 uppercase">
          {mode === "signin" ? "Staff sign in" : "Create staff account"}
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
          <Field label="Password">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="cv-input w-full py-2" required minLength={6} />
          </Field>
          {error && <ErrorBlock message={error} />}
          <button disabled={busy} type="submit" className="cv-btn-primary w-full px-4 py-2.5 font-mono text-xs tracking-widest uppercase">
            {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>
        <button
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          className="cv-link mt-4 w-full text-center font-mono text-xs tracking-widest uppercase"
        >
          {mode === "signin" ? "New team member? Create an account" : "Already have an account? Sign in"}
        </button>
      </Panel>
      <div className="cv-note font-mono text-[11px] mt-4 px-4 py-3">
        New accounts are created with placeholder name/initials — an admin should confirm and edit each teammate's
        details, and grant admin rights, from Supabase's Table Editor (team_members table) after they sign up.
      </div>
    </div>
  );
}
