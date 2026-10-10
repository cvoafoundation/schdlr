import test from "node:test";
import assert from "node:assert/strict";
import {resolvePublicBookingMode, publicAuthOptions} from "../src/lib/publicBookingMode.js";
function browser(query="", embedded=false) { const values=new Map(); const b={location:{search:query}, sessionStorage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)}};b.parent=embedded?{}:b;return b; }
test("embedded pages cannot restore standalone staff auth",()=>assert.equal(resolvePublicBookingMode(browser("",true)),true));
test("public full-screen mode survives navigation to staff routes",()=>{const b=browser("?cvoa_public=1");assert.equal(resolvePublicBookingMode(b),true);b.location.search="";assert.equal(resolvePublicBookingMode(b),true)});
test("blocked storage fails closed",()=>{const b=browser();b.sessionStorage.getItem=()=>{throw Error()};assert.equal(resolvePublicBookingMode(b),true)});
test("standalone staff login remains separate",()=>assert.equal(resolvePublicBookingMode(browser()),false));
test("public mode neither restores, refreshes, nor imports staff credentials",()=>{assert.equal(publicAuthOptions.persistSession,false);assert.equal(publicAuthOptions.autoRefreshToken,false);assert.equal(publicAuthOptions.detectSessionInUrl,false);assert.equal(publicAuthOptions.storageKey,"schedlr-public-anonymous")});
