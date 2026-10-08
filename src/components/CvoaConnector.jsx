import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabaseClient';
import { cvoaOrigins, embedded, trustedParent } from '../lib/connector';
export default function CvoaConnector() {
  const { refreshProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const busy = useRef(false);
  const initial = useRef(true);
  const lastConnected = useRef(0);
  const actions = useRef({ refreshProfile,signOut,navigate });
  actions.current = { refreshProfile,signOut,navigate };
  useEffect(() => {
    if (!embedded) return;
    let active = true;
    const receive = async event => {
      if (!trustedParent(event) || busy.current) return;
      busy.current = true;
      try {
        const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/connect-cvoa`, { method:'POST',headers:{Authorization:`Bearer ${event.data.accessToken}`,'Content-Type':'application/json'},body:'{}',cache:'no-store' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not connect.');
        const { error: otpError } = await supabase.auth.verifyOtp({ token_hash:result.token_hash,type:'magiclink' });
        if (otpError) throw otpError;
        await actions.current.refreshProfile(initial.current ? result.organization_id : undefined);
        if (!active) return;
        lastConnected.current = Date.now(); setError('');
        if (initial.current) { initial.current=false; actions.current.navigate('/dashboard',{replace:true}); }
        event.source.postMessage({type:'schedlr:connected'},event.origin);
      } catch (failure) {
        await actions.current.signOut();
        if (active) {
          setError(failure.message || 'Your scheduling access could not be verified.');
          actions.current.navigate('/integrations/cvoa',{replace:true});
          event.source.postMessage({type:'schedlr:error'},event.origin);
        }
      } finally { busy.current=false; }
    };
    window.addEventListener('message',receive);
    for (const origin of cvoaOrigins) window.parent.postMessage({type:'schedlr:ready'},origin);
    // Hide cached records if the parent stops renewing the appointment lease.
    const lease = window.setInterval(() => {
      if (lastConnected.current && Date.now()-lastConnected.current>290000) {
        lastConnected.current=0;
        void actions.current.signOut();
        setError('Reconnect through CVOA.ONE to verify your current appointment.');
        actions.current.navigate('/integrations/cvoa',{replace:true});
      }
    },15000);
    return () => { active=false; window.removeEventListener('message',receive); window.clearInterval(lease); };
  }, []);
  return error ? <div role="alert" className="p-4 text-red-800">{error}</div> : null;
}
