import { useEffect, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { supabase } from "../lib/supabaseClient";
import { Avatar } from "./ui.jsx";

export default function Layout({ children }) {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [org, setOrg] = useState({ org_name: "Schedlr", logo_url: null });

  useEffect(() => {
    supabase.from("org_settings").select("org_name, logo_url").eq("id", 1).single().then(({ data }) => {
      if (data) {
        setOrg(data);
        document.title = data.org_name || "Schedlr";
      }
    });
  }, []);

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
            <NavLink to="/" end className={tabClass}>Public booking page</NavLink>
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

        {children}

        <div className="mt-16 pt-5 cv-graphite font-mono text-[10px] tracking-widest flex items-center gap-2" style={{ borderTop: "1px solid var(--line)" }}>
          {(org.org_name || "SCHEDLR").toUpperCase()}
        </div>
      </div>
    </div>
  );
}
