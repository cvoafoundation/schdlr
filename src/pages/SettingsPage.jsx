import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../hooks/useAuth";
import { Panel, Field, LoadingBlock, ErrorBlock, Avatar } from "../components/ui.jsx";

export default function SettingsPage() {
  const { orgId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState(null);
  const [members, setMembers] = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [invitations, setInvitations] = useState([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("staff");
  const [invitingBusy, setInvitingBusy] = useState(false);
  const [newInviteLink, setNewInviteLink] = useState("");
  const [copiedInvite, setCopiedInvite] = useState(false);
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "https://cvoa.org";

  async function load() {
    if (!orgId) return;
    setLoading(true);
    const [s, m, a, inv] = await Promise.all([
      supabase.from("org_settings").select("*").eq("organization_id", orgId).single(),
      supabase.from("organization_members").select("*").eq("organization_id", orgId).eq("status", "active").order("display_name"),
      supabase.from("audit_log").select("*, team_members(name, initials, avatar_url)").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(20),
      supabase.from("organization_invitations").select("*").eq("organization_id", orgId).order("created_at", { ascending: false }),
    ]);
    setSettings(s.data);
    setMembers(m.data || []);
    setAuditLog(a.data || []);
    setInvitations(inv.data || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, [orgId]);

  async function saveSettings() {
    setError(""); setSaved(false);
    const { error } = await supabase.from("org_settings").update({
      org_name: settings.org_name, buffer_minutes: settings.buffer_minutes, notice_hours: settings.notice_hours,
      daily_cap: settings.daily_cap,
    }).eq("organization_id", orgId);
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
      const { error: updErr } = await supabase.from("org_settings").update({ logo_url: pub.publicUrl }).eq("organization_id", orgId);
      if (updErr) throw updErr;
      setSettings((s) => ({ ...s, logo_url: pub.publicUrl }));
    } catch (err) {
      setError(err.message || "Couldn't upload that logo.");
    } finally {
      setUploadingLogo(false);
    }
  }
  async function removeLogo() {
    await supabase.from("org_settings").update({ logo_url: null }).eq("organization_id", orgId);
    setSettings((s) => ({ ...s, logo_url: null }));
  }

  function copy(link) { if (navigator.clipboard) navigator.clipboard.writeText(link); }

  async function createInvite(e) {
    e.preventDefault();
    setError(""); setInvitingBusy(true); setNewInviteLink("");
    const { data: token, error } = await supabase.rpc("create_invitation", { p_org_id: orgId, p_email: inviteEmail, p_role: inviteRole });
    setInvitingBusy(false);
    if (error) { setError(error.message); return; }
    setNewInviteLink(`${baseUrl}/accept-invite/${token}`);
    setInviteEmail("");
    load();
  }

  async function revokeInvite(id) {
    await supabase.rpc("revoke_invitation", { p_invitation_id: id });
    load();
  }

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
        <div className="grid sm:grid-cols-2 gap-5 mb-3">
          <Field label="Organization name">
            <input value={settings.org_name || ""} onChange={(e) => setSettings({ ...settings, org_name: e.target.value })} className="cv-input w-full py-2" placeholder="Schedlr" />
          </Field>
        </div>
        <button onClick={saveSettings} className="cv-btn-primary px-4 py-2 font-mono text-xs tracking-widest uppercase mb-6">{saved ? "Saved ✓" : "Save name"}</button>
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
        <div className="cv-faint font-mono text-[10px] mt-2">Logo saves immediately when you pick a file — no separate save step needed.</div>
      </Panel>

      <Panel className="cv-card">
        <div className="font-display font-bold text-lg mb-1">Scheduling rules</div>
        <div className="cv-graphite text-sm mb-5">Applies across the whole team's public booking page.</div>
        <div className="grid sm:grid-cols-3 gap-5">
          <Field label="Buffer between meetings (min)"><input type="number" min={0} step={5} value={settings.buffer_minutes} onChange={(e) => setSettings({ ...settings, buffer_minutes: Number(e.target.value) })} className="cv-input w-full py-2" /></Field>
          <Field label="Minimum notice (hours)"><input type="number" min={0} step={1} value={settings.notice_hours} onChange={(e) => setSettings({ ...settings, notice_hours: Number(e.target.value) })} className="cv-input w-full py-2" /></Field>
          <Field label="Max meetings per day"><input type="number" min={1} step={1} value={settings.daily_cap} onChange={(e) => setSettings({ ...settings, daily_cap: Number(e.target.value) })} className="cv-input w-full py-2" /></Field>
        </div>
        <button onClick={saveSettings} className="cv-btn-primary px-5 py-2.5 font-mono text-xs tracking-widest uppercase mt-6">{saved ? "Saved ✓" : "Save changes"}</button>
      </Panel>

      <Panel className="cv-card">
        <div className="font-display font-bold text-lg mb-1">Team</div>
        <div className="cv-graphite text-sm mb-5">
          Invite teammates by email — they'll create their own login and land directly in this organization, never
          able to accidentally join a different one. Since there's no email sending wired up yet, copy the link and
          send it yourself however you'd like.
        </div>

        <form onSubmit={createInvite} className="flex flex-wrap items-end gap-3 mb-5">
          <div className="flex-1 min-w-[200px]">
            <Field label="Email"><input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} className="cv-input w-full py-2" placeholder="teammate@example.com" required /></Field>
          </div>
          <Field label="Role">
            <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} className="cv-input py-2">
              <option value="staff">Staff</option>
              <option value="admin">Admin</option>
            </select>
          </Field>
          <button disabled={invitingBusy} type="submit" className="cv-btn-primary px-4 py-2.5 font-mono text-xs tracking-widest uppercase">
            {invitingBusy ? "Creating…" : "Create invite"}
          </button>
        </form>

        {newInviteLink && (
          <div className="cv-note font-mono text-[11px] mb-5 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
            <span className="break-all">{newInviteLink}</span>
            <button onClick={() => { copy(newInviteLink); setCopiedInvite(true); setTimeout(() => setCopiedInvite(false), 1500); }} className="cv-btn-outline px-3 py-1.5 uppercase tracking-widest shrink-0">
              {copiedInvite ? "Copied ✓" : "Copy link"}
            </button>
          </div>
        )}

        <div className="cv-graphite font-mono text-[10px] tracking-widest uppercase mb-2">Current team</div>
        <div className="space-y-2 mb-6">
          {members.map((m) => (
            <div key={m.id} className="cv-row flex items-center justify-between px-4 py-2.5">
              <div className="flex items-center gap-3">
                <Avatar member={{ initials: m.initials, avatar_url: m.avatar_url }} size={24} />
                <span className="text-sm font-semibold">{m.display_name}</span>
              </div>
              <span className="font-mono text-[10px] tracking-widest uppercase cv-graphite">{m.role}</span>
            </div>
          ))}
        </div>

        {invitations.filter((i) => i.status === "pending").length > 0 && (
          <>
            <div className="cv-graphite font-mono text-[10px] tracking-widest uppercase mb-2">Pending invitations</div>
            <div className="space-y-2">
              {invitations.filter((i) => i.status === "pending").map((i) => (
                <div key={i.id} className="cv-row flex items-center justify-between px-4 py-2.5">
                  <div><span className="text-sm font-semibold">{i.email}</span> <span className="cv-graphite text-xs font-mono">— {i.role}</span></div>
                  <button onClick={() => revokeInvite(i.id)} className="cv-x-btn font-mono text-[10px] tracking-widest uppercase">Revoke</button>
                </div>
              ))}
            </div>
          </>
        )}
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
              <div><div className="text-sm font-semibold">{m.display_name}</div><div className="font-mono text-xs cv-graphite">{baseUrl}/?with={m.booking_slug}</div></div>
              <button onClick={() => copy(`${baseUrl}/?with=${m.booking_slug}`)} className="cv-btn-outline px-3 py-1.5 font-mono text-[10px] tracking-widest uppercase">Copy</button>
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
