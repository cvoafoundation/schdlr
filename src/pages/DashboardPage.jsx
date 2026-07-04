import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { Panel, LoadingBlock, ErrorBlock } from "../components/ui.jsx";
import { fmtTime, toDateOnly, downloadIcs } from "../lib/scheduling.js";

function fmtDateShort(d) { return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }); }

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [bookings, setBookings] = useState([]);
  const [attendeesByBooking, setAttendeesByBooking] = useState({});
  const [members, setMembers] = useState([]);
  const [waitlist, setWaitlist] = useState([]);
  const [personFilter, setPersonFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");
  const [dateFilter, setDateFilter] = useState("");

  async function load() {
    setLoading(true); setError("");
    const [b, ga, m, wl] = await Promise.all([
      supabase.from("bookings").select("*").order("booking_date").order("start_minutes"),
      supabase.from("group_attendees").select("*"),
      supabase.from("team_members").select("*").order("name"),
      supabase.from("waitlist").select("*").order("created_at", { ascending: false }),
    ]);
    if (b.error) setError(b.error.message);
    setBookings(b.data || []);
    setMembers(m.data || []);
    setWaitlist(wl.data || []);
    const grouped = {};
    (ga.data || []).forEach((a) => { (grouped[a.booking_id] ||= []).push(a); });
    setAttendeesByBooking(grouped);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function setStatus(id, status) {
    await supabase.from("bookings").update({ status }).eq("id", id);
    load();
  }
  async function remove(id) {
    await supabase.from("bookings").delete().eq("id", id);
    load();
  }
  function memberById(id) { return members.find((m) => m.id === id); }

  const filtered = bookings
    .filter((b) => personFilter === "all" || b.member_id === personFilter)
    .filter((b) => !dateFilter || b.booking_date === dateFilter)
    .filter((b) => (statusFilter === "active" ? b.status === "upcoming" : statusFilter === "all" ? true : b.status === statusFilter));

  const statusMeta = {
    upcoming: { label: "Upcoming", cls: "cv-badge-upcoming" },
    completed: { label: "Completed", cls: "cv-badge-completed" },
    "no-show": { label: "No-show", cls: "cv-badge-noshow" },
    canceled: { label: "Canceled", cls: "cv-badge-canceled" },
  };

  if (loading) return <LoadingBlock label="Loading dashboard…" />;

  return (
    <div>
      {error && <ErrorBlock message={error} />}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="cv-graphite font-mono text-[11px] tracking-widest uppercase">{filtered.length} items</div>
        <input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className="cv-input py-1.5 px-2 text-sm" />
      </div>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div className="flex flex-wrap gap-2">
          {["active", "completed", "no-show", "canceled", "all"].map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)} className={`cv-tab font-mono text-[10px] tracking-widest uppercase px-3 py-1.5 ${statusFilter === s ? "cv-tab-active" : ""}`}>{s === "active" ? "Upcoming" : s}</button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setPersonFilter("all")} className={`cv-tab font-mono text-[11px] tracking-widest uppercase px-3 py-1.5 ${personFilter === "all" ? "cv-tab-active" : ""}`}>Everyone</button>
          {members.map((m) => <button key={m.id} onClick={() => setPersonFilter(m.id)} className={`cv-tab font-mono text-[11px] tracking-widest uppercase px-3 py-1.5 ${personFilter === m.id ? "cv-tab-active" : ""}`}>{m.initials}</button>)}
        </div>
      </div>

      {filtered.length === 0 ? (
        <Panel className="cv-card text-center py-12"><div className="cv-faint italic">Nothing here for this filter.</div></Panel>
      ) : (
        <div className="space-y-2">
          {filtered.map((b) => {
            const m = memberById(b.member_id);
            const meta = statusMeta[b.status] || statusMeta.upcoming;
            const isGroup = b.event_type_id === "group";
            const attendees = attendeesByBooking[b.id] || [];
            return (
              <div key={b.id} className="cv-list-row w-full px-5 py-4 flex items-center gap-4 flex-wrap">
                <div className="font-mono text-xs cv-faint w-20 shrink-0">{fmtDateShort(toDateOnly(b.booking_date))}</div>
                <div className="font-mono text-sm w-16 shrink-0">{fmtTime(b.start_minutes)}</div>
                <div className="flex items-center gap-2 w-36 shrink-0">
                  <span className="cv-pill-badge font-mono text-[10px] w-6 h-6 flex items-center justify-center border">{m?.initials || "?"}</span>
                  <span className="text-sm font-semibold">{m?.name || "Unassigned"}</span>
                </div>
                <div className="flex-1 min-w-[140px]">
                  {isGroup ? (
                    <>
                      <div className="text-sm font-semibold">Group orientation</div>
                      <div className="cv-graphite text-xs font-mono">{attendees.length} attendee{attendees.length === 1 ? "" : "s"}</div>
                    </>
                  ) : (
                    <>
                      <div className="text-sm font-semibold">{b.guest_name}</div>
                      <div className="cv-graphite text-xs font-mono">{b.guest_email}</div>
                    </>
                  )}
                </div>
                {b.urgent && <span className="cv-badge-urgent font-mono text-[9px] tracking-widest uppercase px-2 py-1">⚡ Urgent</span>}
                {b.series_id && <span className="cv-badge font-mono text-[9px] tracking-widest uppercase px-2 py-1">🔁 {b.series_index}/{b.series_total}</span>}
                <span className={`cv-badge font-mono text-[9px] tracking-widest uppercase px-2 py-1 ${meta.cls}`}>{meta.label}</span>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => downloadIcs({ id: b.id, date: toDateOnly(b.booking_date), minutes: b.start_minutes, duration: b.duration_minutes, guest_name: b.guest_name, guest_email: b.guest_email }, m?.name || "team")} title="Download .ics" className="cv-icon-btn p-1.5">⬇</button>
                  {b.status === "upcoming" && !isGroup && (
                    <>
                      <button onClick={() => setStatus(b.id, "completed")} title="Mark completed" className="cv-icon-btn p-1.5">✓</button>
                      <button onClick={() => setStatus(b.id, "no-show")} title="Mark no-show" className="cv-icon-btn p-1.5">✕</button>
                    </>
                  )}
                  <button onClick={() => remove(b.id)} title="Delete" className="cv-x-btn p-1.5">🗑</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-10">
        <div className="cv-graphite font-mono text-[11px] tracking-widest mb-3 uppercase">Waitlist</div>
        {waitlist.length === 0 ? (
          <Panel className="cv-card text-center py-8"><div className="cv-faint italic text-sm">Nobody's waiting on a spot right now.</div></Panel>
        ) : (
          <div className="space-y-2">
            {waitlist.map((w) => (
              <div key={w.id} className="cv-row flex items-center justify-between px-4 py-3 flex-wrap gap-2">
                <div>
                  <div className="text-sm font-semibold">{w.guest_name} <span className="cv-graphite font-normal">— {w.event_type_id}</span></div>
                  <div className="font-mono text-xs cv-graphite">{fmtDateShort(toDateOnly(w.waitlist_date))} · {w.guest_email}</div>
                </div>
                <span className={`cv-badge font-mono text-[9px] tracking-widest uppercase px-2 py-1 ${w.status === "notified" ? "cv-badge-upcoming" : ""}`}>{w.status === "notified" ? "Notified" : "Waiting"}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
