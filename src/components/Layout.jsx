import { useEffect, useState } from "react";
import { NavLink, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { supabase } from "../lib/supabaseClient";
import { Avatar } from "./ui.jsx";

export default function Layout({ children }) {
  const { user, profile, signOut, orgId, organization, memberships, selectOrganization } = useAuth();
  const navigate = useNavigate();
  const { slug } = useParams();
  const [org, setOrg] = useState({ org_name: "Schedlr", logo_url: null });

  useEffect(() => {
    let active = true;
    setOrg({ org_name: organization?.name || "Schedlr", logo_url: null });
    const load = async () => {
      const resolved = slug ? (await supabase.rpc("get_org_id_by_slug", { p_slug: slug })).data : orgId;
      if (!resolved) return;
      const { data } = await supabase.from("org_settings").select("org_name,logo_url").eq("organization_id",resolved).maybeSingle();
      if (active && data) setOrg(data);
    };
    void load();
    return () => { active = false; };
  }, [orgId, slug, organization?.name]);
  const bookingUrl = `/book/${organization?.slug || slug || 'cvoa'}`;

  const tabClass = ({ isActive }) =>
    `cv-tab font-mono text-xs tracking-widest uppercase px-4 py-2 ${isActive ? "cv-tab-active" : ""}`;

  return (
    <div className="cv-root min-h-screen w-full">
      <div className="max-w-5xl mx-auto px-5 sm:px-8 py-10">
        <div className="cv-header flex items-start justify-between pb-5 mb-8 flex-wrap gap-4">
          <div className="flex items-center gap-3">
            {org.logo_url && <img src={org.logo_url} alt="" className="w-9 h-9 object-contain" />}
            <div>
              <div className="cv-graphite font-mono text-[11px] tracking-[0.3em] mb-1">{(org.org_name || "SCHEDLR").toUpperCase()}</div>
              <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight leading-none">{org.org_name || "Schedlr"}</h1>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between flex-wrap gap-3 mb-10">
          <div className="flex gap-2 flex-wrap">
            <NavLink to={bookingUrl} end className={tabClass}>Public booking page</NavLink>
            <NavLink to="/manage" className={tabClass}>Manage booking</NavLink>
            {user && (
              <>
                <span className="cv-divider w-px self-stretch mx-1" />
                <NavLink to="/dashboard" className={tabClass}>Home</NavLink>
                <NavLink to="/team" className={tabClass}>Team availability</NavLink>
                {profile?.is_admin && (
                  <>
                    <NavLink to="/analytics" className={tabClass}>Analytics</NavLink>
                    <NavLink to="/settings" className={tabClass}>Settings</NavLink>
                  </>
                )}
              </>
            )}
          </div>
          <div>
            {user ? (
              <button
                onClick={async () => { await signOut(); navigate("/"); }}
                className="cv-btn-outline px-4 py-2 font-mono text-xs tracking-widest uppercase flex items-center gap-2"
              >
                {profile && <Avatar member={profile} size={18} />}
                Sign out {profile ? `(${profile.initials})` : ""}
              </button>
            ) : (
              <NavLink to="/login" className="cv-tab px-4 py-2 font-mono text-xs tracking-widest uppercase inline-block">
                Staff sign in
              </NavLink>
            )}
          </div>
        </div>

        {user && memberships.length > 1 && <label className="block text-sm mb-6">Scheduling workspace
          <select aria-label="Scheduling workspace" className="cv-input block w-full mt-2 p-3" value={orgId || ''} onChange={e=>selectOrganization(e.target.value)}>
            {memberships.map(m=><option key={m.organization_id} value={m.organization_id}>{m.organizations?.name || m.display_name}</option>)}
          </select>
        </label>}
        {children}

        <div className="mt-16 pt-5 cv-graphite font-mono text-[10px] tracking-widest flex items-center gap-2" style={{ borderTop: "1px solid var(--line)" }}>
          <img src="/schedlr-mark.png" alt="" className="w-4 h-4 object-contain" />
          Powered by Schedlr
        </div>
      </div>
    </div>
  );
}
