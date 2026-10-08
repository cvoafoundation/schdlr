import { createClient } from '@supabase/supabase-js';
const escape = value => String(value || '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export default async function handler(req,res) {
  if (req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  const bearer=req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
  if (!bearer) return res.status(401).json({error:'Sign in required.'});
  try {
    const client=createClient(process.env.VITE_SUPABASE_URL,process.env.VITE_SUPABASE_ANON_KEY,{global:{headers:{Authorization:`Bearer ${bearer}`}},auth:{persistSession:false,autoRefreshToken:false}});
    const {data,error}=await client.auth.getUser(bearer);
    if(error || !data.user) return res.status(401).json({error:'Sign in required.'});
    const link=new URL(req.body?.invite_link);
    if(!['https://schdlr.vercel.app','https://schdlr-m54.vercel.app'].includes(link.origin) || !/^\/accept-invite\/[0-9a-f]{64}$/.test(link.pathname)) return res.status(400).json({error:'Invalid invitation link.'});
    const token=link.pathname.split('/').pop();
    const {createHash}=await import('node:crypto');
    const token_hash=createHash('sha256').update(token).digest('hex');
    // RLS lets an administrator find only invitations for their own company.
    const {data:invite,error:invError}=await client.from('organization_invitations').select('id,organization_id,email,role,status,expires_at').eq('token_hash',token_hash).eq('status','pending').single();
    if(invError || !invite || new Date(invite.expires_at)<new Date()) return res.status(403).json({error:'Invitation is unavailable.'});
    const {data:org}=await client.from('organizations').select('name,managed_by').eq('id',invite.organization_id).single();
    if(!org || org.managed_by==='cvoa') return res.status(403).json({error:'Manage CVOA access in CVOA.ONE.'});
    const apiKey=process.env.RESEND_API_KEY;
    if(!apiKey) return res.status(503).json({error:'Automatic invitation email is not configured. Copy the invitation link.'});
    const resp=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json','Idempotency-Key':`invite-${invite.id}`},body:JSON.stringify({from:process.env.INVITE_FROM_EMAIL || 'onboarding@resend.dev',to:invite.email,subject:`You're invited to join ${org.name}`,html:`<div style="font-family:sans-serif;max-width:480px;margin:auto"><p>You're invited to join <strong>${escape(org.name)}</strong> as ${escape(invite.role)}.</p><p><a href="${escape(link.href)}">Accept invitation</a></p><p>${escape(link.href)}</p></div>`})});
    return res.status(resp.ok?200:502).json(resp.ok?{success:true}:{error:'Could not send the invitation. Copy the link instead.'});
  } catch { return res.status(400).json({error:'Could not process this invitation.'}); }
}
