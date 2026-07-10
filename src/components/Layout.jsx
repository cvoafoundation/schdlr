import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

export default function Layout({ children }) {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();

  const tabClass = ({ isActive }) =>
    `cv-tab font-mono text-xs tracking-widest uppercase px-4 py-2 ${isActive ? "cv-tab-active" : ""}`;

  return (
    <div className="cv-root min-h-screen w-full">
      <div className="max-w-5xl mx-auto px-5 sm:px-8 py-10">
        <div className="cv-header flex items-start justify-between pb-5 mb-8 flex-wrap gap-4">
          <div>
            <div className="cv-graphite font-mono text-[11px] tracking-[0.3em] mb-2"></div>
            <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight">SCHEDLR</h1>
          </div>
        </div>

        <div className="flex items-center justify-between flex-wrap gap-3 mb-10">
          <div className="flex gap-2 flex-wrap">
            <NavLink to="/" end className={tabClass}>Public booking page</NavLink>
            <NavLink to="/manage" className={tabClass}>Manage booking</NavLink>
            {user && (
              <>
                <span className="cv-divider w-px self-stretch mx-1" />
                <NavLink to="/team" className={tabClass}>Team availability</NavLink>
                <NavLink to="/dashboard" className={tabClass}>Dashboard</NavLink>
                <NavLink to="/settings" className={tabClass}>Settings</NavLink>
              </>
            )}
          </div>
          <div>
            {user ? (
              <button
                onClick={async () => { await signOut(); navigate("/"); }}
                className="cv-btn-outline px-4 py-2 font-mono text-xs tracking-widest uppercase"
              >
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
          SCHEDLR
        </div>
      </div>
    </div>
  );
}
