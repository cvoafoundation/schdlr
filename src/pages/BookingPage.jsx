import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { Panel, Field, Row, BackLink, StepRail, LoadingBlock, ErrorBlock, Avatar } from "../components/ui.jsx";
import {
  addDays, isWeekend, isSameDay, toDateInput, toDateOnly, fmtTime,
  buildAvailabilityIndex, isMemberBlockedOnDate, meetingCount, getSlotsForMember,
  findEarliestSlot, downloadIcs,
} from "../lib/scheduling.js";

const ANY = { id: "any", name: "Any available team member", role: "Fastest to book", initials: "—" };
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DOW = ["S", "M", "T", "W", "T", "F", "S"];
const CADENCES = [{ id: "weekly", label: "Every week", days: 7 }, { id: "biweekly", label: "Every 2 weeks", days: 14 }, { id: "monthly", label: "Every month", days: 30 }];
function daysInMonth(year, month) { return new Date(year, month + 1, 0).getDate(); }
function fmtDateShort(d) { return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }); }

export default function BookingPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [orgId, setOrgId] = useState(null);
  const [members, setMembers] = useState([]);
  const [eventTypes, setEventTypes] = useState([]);
  const [settings, setSettings] = useState(null);
  const [bookingsRange, setBookingsRange] = useState([]);
  const [index, setIndex] = useState(null);

  const [step, setStep] = useState("event");
  const [eventType, setEventType] = useState(null);
  const [member, setMember] = useState(ANY);
  const [viewMonth, setViewMonth] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", notes: "" });
  const [urgent, setUrgent] = useState(false);
  const [urgentMsg, setUrgentMsg] = useState("");
  const [seriesRepeat, setSeriesRepeat] = useState({ enabled: false, cadence: "biweekly", count: 3 });
  const [waitlistForm, setWaitlistForm] = useState({ name: "", email: "" });
  const [submitting, setSubmitting] = useState(false);
  const [confirmedBooking, setConfirmedBooking] = useState(null);
  const [honeypot, setHoneypot] = useState("");
  const [formOpenedAt] = useState(() => Date.now());

  async function loadStatic() {
    setLoading(true); setError("");
    // Bridge until Stage 4 builds real /book/:slug URLs — every public page
    // currently resolves to CVOA specifically. This is the one deliberate
    // hardcode in the app; everything downstream of it is properly scoped.
    const { data: resolvedOrgId, error: orgErr } = await supabase.rpc("get_org_id_by_slug", { p_slug: "cvoa" });
    if (orgErr || !resolvedOrgId) { setError("Couldn't load this booking page."); setLoading(false); return; }
    setOrgId(resolvedOrgId);

    const [m, et, s] = await Promise.all([
      supabase.rpc("get_public_org_roster", { p_org_id: resolvedOrgId }),
      supabase.from("event_types").select("*").eq("organization_id", resolvedOrgId).order("sort_order"),
      supabase.from("org_settings").select("*").eq("organization_id", resolvedOrgId).single(),
    ]);
    if (m.error || et.error || s.error) setError((m.error || et.error || s.error).message);
    setMembers((m.data || []).map((mm) => ({ id: mm.user_id, name: mm.display_name, role: mm.job_title || "Team member", initials: mm.initials, avatar_url: mm.avatar_url })));
    setEventTypes(et.data || []);
    setSettings(s.data || { buffer_minutes: 15, notice_hours: 4, daily_cap: 6 });
    setLoading(false);
  }
  useEffect(() => { loadStatic(); }, []);

  async function loadAvailabilityAndBookings(currentOrgId) {
    if (!currentOrgId) return;
    const from = toDateInput(new Date());
    const to = toDateInput(addDays(new Date(), 60));
    const [bd, ro, va, pb, slots] = await Promise.all([
      supabase.from("blocked_dates").select("*").eq("organization_id", currentOrgId),
      supabase.from("recurring_days_off").select("*").eq("organization_id", currentOrgId),
      supabase.from("vacations").select("*").eq("organization_id", currentOrgId),
      supabase.from("partial_blocks").select("*").eq("organization_id", currentOrgId),
      supabase.rpc("public_booking_slots", { p_org_id: currentOrgId, p_from: from, p_to: to }),
    ]);
    setIndex(buildAvailabilityIndex({ blockedDates: bd.data || [], recurringOff: ro.data || [], vacations: va.data || [], partialBlocks: pb.data || [] }));
    setBookingsRange((slots.data || []).map((b) => ({ ...b, member_id: b.member_id })));
  }
  useEffect(() => { if (orgId) loadAvailabilityAndBookings(orgId); }, [orgId]);

  const teamIds = members.map((m) => m.id);
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const steps = useMemo(() => {
    if (eventType?.is_group) return [{ id: "event", num: "01", label: "Session" }, { id: "datetime", num: "02", label: "Time" }, { id: "details", num: "03", label: "Details" }, { id: "confirmed", num: "04", label: "Confirmed" }];
    return [{ id: "event", num: "01", label: "Duration" }, { id: "team", num: "02", label: "Who with" }, { id: "datetime", num: "03", label: "Time" }, { id: "details", num: "04", label: "Details" }, { id: "confirmed", num: "05", label: "Confirmed" }];
  }, [eventType]);

  const monthGrid = useMemo(() => {
    const { year, month } = viewMonth;
    const firstDow = new Date(year, month, 1).getDay();
    const total = daysInMonth(year, month);
    const cells = [];
    for (let i = 0; i < firstDow; i++) cells.push(null);
    for (let d = 1; d <= total; d++) cells.push(new Date(year, month, d));
    return cells;
  }, [viewMonth]);

  function isDateHardBlocked(d) {
    if (!index) return true;
    if (d < today || isWeekend(d)) return true;
    if (eventType?.is_group) return false; // group sessions have no single fixed host to check
    if (member.id === "any") return teamIds.every((id) => isMemberBlockedOnDate(id, d, index));
    return isMemberBlockedOnDate(member.id, d, index);
  }
  function isDateFull(d) {
    if (!index) return false;
    if (eventType?.is_group) {
      const existing = bookingsRange.find((b) => b.is_group && isSameDay(toDateOnly(b.booking_date), d));
      return existing ? existing.attendee_count >= eventType.capacity : false;
    }
    const check = (id) => meetingCount(id, d, bookingsRange) >= settings.daily_cap;
    if (member.id === "any") return teamIds.filter((id) => !isMemberBlockedOnDate(id, d, index)).every(check);
    return check(member.id);
  }

  const slots = useMemo(() => {
    if (!selectedDate || !eventType || eventType.is_group || !index) return [];
    if (member.id !== "any") return getSlotsForMember(selectedDate, eventType.duration_minutes, member.id, settings, bookingsRange, index);
    const eligible = teamIds.filter((id) => !isMemberBlockedOnDate(id, selectedDate, index) && meetingCount(id, selectedDate, bookingsRange) < settings.daily_cap);
    if (eligible.length === 0) return [];
    const perMember = eligible.map((id) => getSlotsForMember(selectedDate, eventType.duration_minutes, id, settings, bookingsRange, index));
    return perMember[0].map((s, idx) => ({ ...s, booked: perMember.every((ms) => ms[idx].booked) }));
  }, [selectedDate, eventType, member, settings, bookingsRange, index]);

  const groupExisting = eventType?.is_group && selectedDate ? bookingsRange.find((b) => b.is_group && isSameDay(toDateOnly(b.booking_date), selectedDate)) : null;
  const groupFilled = groupExisting ? groupExisting.attendee_count : 0;

  function pickEvent(evt) {
    setEventType(evt); setSelectedDate(null); setSelectedSlot(null); setUrgent(false); setUrgentMsg("");
    setSeriesRepeat({ enabled: false, cadence: "biweekly", count: 3 });
    if (evt.is_group) { setMember(ANY); setStep("datetime"); }
    else { setMember(ANY); setStep("team"); }
  }
  function continueFromTeam() {
    if (!urgent) { setStep("datetime"); return; }
    const found = findEarliestSlot(eventType.duration_minutes, member.id, teamIds, settings, bookingsRange, index);
    if (!found) { setUrgentMsg("No urgent opening found in the next 45 days — try picking a time manually."); return; }
    if (found.memberId) setMember(members.find((m) => m.id === found.memberId));
    setSelectedDate(found.date); setSelectedSlot(found.slot); setStep("details");
  }
  function goBack() { setSelectedDate(null); setSelectedSlot(null); setStep(eventType?.is_group ? "event" : "team"); }

  function resolveAssignee() {
    if (member.id !== "any") return member;
    const eligible = members.filter((m) => {
      if (isMemberBlockedOnDate(m.id, selectedDate, index)) return false;
      const s = getSlotsForMember(selectedDate, eventType.duration_minutes, m.id, settings, bookingsRange, index).find((s) => s.minutes === selectedSlot.minutes);
      return s && !s.booked;
    });
    if (eligible.length === 0) return member;
    eligible.sort((a, b) => meetingCount(a.id, selectedDate, bookingsRange) - meetingCount(b.id, selectedDate, bookingsRange));
    return eligible[0];
  }

  async function joinWaitlist() {
    if (!waitlistForm.name || !waitlistForm.email || !selectedDate) return;
    await supabase.from("waitlist").insert({
      event_type_id: eventType.id, member_id: member.id === "any" ? null : member.id,
      waitlist_date: toDateInput(selectedDate), guest_name: waitlistForm.name, guest_email: waitlistForm.email,
      organization_id: orgId,
    });
    setWaitlistForm({ name: "", email: "" });
    alert("You're on the list — we'll reach out if a spot opens.");
  }

  async function confirmBooking() {
    if (honeypot) return; // a bot filled the invisible field — silently drop it
    if (Date.now() - formOpenedAt < 2500) {
      setError("That went a little fast — please double check your details and try again.");
      return;
    }
    setSubmitting(true); setError("");
    try {
      if (eventType.is_group) {
        let bookingId = groupExisting?.id;
        if (!bookingId) {
          const { data, error } = await supabase.from("bookings").insert({
            event_type_id: eventType.id, member_id: null, booking_date: toDateInput(selectedDate),
            start_minutes: eventType.fixed_minutes, duration_minutes: eventType.duration_minutes,
            guest_name: "Group session", guest_email: "group@cvoa.org", status: "upcoming", organization_id: orgId,
          }).select().single();
          if (error) throw error;
          bookingId = data.id;
        }
        const { error: gaError } = await supabase.from("group_attendees").insert({ booking_id: bookingId, name: form.name, email: form.email, organization_id: orgId });
        if (gaError) throw gaError;
        setConfirmedBooking({ id: bookingId, date: selectedDate, minutes: eventType.fixed_minutes, duration: eventType.duration_minutes });
        setStep("confirmed");
        return;
      }

      const assignee = resolveAssignee();
      setMember(assignee);

      if (seriesRepeat.enabled) {
        const seriesId = crypto.randomUUID();
        let d = selectedDate;
        const rows = [];
        for (let i = 0; i < seriesRepeat.count; i++) {
          rows.push({
            event_type_id: eventType.id, member_id: assignee.id, booking_date: toDateInput(d), start_minutes: selectedSlot.minutes,
            duration_minutes: eventType.duration_minutes, guest_name: form.name, guest_email: form.email, guest_phone: form.phone,
            notes: form.notes, status: "upcoming", urgent, series_id: seriesId, series_index: i + 1, series_total: seriesRepeat.count,
            organization_id: orgId,
          });
          const cad = CADENCES.find((c) => c.id === seriesRepeat.cadence);
          d = cad.id === "monthly" ? new Date(d.getFullYear(), d.getMonth() + 1, d.getDate()) : addDays(d, cad.days);
        }
        const { error } = await supabase.from("bookings").insert(rows);
        if (error) throw error;
        setConfirmedBooking({ id: seriesId, date: selectedDate, minutes: selectedSlot.minutes, duration: eventType.duration_minutes });
        setStep("confirmed");
        return;
      }

      const { data, error } = await supabase.from("bookings").insert({
        event_type_id: eventType.id, member_id: assignee.id, booking_date: toDateInput(selectedDate), start_minutes: selectedSlot.minutes,
        duration_minutes: eventType.duration_minutes, guest_name: form.name, guest_email: form.email, guest_phone: form.phone,
        notes: form.notes, status: "upcoming", urgent, organization_id: orgId,
      }).select().single();
      if (error) throw error;
      setConfirmedBooking({ id: data.id, date: selectedDate, minutes: selectedSlot.minutes, duration: eventType.duration_minutes });
      setStep("confirmed");
    } catch (e) {
      setError(e.message || "Something went wrong submitting your booking.");
    } finally {
      setSubmitting(false);
    }
  }

  function resetAll() {
    setStep("event"); setEventType(null); setMember(ANY); setSelectedDate(null); setSelectedSlot(null);
    setForm({ name: "", email: "", phone: "", notes: "" }); setUrgent(false); setUrgentMsg("");
    setSeriesRepeat({ enabled: false, cadence: "biweekly", count: 3 }); setConfirmedBooking(null);
    loadAvailabilityAndBookings(orgId);
  }

  if (error && !loading) return <div className="max-w-md mx-auto"><ErrorBlock message={error} /></div>;
  if (loading || !index) return <LoadingBlock label="Loading booking page…" />;

  const hostLabel = member.id === "any" ? "next available team member" : `${member.name} — ${member.role}`;

  return (
    <div>
      {error && <ErrorBlock message={error} />}
      <StepRail steps={steps} activeId={step} />

      {step === "event" && (
        <div className="space-y-3">
          {eventTypes.map((evt) => (
            <button key={evt.id} onClick={() => pickEvent(evt)} className="cv-list-row w-full text-left px-5 py-4 flex items-center gap-5 group">
              <span className="cv-list-code font-mono text-xs">{evt.code}</span>
              <div className="flex-1">
                <span className="font-display font-bold text-lg">{evt.title}</span>
                <div className="cv-graphite text-sm mt-1">{evt.is_group ? `Group session · up to ${evt.capacity} guests · ${fmtTime(evt.fixed_minutes)}` : "Choose who you'll meet with next."}</div>
              </div>
              <span className="cv-list-arrow shrink-0">→</span>
            </button>
          ))}
        </div>
      )}

      {step === "team" && (
        <div>
          <BackLink onClick={() => setStep("event")} label="Duration" />
          <div className="grid sm:grid-cols-2 gap-3 mt-5">
            {[ANY, ...members].map((m) => {
              const active = member.id === m.id;
              return (
                <button key={m.id} onClick={() => setMember(m)} className={`cv-member-card text-left px-5 py-4 flex items-center gap-4 ${active ? "cv-member-card-active" : ""}`}>
                  <Avatar member={m} size={36} className={active ? "cv-member-badge-active" : ""} />
                  <div><div className="font-semibold">{m.name}</div><div className="cv-graphite text-xs font-mono">{m.role}</div></div>
                </button>
              );
            })}
          </div>
          <label className="flex items-center gap-3 mt-6 cursor-pointer">
            <input type="checkbox" checked={urgent} onChange={(e) => { setUrgent(e.target.checked); setUrgentMsg(""); }} className="w-4 h-4" />
            <span className="text-sm">⚡ This is urgent — find the next open time automatically</span>
          </label>
          {urgentMsg && <div className="cv-note font-mono text-[11px] mt-3 px-4 py-3">{urgentMsg}</div>}
          <button onClick={continueFromTeam} className="cv-btn-primary mt-6 px-6 py-3 font-mono text-xs tracking-widest uppercase">Continue →</button>
        </div>
      )}

      {step === "datetime" && (
        <div>
          <BackLink onClick={goBack} label={eventType?.is_group ? "Session type" : "Who with"} />
          <div className="grid md:grid-cols-[1fr_280px] gap-6 mt-5">
            <Panel className="cv-card">
              <div className="flex items-center justify-between mb-6">
                <button onClick={() => setViewMonth((v) => { const m = v.month === 0 ? 11 : v.month - 1; const y = v.month === 0 ? v.year - 1 : v.year; return { year: y, month: m }; })} className="cv-icon-btn p-1">‹</button>
                <div className="font-display font-bold tracking-wide">{MONTH_NAMES[viewMonth.month].toUpperCase()} {viewMonth.year}</div>
                <button onClick={() => setViewMonth((v) => { const m = v.month === 11 ? 0 : v.month + 1; const y = v.month === 11 ? v.year + 1 : v.year; return { year: y, month: m }; })} className="cv-icon-btn p-1">›</button>
              </div>
              <div className="grid grid-cols-7 gap-1 cv-faint font-mono text-[10px] mb-2 tracking-widest">{DOW.map((d, i) => <div key={i} className="text-center">{d}</div>)}</div>
              <div className="grid grid-cols-7 gap-1">
                {monthGrid.map((d, i) => {
                  if (!d) return <div key={i} />;
                  const hard = isDateHardBlocked(d);
                  const full = !hard && isDateFull(d);
                  const selected = isSameDay(d, selectedDate);
                  const cls = hard ? "cv-day-disabled" : selected ? "cv-day cv-day-selected" : full ? "cv-day-full" : "cv-day";
                  return (
                    <button key={i} disabled={hard} onClick={() => { setSelectedDate(d); setSelectedSlot(null); setWaitlistForm({ name: "", email: "" }); }} className={`aspect-square text-sm font-mono flex items-center justify-center ${cls}`}>
                      {d.getDate()}
                    </button>
                  );
                })}
              </div>
              <div className="mt-4 cv-faint font-mono text-[10px] tracking-widest uppercase">Dotted underline = full but waitlistable</div>
            </Panel>

            <Panel className="cv-card flex flex-col">
              <div className="cv-graphite font-mono text-[11px] mb-1">{selectedDate ? selectedDate.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) : "SELECT A DATE"}</div>
              <div className="cv-graphite text-xs mb-4">{eventType?.duration_minutes} min · {eventType?.is_group ? "Group session" : hostLabel}</div>

              {!selectedDate && <div className="cv-faint text-sm italic">Pick a weekday to see availability.</div>}

              {selectedDate && eventType?.is_group && (
                isDateFull(selectedDate) ? (
                  <div className="space-y-3">
                    <div className="cv-note font-mono text-[11px] px-3 py-2">Full ({groupFilled}/{eventType.capacity}). Join the waitlist below.</div>
                    <Field label="Your name"><input value={waitlistForm.name} onChange={(e) => setWaitlistForm((w) => ({ ...w, name: e.target.value }))} className="cv-input w-full py-2" /></Field>
                    <Field label="Email"><input value={waitlistForm.email} onChange={(e) => setWaitlistForm((w) => ({ ...w, email: e.target.value }))} className="cv-input w-full py-2" /></Field>
                    <button onClick={joinWaitlist} className="cv-btn-outline w-full px-4 py-2 font-mono text-xs tracking-widest uppercase">Join waitlist</button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="font-mono text-sm">{fmtTime(eventType.fixed_minutes)} · {groupFilled}/{eventType.capacity} spots filled</div>
                    <button onClick={() => { setSelectedSlot({ label: fmtTime(eventType.fixed_minutes), minutes: eventType.fixed_minutes }); setStep("details"); }} className="cv-btn-primary w-full px-5 py-3 font-mono text-xs tracking-widest uppercase">Reserve my spot →</button>
                  </div>
                )
              )}

              {selectedDate && !eventType?.is_group && (
                isDateFull(selectedDate) ? (
                  <div className="space-y-3">
                    <div className="cv-note font-mono text-[11px] px-3 py-2">Fully booked for {hostLabel} this day.</div>
                    <Field label="Your name"><input value={waitlistForm.name} onChange={(e) => setWaitlistForm((w) => ({ ...w, name: e.target.value }))} className="cv-input w-full py-2" /></Field>
                    <Field label="Email"><input value={waitlistForm.email} onChange={(e) => setWaitlistForm((w) => ({ ...w, email: e.target.value }))} className="cv-input w-full py-2" /></Field>
                    <button onClick={joinWaitlist} className="cv-btn-outline w-full px-4 py-2 font-mono text-xs tracking-widest uppercase">Join waitlist</button>
                  </div>
                ) : (
                  <>
                    <div className="space-y-2 overflow-y-auto max-h-56 pr-1">
                      {slots.length === 0 ? <div className="cv-faint text-sm italic">No open slots this day.</div> : slots.map((s) => {
                        const selected = selectedSlot?.label === s.label;
                        const cls = s.booked ? "cv-slot-booked" : selected ? "cv-slot-selected" : "";
                        return <button key={s.label} disabled={s.booked} onClick={() => setSelectedSlot(s)} className={`cv-slot w-full font-mono text-sm px-3 py-2 ${cls}`}>{s.label}</button>;
                      })}
                    </div>
                    <button disabled={!selectedSlot} onClick={() => setStep("details")} className="cv-btn-primary mt-4 px-5 py-3 font-mono text-xs tracking-widest uppercase">Continue →</button>
                  </>
                )
              )}
            </Panel>
          </div>
        </div>
      )}

      {step === "details" && (
        <div className="max-w-lg">
          <BackLink onClick={() => setStep("datetime")} label="Time" />
          <Panel className="cv-card mt-5">
            <div className="cv-graphite font-mono text-[11px] tracking-widest mb-4">{eventType?.is_group ? "ATTENDEE DETAILS" : "YOUR DETAILS"}</div>
            <div className="space-y-4">
              <Field label="Full name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="cv-input w-full py-2" /></Field>
              <Field label="Email"><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="cv-input w-full py-2" /></Field>
              {!eventType?.is_group && <Field label="Phone (optional)"><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="cv-input w-full py-2" /></Field>}
              <Field label="Notes"><textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} className="cv-input w-full py-2 resize-none" /></Field>
              {/* Honeypot: invisible to real people, bots tend to fill every field they find */}
              <input
                type="text" tabIndex={-1} autoComplete="off" value={honeypot}
                onChange={(e) => setHoneypot(e.target.value)}
                style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }}
                aria-hidden="true"
              />
            </div>

            {!eventType?.is_group && member.id !== "any" && !urgent && (
              <div className="mt-6 pt-5" style={{ borderTop: "1px solid var(--line)" }}>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={seriesRepeat.enabled} onChange={(e) => setSeriesRepeat((s) => ({ ...s, enabled: e.target.checked }))} className="w-4 h-4" />
                  <span className="text-sm">🔁 Make this a recurring series</span>
                </label>
                {seriesRepeat.enabled && (
                  <div className="grid grid-cols-2 gap-3 mt-3">
                    <Field label="Repeats">
                      <select value={seriesRepeat.cadence} onChange={(e) => setSeriesRepeat((s) => ({ ...s, cadence: e.target.value }))} className="cv-input w-full py-2">
                        {CADENCES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                      </select>
                    </Field>
                    <Field label="Total sessions">
                      <select value={seriesRepeat.count} onChange={(e) => setSeriesRepeat((s) => ({ ...s, count: Number(e.target.value) }))} className="cv-input w-full py-2">
                        {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </Field>
                  </div>
                )}
              </div>
            )}

            <button disabled={!form.name || !form.email || submitting} onClick={confirmBooking} className="cv-btn-primary mt-6 w-full px-5 py-3 font-mono text-xs tracking-widest uppercase">
              {submitting ? "Booking…" : "Confirm booking"}
            </button>
          </Panel>
        </div>
      )}

      {step === "confirmed" && confirmedBooking && (
        <div className="max-w-lg">
          <Panel className="cv-card">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div><div className="cv-graphite font-mono text-[11px] tracking-widest mb-1">BOOKING RECORD</div><h2 className="font-display font-bold text-2xl">{eventType?.title}</h2></div>
              <div className="stamp text-sm font-extrabold">CONFIRMED</div>
            </div>
            <div className="mt-6 pt-5 space-y-3 font-mono text-sm" style={{ borderTop: "1px solid var(--line)" }}>
              <Row label="With" value={eventType?.is_group ? "CVOA team" : `${member.name} — ${member.role}`} />
              <Row label="Date" value={selectedDate?.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })} />
              <Row label="Time" value={`${selectedSlot?.label} · ${eventType?.duration_minutes} min`} />
              {!eventType?.is_group && <Row label="Guest" value={`${form.name} <${form.email}>`} />}
              {seriesRepeat.enabled && !eventType?.is_group && <Row label="Series" value={`${seriesRepeat.count} sessions, ${CADENCES.find((c) => c.id === seriesRepeat.cadence).label.toLowerCase()}`} />}
            </div>
            <button
              onClick={() => downloadIcs({ id: confirmedBooking.id, date: confirmedBooking.date, minutes: confirmedBooking.minutes, duration: confirmedBooking.duration, guest_name: form.name, guest_email: form.email }, eventType?.is_group ? "CVOA team" : member.name)}
              className="cv-btn-outline mt-7 w-full px-5 py-3 font-mono text-xs tracking-widest uppercase"
            >
              ⬇ Add to calendar (.ics)
            </button>
            <button onClick={resetAll} className="cv-link mt-4 w-full text-center px-5 py-2 font-mono text-xs tracking-widest uppercase">Book another</button>
          </Panel>
        </div>
      )}
    </div>
  );
}
