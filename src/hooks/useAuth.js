import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

/**
 * Tracks the current Supabase Auth session, the matching team_members row,
 * and the user's active organization membership (which org they're acting
 * within — for now everyone has exactly one, until org-switching exists).
 * Returns { user, profile, orgId, membership, loading, signIn, signUp, signOut, refreshProfile }.
 */
export function useAuth() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [membership, setMembership] = useState(null);
  const [loading, setLoading] = useState(true);

  async function loadProfile(userId) {
    if (!userId) { setProfile(null); setMembership(null); return; }
    const [{ data: p }, { data: m }] = await Promise.all([
      supabase.from("team_members").select("*").eq("id", userId).single(),
      supabase.from("organization_members").select("*").eq("user_id", userId).eq("status", "active").limit(1).maybeSingle(),
    ]);
    setProfile(p || null);
    setMembership(m || null);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      loadProfile(data.session?.user?.id).finally(() => setLoading(false));
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      loadProfile(session?.user?.id);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function signIn(email, password) {
    return supabase.auth.signInWithPassword({ email, password });
  }
  async function signUp(email, password, name) {
    return supabase.auth.signUp({ email, password, options: { data: { name } } });
  }
  async function signOut() {
    return supabase.auth.signOut();
  }

  return { user, profile, orgId: membership?.organization_id ?? null, membership, loading, signIn, signUp, signOut, refreshProfile: () => loadProfile(user?.id) };
}
