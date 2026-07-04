import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { Panel, Field, LoadingBlock, ErrorBlock } from "../components/ui.jsx";
import { fmtTime, toDateOnly, toDateInput, getSlotsForMember, buildAvailabilityIndex } from "../lib/scheduling.js";

function fmtDateShort(d) { return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }); }

export default function ManagePage() {
  const [email, setEmail] = useState("");
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [bookings, setBookings] = useState([]);
  const [members, setMembers] = useState([]);
  const [error, setError] = useState("");
  const [reschedulingId, setReschedulingId] = useState(null);
  const [newDate, setNewDate] = useState("");
  const [newSlots, setNewSlots] = useState([]);
  const [newSlot, setNewSlot] = useState(null);
  const [settings, setSettings] = useState(null);

  async function find() {
    setLoading(true); setError(""); setSearched(true);
    const [{ data: rows, error: err }, { data: mem }, { data: s }] = await Promise.all([
      supabase.rpc("get_bookings_by_email", { p_email: email }),
      supabase.from("team_members").select("*"),
      supabase.from("org_settings").select("*").single(),
    ]);
    if (err) setError(err.message);
    setBookings(rows || []);
    setMembers(mem || []);
    setSettings(s);
    setLoading(false);
  }

  async function cancel(id) {
    const { error } = await supabase.rpc("cancel_booking_by_email", { p_booking_id: id, p_email: email });
    if (error) { setError(error.message); return; }
    find();
  }

  async function loadSlotsForReschedule(booking, dateStr) {
    if (!dateStr) { setNewSlots([]); return; }
    const [bd, ro, va, pb] = await Promise.all([
      supabase.from("blocked_dates").select("*"),
      supabase.from("recurring_days_off").select("*"),
      supabase.from("vacations").select("*"),
      supabase.from("partial_blocks").select("*"),
    ]);
    const idx = buildAvailabilityIndex({ blockedDates: bd.data || [], recurringOff: ro.data || [], vacations: va.data || [], partialBlocks: pb.data || [] });
    const from = dateStr, to = dateStr;
    const { data: busy } = await supabase.rpc("public_booking_slots", { p_from: from, p_to: to });
    const date = toDateOnly(dateStr);
    const slots = getSlotsForMember(date, booking.duration_minutes, booking.member_id, settings, busy || [], idx);
    setNewSlots(slots);
  }

  async function confirmReschedule(booking) {
    if (!newSlot) return;
    const { data: ok, error } = await supabase.rpc("reschedule_booking_by_email", {
      p_booking_id: booking.id, p_email: email, p_new_date: newDate, p_new_start_minutes: newSlot.minutes,
    });
    if (error || !ok) { setError(error?.message || "Couldn't reschedule that booking."); return; }
    setReschedulingId(null); setNewDate(""); setNewSlots([]); setNewSlot(null);
    find();
  }

  return (
    <div className="max-w-xl">
      <Panel className="cv-card">
        <div className="cv-graphite font-mono text-[11px] tracking-widest mb-1 uppercase">🔗 Manage your booking</div>
        <div className="cv-graphite text-sm mb-4">Enter the email you booked with to find and manage your meetings.</div>
        <div className="flex gap-2">
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="cv-input flex-1 py-2" />
          <button onClick={find} className="cv-btn-primary px-4 py-2 font-mono text-xs tracking-widest uppercase">Find</button>
        </div>
      </Panel>

      {error && <div className="mt-4"><ErrorBlock message={error} /></div>}
      {loading && <LoadingBlock />}

      {searched && !loading && (
        <div className="mt-6 space-y-2">
          {bookings.length === 0 ? (
            <Panel className="cv-card text-center py-8"><div className="cv-faint italic text-sm">No upcoming meetings found for that email.</div></Panel>
          ) : (
            bookings.map((b) => {
              const m = members.find((mm) => mm.id === b.member_id);
              const isRescheduling = reschedulingId === b.id;
              return (
                <div key={b.id} className="cv-list-row w-full px-5 py-4">
                  <div className="flex items-center gap-4 flex-wrap">
                    <div className="font-mono text-xs cv-faint w-20 shrink-0">{fmtDateShort(toDateOnly(b.booking_date))}</div>
                    <div className="font-mono text-sm w-16 shrink-0">{fmtTime(b.start_minutes)}</div>
                    <div className="flex-1 min-w-[140px]">
                      <div className="text-sm font-semibold">{b.duration_minutes} min with {m?.name || "your host"}</div>
                    </div>
                    <button onClick={() => { setReschedulingId(isRescheduling ? null : b.id); setNewDate(""); setNewSlots([]); setNewSlot(null); }} className="cv-btn-outline px-3 py-1.5 font-mono text-[10px] tracking-widest uppercase">
                      {isRescheduling ? "Cancel edit" : "Reschedule"}
                    </button>
                    <button onClick={() => cancel(b.id)} className="cv-x-btn font-mono text-[10px] tracking-widest uppercase">✕ Cancel</button>
                  </div>
                  {isRescheduling && (
                    <div className="mt-4 pt-4 space-y-3" style={{ borderTop: "1px solid var(--line)" }}>
                      <Field label="New date">
                        <input type="date" value={newDate} onChange={(e) => { setNewDate(e.target.value); loadSlotsForReschedule(b, e.target.value); }} className="cv-input w-full py-2" />
                      </Field>
                      {newDate && (
                        <div className="flex flex-wrap gap-2">
                          {newSlots.filter((s) => !s.booked).map((s) => (
                            <button key={s.label} onClick={() => setNewSlot(s)} className={`cv-slot px-3 py-1.5 font-mono text-sm ${newSlot?.label === s.label ? "cv-slot-selected" : ""}`}>{s.label}</button>
                          ))}
                          {newSlots.filter((s) => !s.booked).length === 0 && <div className="cv-faint text-sm italic">No open slots that day.</div>}
                        </div>
                      )}
                      <button disabled={!newSlot} onClick={() => confirmReschedule(b)} className="cv-btn-primary px-4 py-2 font-mono text-xs tracking-widest uppercase">Confirm new time</button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
