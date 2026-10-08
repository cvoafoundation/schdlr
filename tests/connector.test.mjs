import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createConnector } from '../supabase/functions/connect-cvoa/handler.js';
if(!globalThis.crypto) globalThis.crypto=webcrypto;
const request = (token='cvoa-session',body={})=>new Request('https://scheduler.test/connect-cvoa',{method:'POST',headers:{Origin:'https://schdlr.vercel.app',Authorization:`Bearer ${token}`},body:JSON.stringify(body)});
function fixture({invalid=false,spaces=[{key:'post:verified',label:'Verified post',role:'admin',bookable:true}],mapped='mapped-user',bound='new-user'}={}) {
 const calls=[];
 const handler=createConnector({cvoa:token=>({auth:{getUser:async()=>({data:{user:invalid?null:{id:'verified-id',email:'real@example.test'}},error:invalid?new Error('Invalid'):null})},rpc:async(name)=>{calls.push(['source',name,token]);return {data:{name:'Verified name',selected_key:'post:verified',workspaces:spaces}};}}),service:()=>{calls.push(['service']);return {
 rpc:async(name,args)=>{calls.push([name,args]);return {data:name==='cvoa_connector_identity'?(args.p_user_id?bound:mapped):spaces.map(w=>({key:w.key,organization_id:'verified-organization'}))};},
 auth:{admin:{createUser:async args=>{calls.push(['createUser',args]);return {data:{user:{id:'new-user'}}};},deleteUser:async id=>{calls.push(['deleteUser',id]);return{};},getUserById:async id=>({data:{user:{id,email:'random@accounts.schedlr.invalid'}}}),generateLink:async args=>{calls.push(['generateLink',args]);return {data:{properties:{hashed_token:'one-time-token'}}};}}},
 };}});
 return {handler,calls};
}
test('unverified external sessions cannot reach identity provisioning',async()=>{
 const {handler,calls}=fixture({invalid:true});const response=await handler(request());assert.equal(response.status,401);assert.equal(calls.length,0);
});
test('request body cannot forge an email, role or customer organization',async()=>{
 const {handler,calls}=fixture();const response=await handler(request('valid',{user_id:'attacker',organization_id:'victim',email:'attacker@example.test',workspaces:[{role:'owner'}]}));
 assert.equal(response.status,200);const data=await response.json();assert.equal(data.organization_id,'verified-organization');assert.equal(data.user_id,'mapped-user');
 const sync=calls.find(c=>c[0]==='cvoa_connector_sync')[1];assert.equal(sync.p_external_id,'verified-id');assert.equal(sync.p_workspaces[0].key,'post:verified');assert.equal(sync.p_workspaces[0].role,'admin');
 assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('access-control-allow-origin'),'https://schdlr.vercel.app');
});
test('revoked staff appointments synchronize removal without issuing a login',async()=>{
 const {handler,calls}=fixture({spaces:[]});assert.equal((await handler(request())).status,403);assert.deepEqual(calls.find(c=>c[0]==='cvoa_connector_sync')[1].p_workspaces,[]);assert.equal(calls.some(c=>c[0]==='generateLink'),false);
});
test('new SSO identities use random addresses and never reuse a real company account',async()=>{
 const {handler,calls}=fixture({mapped:null});assert.equal((await handler(request())).status,200);const created=calls.find(c=>c[0]==='createUser')[1];assert.match(created.email,/^integration-[0-9a-f-]+@accounts\.schedlr\.invalid$/);assert.equal(created.email.includes('verified-id'),false);assert(created.password.length>64);assert.equal(created.email_confirm,true);
 assert.equal(calls.find(c=>c[0]==='generateLink')[1].type,'magiclink');
});
test('concurrent identity creation cleans up only the unused new account',async()=>{
 const {handler,calls}=fixture({mapped:null,bound:'already-bound-user'});const response=await handler(request());assert.equal(response.status,200);assert.equal((await response.json()).user_id,'already-bound-user');assert.deepEqual(calls.find(c=>c[0]==='deleteUser'),['deleteUser','new-user']);
});
test('unsupported origins cannot use the browser connector',async()=>{
 const {handler,calls}=fixture();const response=await handler(new Request('https://scheduler.test/connect-cvoa',{method:'POST',headers:{Origin:'https://evil.example',Authorization:'Bearer valid'}}));assert.equal(response.status,403);assert.equal(calls.length,0);assert.equal(response.headers.get('access-control-allow-origin'),null);
});
