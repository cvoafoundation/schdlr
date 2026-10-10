import { useEffect, useRef, useState } from 'react';
const trustedOrigins=new Set(['https://cvoa.one','https://www.cvoa.one']);
const endpoint='https://mvlhtuoukhorxmmibruc.supabase.co/functions/v1/member-scheduling';
const empty={title:'',date:'',time:'',duration:'30',location:'',description:'',attendees:''};
export default function CvoaMeetings() {
 const credentials=useRef(null),generation=useRef(0),lastRenewed=useRef(0);
 const [identity,setIdentity]=useState(null),[meetings,setMeetings]=useState([]),[deliveries,setDeliveries]=useState([]),[form,setForm]=useState(empty),[editing,setEditing]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const clear=()=>{generation.current++;credentials.current=null;setIdentity(null);setMeetings([]);setDeliveries([]);setForm(empty);setEditing(null);setNotice('');};
 async function request(body) {
  const auth=credentials.current,revision=generation.current;
  if(!auth) throw new Error('Open Schedlr through CVOA.ONE to sign in.');
  const response=await fetch(endpoint,{method:'POST',headers:{Authorization:`Bearer ${auth.token}`,'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'});
  const data=await response.json();
  if(revision!==generation.current) throw new Error('Account changed.');
  if(!response.ok) {if(response.status===401 || response.status===403) clear();throw new Error(data.error || 'Scheduling unavailable');}
  return data;
 }
 async function load() {const result=await request({action:'list'});setMeetings(result.meetings);setDeliveries(result.deliveries);}
 useEffect(()=>{
  let active=true;
  const receive=async event=>{
   if(event.source!==window.parent || !trustedOrigins.has(event.origin) || event.data?.type!=='cvoa:scheduling-session') return;
   if(typeof event.data.token!=='string' || typeof event.data.userId!=='string') {clear();return;}
   const changed=credentials.current?.id!==event.data.userId;
   if(changed) clear();
   credentials.current={token:event.data.token,id:event.data.userId};lastRenewed.current=Date.now();
   try { await load();if(active) {setIdentity({email:event.data.email});setError('');} }
   catch(failure) {if(active)setError(failure.message);}
  };
  window.addEventListener('message',receive);
  for(const origin of trustedOrigins) window.parent.postMessage({type:'schedlr:session-ready'},origin);
  const timer=setInterval(()=>{if(credentials.current && Date.now()-lastRenewed.current>90000){clear();setError('Your CVOA session needs to reconnect. Reload this page from CVOA.ONE.');}},10000);
  return()=>{active=false;generation.current++;credentials.current=null;window.removeEventListener('message',receive);clearInterval(timer);};
 },[]);
 async function act(action,meeting=null) {
  setBusy(true);setError('');setNotice('');
  try {
   let body={action,id:meeting?.id,version:meeting?.version};
   if(action==='create' || action==='update') {
    const start=new Date(`${form.date}T${form.time}`);
    if(!Number.isFinite(start.getTime())) throw new Error('Choose a meeting date and time.');
    body={...body,title:form.title,starts_at:start.toISOString(),ends_at:new Date(start.getTime()+Number(form.duration)*60000).toISOString(),location:form.location,description:form.description,attendee_emails:form.attendees.split(/[,;\n]/).map(e=>e.trim()).filter(Boolean)};
   }
   await request(body);await load();setForm(empty);setEditing(null);setNotice('Saved. Email notifications are queued for delivery.');
  } catch(failure) {setError(failure.message);} finally {setBusy(false);}
 }
 function edit(meeting) {
  const start=new Date(meeting.starts_at);const pad=n=>String(n).padStart(2,'0');
  setEditing(meeting);setForm({title:meeting.title,date:`${start.getFullYear()}-${pad(start.getMonth()+1)}-${pad(start.getDate())}`,time:`${pad(start.getHours())}:${pad(start.getMinutes())}`,duration:String((new Date(meeting.ends_at)-start)/60000),location:meeting.location,description:meeting.description,attendees:meeting.attendee_emails.join(', ')});
 }
 const input=(name,label,type='text')=><label className="block font-mono text-sm">{label}<input required={['title','date','time','duration'].includes(name)} type={type} value={form[name]} onChange={e=>setForm({...form,[name]:e.target.value})} className="block w-full border border-black/20 p-3 mt-1" min={name==='duration'?5:undefined} max={name==='duration'?720:undefined}/></label>;
 return <main className="max-w-5xl mx-auto p-5 md:p-10 space-y-6 bg-white text-black">
  <div><p className="font-mono text-xs uppercase tracking-widest">CVOA.ONE / Schedlr</p><h1 className="font-display text-3xl font-bold mt-2">My meetings</h1><p className="font-mono text-sm mt-3">{identity?`Signed in as ${identity.email}. These are your personal appointments.`:'Connecting to your CVOA account…'}</p></div>
  {error && <p role="alert" className="border border-red-600 text-red-800 p-4">{error}</p>}
  {notice && <p role="status" className="border border-green-700 p-4">{notice}</p>}
  {!identity && <p className="font-mono">Open this workspace from the Schedlr tab in CVOA.ONE. Your existing standalone Schedlr staff login is kept separate.</p>}
  {identity && <>
   <form onSubmit={e=>{e.preventDefault();void act(editing?'update':'create',editing);}} className="border border-black/20 p-5 space-y-4">
    <h2 className="font-display text-xl font-bold">{editing?'Edit meeting':'Schedule a meeting'}</h2>
    {input('title','Meeting title')}
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">{input('date','Date','date')}{input('time','Time','time')}{input('duration','Minutes','number')}</div>
    <p className="font-mono text-xs">Times use your device timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}. Emails include Eastern Time and a calendar attachment.</p>
    {input('location','Location or meeting link')}{input('attendees','Attendee email addresses (comma separated, up to 20)')}
    <label className="block font-mono text-sm">Details<textarea value={form.description} onChange={e=>setForm({...form,description:e.target.value})} className="block w-full border border-black/20 p-3 mt-1" rows={3}/></label>
    <p className="font-mono text-xs">Saving sends an invitation to you and each listed attendee. Updates and cancellations send notices. Reminders are scheduled 24 hours and 1 hour beforehand when that time remains.</p>
    <button disabled={busy} className="bg-black text-white px-5 py-3 font-mono">{busy?'Saving…':editing?'Save changes & notify':'Schedule & invite'}</button>
    {editing && <button type="button" onClick={()=>{setEditing(null);setForm(empty);}} className="ml-4 underline">Discard edit</button>}
   </form>
   <div className="flex justify-between"><h2 className="font-display text-xl font-bold">Your appointments</h2><button disabled={busy} onClick={()=>load().catch(f=>setError(f.message))} className="underline">Refresh</button></div>
   {!meetings.length && <p className="font-mono">No meetings yet. Schedule your first meeting above.</p>}
   {meetings.map(m=>{const jobs=deliveries.filter(d=>d.meeting_id===m.id && d.version===m.version);const mail=jobs.some(d=>d.state==='failed')?'Email delivery needs attention':jobs.length && jobs.every(d=>d.state==='sent')?'Emails sent':'Emails queued';return <article key={m.id} className="border border-black/20 p-5 space-y-3">
    <div className="flex justify-between gap-3"><h3 className="font-display text-xl font-bold">{m.title}</h3><span className="font-mono text-sm">{m.status}</span></div>
    <p className="font-mono text-sm">{new Date(m.starts_at).toLocaleString()} · {Math.round((new Date(m.ends_at)-new Date(m.starts_at))/60000)} minutes</p>
    <p className="font-mono text-sm">{m.location}</p><p className="font-mono text-sm whitespace-pre-wrap">{m.description}</p>
    <p className="font-mono text-xs">Attendees: {m.attendee_emails.join(', ') || 'Organizer only'} · {mail}</p>
    {m.status==='scheduled' && <div className="flex gap-5"><button disabled={busy} onClick={()=>edit(m)} className="underline">Edit / reschedule</button><button disabled={busy} onClick={()=>act('complete',m)} className="underline">Mark completed</button><button disabled={busy} onClick={()=>{if(window.confirm('Cancel this meeting and notify its attendees?'))void act('cancel',m);}} className="underline text-red-700">Cancel & notify</button></div>}
   </article>;})}
  </>}
 </main>;
}
