import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
const id = n => `10000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const root=id(1),staff=id(2),other=id(3),external=id(101);
let company,post,rootOrg;
before(async()=>{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role',true) $$;
 create schema storage;create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant all on storage.objects to anon,authenticated,service_role;
 grant usage on schema storage,auth,public to anon,authenticated,service_role;`);
 await db.exec(fs.readFileSync('supabase/schema.sql','utf8'));
 await db.exec(`insert into auth.users(id,email,raw_user_meta_data) values('${root}','owner@example.test','{"name":"Owner"}'),('${staff}','staff@example.test','{"name":"Staff"}'),('${other}','other@example.test','{"name":"Other"}');update team_members set is_admin=true where id='${root}';`);
 for(const file of ['stage1_multitenant_foundation.sql','stage2a_rls_rewrite.sql','stage2b_fix_and_org_stamping.sql','stage2c_lock_not_null.sql','stage3a_org_signup.sql','stage3b_critical_org_scoping_fix.sql','stage3c_public_roster_fix.sql','20261008193800_cvoa_connector_and_customer_isolation.sql']) await db.exec(fs.readFileSync(`supabase/migrations/${file}`,'utf8'));
 await db.exec('grant all on all tables in schema public to anon,authenticated,service_role; grant usage on all sequences in schema public to anon,authenticated,service_role;');
 rootOrg=(await db.query("select id from organizations where slug='cvoa'")).rows[0].id;
 company=id(201);
 await db.exec(`insert into organizations(id,name,slug) values('${company}','Other company','other-company');insert into org_settings(organization_id,org_name) values('${company}','Other company'); insert into organization_members(organization_id,user_id,role,display_name) values('${company}','${other}','owner','Other'); insert into event_types(id,organization_id,code,title,duration_minutes) values('other-e30','${company}','01','Other meeting',30);`);
 await db.query('select cvoa_connector_identity($1,$2)',[external,staff]);
 const result=await db.query('select cvoa_connector_sync($1,$2,$3::jsonb) result',[external,'Staff',JSON.stringify([{key:'national',label:'National',role:'admin',bookable:true},{key:`post:${id(301)}`,label:'Post A',role:'admin',bookable:true}])]);
 post=result.rows[0].result.find(w=>w.key.startsWith('post:')).organization_id;
});
after(()=>db.close());
async function as(user,fn,role='authenticated'){
 await db.exec('begin');
 try{await db.exec(`set local role ${role};select set_config('request.jwt.claim.sub','${user||''}',true),set_config('request.jwt.claim.role','${role}',true)`);await fn();}finally{await db.exec('rollback');}
}
test('National integration memberships do not expose a different company',async()=>as(staff,async()=>{
 assert.equal((await db.query('select id from organizations where id=$1',[company])).rows.length,0);
 assert.equal((await db.query('select id from event_types where organization_id=$1',[company])).rows.length,1); // public booking catalog, no private data
 assert.equal((await db.query('select * from organization_members where organization_id=$1',[company])).rows.length,0);
 assert.equal((await db.query('update event_types set title=$1 where organization_id=$2 returning id',['Forged',company])).rows.length,0);
 assert.equal((await db.query('update org_settings set org_name=$1 where organization_id=$2 returning id',['Forged',company])).rows.length,0);
}));
test('client cannot forge a connector identity or derived appointment',async()=>{
 await as(staff,async()=>assert.rejects(db.query('select cvoa_connector_identity($1,$2)',[external,other]),/permission denied/));
 await as(staff,async()=>assert.rejects(db.query("update organization_members set role='owner' where organization_id=$1 and user_id=$2",[post,staff]),/Manage CVOA/));
});
test('lease expiry removes database permission even with an existing session',async()=>{
 await db.exec('begin');try{
 await db.query("update organization_members set cvoa_access_until=now()-interval '1 minute' where user_id=$1 and organization_id=$2",[staff,post]);
 await db.exec(`set local role authenticated;select set_config('request.jwt.claim.sub','${staff}',true)`);
 assert.equal((await db.query('select is_org_member($1) allowed',[post])).rows[0].allowed,false);
 assert.equal((await db.query('select id from organizations where id=$1',[post])).rows.length,0);
 }finally{await db.exec('rollback');}
});
test('sync revokes absent workspaces and does not change other customers',async()=>{
 await db.exec('begin');try{
 await db.query('select cvoa_connector_sync($1,$2,$3::jsonb)',[external,'Renamed','[]']);
 assert.equal((await db.query("select count(*) n from organization_members where user_id=$1 and status='active'",[staff])).rows[0].n, 0);
 assert.equal((await db.query("select count(*) n from organization_members where organization_id=$1 and status='active'",[company])).rows[0].n, 1);
 }finally{await db.exec('rollback');}
});
test('same staff can configure availability independently in two calendars',async()=>as(staff,async()=>{
 await db.query('insert into blocked_dates(organization_id,member_id,blocked_date) values($1,$2,current_date),($3,$2,current_date)',[rootOrg,staff,post]);
 assert.equal((await db.query('select * from blocked_dates where member_id=$1',[staff])).rows.length,2);
}));
test('public availability omits confidential time-off labels',async()=>{
 await db.exec('begin');try{
 await db.query('insert into vacations(organization_id,member_id,start_date,end_date,label) values($1,$2,current_date,current_date,$3)',[post,staff,'Medical details']);
 await db.exec('set local role anon');
 const result=(await db.query('select public_availability($1) result',[post])).rows[0].result;
 assert.equal(result.vacations.length,1);assert.equal(JSON.stringify(result).includes('Medical details'),false);
 assert.equal((await db.query('select * from vacations')).rows.length,0);
 }finally{await db.exec('rollback');}
});
async function book({org=post,event=`${post}-e30`,member=staff,dates=['2099-01-01'],start=600,email='guest@example.test'}={}) {
 return (await db.query('select create_public_booking($1,$2,$3,$4::jsonb,$5,$6,$7) result',[org,event,member,JSON.stringify(dates),start,'Guest',email])).rows[0].result;
}
async function futureWeekday(days=5){return (await db.query("select (current_date+$1::int+case extract(dow from current_date+$1::int) when 0 then 1 when 6 then 2 else 0 end)::text as booked_day",[days])).rows[0].booked_day;}
test('public booking creates a private token and rejects duplicate/cross-company slots',async()=>{
 const day=await futureWeekday();
 await as(null,async()=>{
  const receipt=await book({dates:[day]});
  assert.match(receipt.management_token,/^[0-9a-f]{64}$/);
  assert.equal(receipt.bookings.length,1);
  assert.equal((await db.query('select * from bookings')).rows.length,0);
  assert.equal((await db.query('select manage_public_booking($1) result',[receipt.management_token])).rows[0].result.length,1);
  await assert.rejects(book({dates:[day],email:'another@example.test'}),/no longer available/);
 },'anon');
 await as(null,async()=>assert.rejects(book({org:company,event:'other-e30',member:staff,dates:[day]}),/not bookable/),'anon');
});
test('six repeat appointments save atomically and a shared token manages only that series',async()=>{
 const dates=await Promise.all([10,17,24,31,38,45].map(futureWeekday));
 await as(null,async()=>{
  const receipt=await book({dates,email:'series@example.test'});
  assert.equal(receipt.bookings.length,6);
  const rows=(await db.query('select manage_public_booking($1) result',[receipt.management_token])).rows[0].result;
  assert.equal(rows.length,6);
  const after=(await db.query("select manage_public_booking($1,'cancel',$2) result",[receipt.management_token,receipt.bookings[0].id])).rows[0].result;
  assert.equal(after.length,5);
 },'anon');
});
test('group capacity is enforced and cancelling attendance does not cancel the group',async()=>{
 await db.query('insert into event_types(id,organization_id,code,title,duration_minutes,is_group,capacity,fixed_minutes) values($1,$2,$3,$4,60,true,1,600)',['test-group',post,'05','Group']);
 const day=await futureWeekday(14);
 await as(null,async()=>{
  const receipt=await book({event:'test-group',member:null,dates:[day]});
  const booking=receipt.bookings[0].id;
  const rows=(await db.query('select manage_public_booking($1) result',[receipt.management_token])).rows[0].result;
  assert.equal(rows[0].is_group,true);
  await assert.rejects(db.query("select manage_public_booking($1,'cancel',$2)",['f'.repeat(64),booking]),/invalid or expired/);
 },'anon');
 // PostgreSQL aborts a transaction after a rejected statement; test capacity separately.
 await db.exec('begin');try{
 const receipt=await book({event:'test-group',member:null,dates:[day]});
 await assert.rejects(book({event:'test-group',member:null,dates:[day],email:'second@example.test'}),/full/);
 }finally{await db.exec('rollback');}
 await as(null,async()=>{
  const receipt=await book({event:'test-group',member:null,dates:[day]});
  assert.equal((await db.query("select manage_public_booking($1,'cancel',$2) result",[receipt.management_token,receipt.bookings[0].id])).rows[0].result.length,0);
  assert.equal((await db.query('select * from public_booking_slots($1,$2,$2)',[post,day])).rows[0].status,'upcoming');
 },'anon');
});
test('guest email knowledge does not reveal historical bookings',async()=>as(null,async()=>{
 assert.equal((await db.query("select * from get_bookings_by_email('guest@example.test')")).rows.length,0);
},'anon'));
test('branding cannot be uploaded to another company folder',async()=>{
 await as(staff,async()=>assert.rejects(db.query('insert into storage.objects(bucket_id,name) values($1,$2)',['branding',`${company}/logo.png`]),/row-level security/));
 await as(staff,async()=>{await db.query('insert into storage.objects(bucket_id,name) values($1,$2)',['branding',`${post}/logo.png`]);});
});
