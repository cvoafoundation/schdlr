import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
const AuthContext = createContext(null);
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [teamProfile, setTeamProfile] = useState(null);
  const [memberships, setMemberships] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const currentUser = useRef(null);
  const refreshProfile = useCallback(async (preferredId) => {
    const revision = ++generation.current;
    const { data: { session } } = await supabase.auth.getSession();
    const account = session?.user || null;
    if (!account) {
      if (revision === generation.current) { currentUser.current = null; setUser(null); setTeamProfile(null); setMemberships([]); setSelectedId(null); setLoading(false); }
      return;
    }
    const [p,m] = await Promise.all([
      supabase.from('team_members').select('*').eq('id',account.id).maybeSingle(),
      supabase.from('organization_members').select('*,organizations(id,name,slug,managed_by,timezone)').eq('user_id',account.id).eq('status','active').order('display_name'),
    ]);
    if (revision !== generation.current) return;
    const active = (m.data || []).filter(row => row.membership_source !== 'cvoa' || new Date(row.cvoa_access_until) > new Date());
    currentUser.current = account.id;
    setUser(account); setTeamProfile(p.data); setMemberships(active);
    setSelectedId(old => active.find(x => x.organization_id === (preferredId || old))?.organization_id || active[0]?.organization_id || null);
    setLoading(false);
  }, []);
  useEffect(() => {
    void refreshProfile();
    // Defer Supabase calls outside its synchronous auth notification lock.
    const { data } = supabase.auth.onAuthStateChange((_event, session) => { if ((session?.user?.id || null) !== currentUser.current) setLoading(true); queueMicrotask(() => { void refreshProfile(); }); });
    return () => { generation.current++; data.subscription.unsubscribe(); };
  }, [refreshProfile]);
  const membership = memberships.find(row => row.organization_id === selectedId) || null;
  const profile = teamProfile && { ...teamProfile, name: membership?.display_name || teamProfile.name, is_admin: !!membership && ['owner','admin'].includes(membership.role) };
  const signOut = async () => { generation.current++; currentUser.current = null; setUser(null); setTeamProfile(null); setMemberships([]); setSelectedId(null); await supabase.auth.signOut({ scope: 'local' }); };
  return <AuthContext.Provider value={{ user,profile,membership,memberships,organization:membership?.organizations,orgId:membership?.organization_id || null,loading,refreshProfile,selectOrganization:setSelectedId,signOut,
    signIn:(email,password)=>supabase.auth.signInWithPassword({email,password}),
    signUp:(email,password,name)=>supabase.auth.signUp({email,password,options:{data:{name}}}),
  }}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('AuthProvider is required');
  return context;
}
