import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { Panel, Field, LoadingBlock, ErrorBlock, Avatar } from "../components/ui.jsx";

const ACCENTS = [
  { name: "Signal Red", value: "#B3261E" }, { name: "Field Blue", value: "#1E4FB3" },
  { name: "Olive", value: "#5B6B3A" }, { name: "Amber", value: "#B37B1E" }, { name: "Violet", value: "#6B3AB3" },
];

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState(null);
  const [members, setMembers] = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "https://cvoa.org";

  async function load() {
    setLoading(true);
    const [s, m, a] = await Promise.all([
      supabase.from("org_settings").select("*").single(),
      supabase.from("team_members").select("*").order("name"),
      supabase.from("audit_log").select("*, team_members(name, initials, avatar_url)").order("created_at", { ascending: false }).limit(20),
    ]);
    setSettings(s.data);
    setMembers(m.data || []);
    setAuditLog(a.data || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function saveSettings() {
    setError(""); setSaved(false);
    const { error } = await supabase.from("org_settings").update({
      org_name: settings.org_name, buffer_minutes: settings.buffer_minutes, notice_hours: settings.notice_hours,
      daily_cap: settings.daily_cap, accent_color: settings.accent_color,
    }).eq("id", 1);
    if (error) { setError(error.message); return; }
    setSaved(true); setTimeout(() => setSaved(false), 1500);
  }

  async function uploadLogo(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingLogo(true); setError("");
    try {
      const ext = file.name.split(".").pop();
      const path = `logo-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("branding").upload(path, file, { cacheControl: "3600", upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("branding").getPublicUrl(path);
      const { error: updErr } = await supabase.from("org_settings").update({ logo_url: pub.publicUrl }).eq("id", 1);
      if (updErr) throw updErr;
      setSettings((s) => ({ ...s, logo_url: pub.publicUrl }));
    } catch (err) {
      setError(err.message || "Couldn't upload that logo.");
    } finally {
      setUploadingLogo(false);
    }
  }
  async function removeLogo() {
    await supabase.from("org_settings").update({ logo_url: null }).eq("id", 1);
    setSettings((s) => ({ ...s, logo_url: null }));
  }

  function copy(link) { if (navigator.clipboard) navigator.clipboard.writeText(link); }

  if (loading || !settings) return <LoadingBlock label="Loading settings…" />;

  return (
    <div className="space-y-8">
      {error && <ErrorBlock message={error} />}
      <Panel className="cv-card">
        <div className="font-display font-bold text-lg mb-1">Branding</div>
        <div className="cv-graphite text-sm mb-5">
          The name and logo shown throughout the app — this is the whole toolkit for reskinning a deployment for a
          different organization.
        </div>
        <div className="grid sm:grid-cols-2 gap-5 mb-6">
          <Field label="Organization name">
            <input value={settings.org_name || ""} onChange={(e) => setSettings({ ...settings, org_name: e.target.value })} className="cv-input w-full py-2" placeholder="Schedlr" />
          </Field>
        </div>
        <div className="flex items-center gap-5 flex-wrap mb-2">
          <div className="cv-logo-box w-16 h-16 flex items-center justify-center shrink-0">
            {settings.logo_url ? <img src={settings.logo_url} alt="Logo" className="max-w-full max-h-full" /> : <span className="cv-faint text-[10px] font-mono">NO LOGO</span>}
          </div>
          <label className="cv-btn-outline px-4 py-2 font-mono text-xs tracking-widest uppercase cursor-pointer flex items-center gap-2">
            {uploadingLogo ? "Uploading…" : "Upload logo"}
            <input type="file" accept="image/*" className="hidden" disabled={uploadingLogo} onChange={uploadLogo} />
          </label>
          {settings.logo_url && <button onClick={removeLogo} className="cv-link font-mono text-xs tracking-widest uppercase">Remove</button>}
        </div>
      </Panel>

      <Panel className="cv-card">
        <div className="font-display font-bold text-lg mb-1">Scheduling rules</div>
        <div className="cv-graphite text-sm mb-5">Applies across the whole team's public booking page.</div>
        <div className="grid sm:grid-cols-3 gap-5">
          <Field label="Buffer between meetings (min)"><input type="number" min={0} step={5} value={settings.buffer_minutes} onChange={(e) => setSettings({ ...settings, buffer_minutes: Number(e.target.value) })} className="cv-input w-full py-2" /></Field>
          <Field label="Minimum notice (hours)"><input type="number" min={0} step={1} value={settings.notice_hours} onChange={(e) => setSettings({ ...settings, notice_hours: Number(e.target.value) })} className="cv-input w-full py-2" /></Field>
          <Field label="Max meetings per day"><input type="number" min={1} step={1} value={settings.daily_cap} onChange={(e) => setSettings({ ...settings, daily_cap: Number(e.target.value) })} className="cv-input w-full py-2" /></Field>
        </div>
        <div className="cv-graphite font-mono text-[10px] tracking-widest uppercase mt-6 mb-2">Accent color</div>
        <div className="flex flex-wrap gap-2 mb-6">
          {ACCENTS.map((a) => (
            <button key={a.value} onClick={() => setSettings({ ...settings, accent_color: a.value })} className={`cv-swatch flex items-center gap-2 px-3 py-2 ${settings.accent_color === a.value ? "cv-swatch-active" : ""}`}>
              <span className="w-3 h-3 rounded-full" style={{ background: a.value }} /><span className="text-xs font-mono">{a.name}</span>
            </button>
          ))}
        </div>
        <button onClick={saveSettings} className="cv-btn-primary px-5 py-2.5 font-mono text-xs tracking-widest uppercase">{saved ? "Saved ✓" : "Save changes"}</button>
      </Panel>

      <Panel className="cv-card">
        <div className="font-display font-bold text-lg mb-1">Personal booking links</div>
        <div className="cv-graphite text-sm mb-5">Share a teammate's link directly, or use the general page for team-routed booking.</div>
        <div className="space-y-2">
          <div className="cv-row flex items-center justify-between px-4 py-3">
            <div><div className="text-sm font-semibold">General booking page</div><div className="font-mono text-xs cv-graphite">{baseUrl}/</div></div>
            <button onClick={() => copy(`${baseUrl}/`)} className="cv-btn-outline px-3 py-1.5 font-mono text-[10px] tracking-widest uppercase">Copy</button>
          </div>
          {members.map((m) => (
            <div key={m.id} className="cv-row flex items-center justify-between px-4 py-3">
              <div><div className="text-sm font-semibold">{m.name}</div><div className="font-mono text-xs cv-graphite">{baseUrl}/?with={m.slug}</div></div>
              <button onClick={() => copy(`${baseUrl}/?with=${m.slug}`)} className="cv-btn-outline px-3 py-1.5 font-mono text-[10px] tracking-widest uppercase">Copy</button>
            </div>
          ))}
        </div>
        <div className="cv-note font-mono text-[11px] mt-4 px-4 py-3">
          Note: the ?with= parameter is a placeholder — wiring it up to auto-select that teammate on the booking
          page is a quick follow-up (read the query string in BookingPage.jsx and preset `member`).
        </div>
      </Panel>

      <Panel className="cv-card">
        <div className="font-display font-bold text-lg mb-1">🕐 Audit log</div>
        <div className="cv-graphite text-sm mb-5">Who changed availability, and when.</div>
        {auditLog.length === 0 ? <div className="cv-faint text-sm italic">No changes recorded yet.</div> : (
          <div className="space-y-2">
            {auditLog.map((a) => (
              <div key={a.id} className="cv-row flex items-center justify-between px-4 py-2.5">
                <div className="flex items-center gap-3">
                  <Avatar member={a.team_members} size={24} />
                  <span className="text-sm">{a.team_members?.name || "Someone"} {a.action}</span>
                </div>
                <span className="font-mono text-xs cv-faint">{new Date(a.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
