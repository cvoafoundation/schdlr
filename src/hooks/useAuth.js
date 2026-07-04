import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

/**
 * Tracks the current Supabase Auth session and the matching team_members row.
 * Returns { user, profile, loading, signIn, signUp, signOut, refreshProfile }.
 */
export function useAuth() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  async function loadProfile(userId) {
    if (!userId) { setProfile(null); return; }
    const { data } = await supabase.from("team_members").select("*").eq("id", userId).single();
    setProfile(data || null);
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

  return { user, profile, loading, signIn, signUp, signOut, refreshProfile: () => loadProfile(user?.id) };
}
