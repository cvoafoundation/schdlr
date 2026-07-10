import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../hooks/useAuth";
import { Panel, Avatar, LoadingBlock, ErrorBlock, EmptyState } from "../components/ui.jsx";
import { fmtTime, toDateOnly, downloadIcs, isWeekend, isMemberBlockedOnDate, buildAvailabilityIndex, toDateInput } from "../lib/scheduling.js";

function fmtDateShort(d) { return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default function DashboardPage() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [bookings, setBookings] = useState([]);
  const [attendeesByBooking, setAttendeesByBooking] = useState({});
  const [members, setMembers] = useState([]);
  const [waitlist, setWaitlist] = useState([]);
  const [availIndex, setAvailIndex] = useState(null);
  const [copied, setCopied] = useState(false);
  const [personFilter, setPersonFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");
  const [dateFilter, setDateFilter] = useState("");

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  async function load() {
    setLoading(true); setError("");
    const [b, ga, m, wl, bd, ro, va, pb] = await Promise.all([
      supabase.from("bookings").select("*").order("booking_date").order("start_minutes"),
      supabase.from("group_attendees").select("*"),
      supabase.from("team_members").select("*").order("name"),
      supabase.from("waitlist").select("*").order("created_at", { ascending: false }),
      supabase.from("blocked_dates").select("*"),
      supabase.from("recurring_days_off").select("*"),
      supabase.from("vacations").select("*"),
      supabase.from("partial_blocks").select("*"),
    ]);
    if (b.error) setError(b.error.message);
    setBookings(b.data || []);
    setMembers(m.data || []);
    setWaitlist(wl.data || []);
    setAvailIndex(buildAvailabilityIndex({ blockedDates: bd.data || [], recurringOff: ro.data || [], vacations: va.data || [], partialBlocks: pb.data || [] }));
    const grouped = {};
    (ga.data || []).forEach((a) => { (grouped[a.booking_id] ||= []).push(a); });
    setAttendeesByBooking(grouped);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function setStatus(id, status) { await supabase.from("bookings").update({ status }).eq("id", id); load(); }
  async function remove(id) { await supabase.from("bookings").delete().eq("id", id); load(); }
  function memberById(id) { return members.find((m) => m.id === id); }
  function copyLink() {
    if (navigator.clipboard) navigator.clipboard.writeText(`${baseUrl}/`);
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  }

  const todaysBookings = bookings.filter((b) => b.status === "upcoming" && isSameDayStr(b.booking_date, today));
  const waitingCount = waitlist.filter((w) => w.status === "waiting").length;

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

  if (loading) return <LoadingBlock label="Loading your day…" />;

  return (
    <div className="space-y-10">
      {error && <ErrorBlock message={error} />}

      {/* ---- Greeting + quick actions ---- */}
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="cv-graphite font-mono text-[11px] tracking-widest uppercase mb-1">
            {today.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          </div>
          <h2 className="font-display text-2xl font-bold">{greeting()}{profile ? `, ${profile.name.split(" ")[0]}` : ""}.</h2>
        </div>
        <button onClick={copyLink} className="cv-btn-outline px-4 py-2 font-mono text-xs tracking-widest uppercase">
          {copied ? "Copied ✓" : "Copy booking link"}
        </button>
      </div>

      {/* ---- Today's appointments ---- */}
      <div>
        <div className="cv-graphite font-mono text-[11px] tracking-widest mb-3 uppercase">Today's appointments</div>
        {todaysBookings.length === 0 ? (
          <EmptyState
            title="Nothing on the books today"
            body="Once someone books a time with your team, it'll show up here the day it happens."
            actionLabel={copied ? "Copied ✓" : "Copy booking link"}
            onAction={copyLink}
          />
        ) : (
          <div className="space-y-2">
            {todaysBookings.map((b) => {
              const m = memberById(b.member_id);
              const isGroup = b.event_type_id === "group";
              return (
                <div key={b.id} className="cv-list-row w-full px-5 py-4 flex items-center gap-4 flex-wrap">
                  <div className="font-mono text-sm w-16 shrink-0">{fmtTime(b.start_minutes)}</div>
                  <Avatar member={m} size={26} />
                  <div className="flex-1 min-w-[140px]">
                    <div className="text-sm font-semibold">{isGroup ? "Group orientation" : b.guest_name}</div>
                    <div className="cv-graphite text-xs font-mono">{isGroup ? `${(attendeesByBooking[b.id] || []).length} attendees` : `with ${m?.name || "—"}`}</div>
                  </div>
                  {b.urgent && <span className="cv-badge-urgent font-mono text-[9px] tracking-widest uppercase px-2 py-1">⚡ Urgent</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ---- Team status + waitlist side by side ---- */}
      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <div className="cv-graphite font-mono text-[11px] tracking-widest mb-3 uppercase">Team status — today</div>
          <Panel className="cv-card">
            {members.length === 0 ? (
              <div className="cv-faint text-sm italic">No team members yet.</div>
            ) : (
              <div className="space-y-3">
                {members.map((m) => {
                  const out = availIndex && (isWeekend(today) || isMemberBlockedOnDate(m.id, today, availIndex));
                  return (
                    <div key={m.id} className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Avatar member={m} size={28} />
                        <span className="text-sm font-semibold">{m.name}</span>
                      </div>
                      <span className={`font-mono text-[10px] tracking-widest uppercase px-2 py-1 border ${out ? "" : "cv-badge-upcoming"}`} style={out ? { borderColor: "var(--faint)", color: "var(--faint)" } : {}}>
                        {out ? "Out today" : "Available"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>

        <div>
          <div className="cv-graphite font-mono text-[11px] tracking-widest mb-3 uppercase">Waitlist</div>
          {waitingCount === 0 ? (
            <EmptyState title="No one's waiting" body="When a fully-booked day fills up, guests can join a waitlist — they'll show up here." />
          ) : (
            <Panel className="cv-card">
              <div className="space-y-3">
                {waitlist.filter((w) => w.status === "waiting").slice(0, 4).map((w) => (
                  <div key={w.id} className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold">{w.guest_name}</div>
                      <div className="cv-graphite font-mono text-xs">{fmtDateShort(toDateOnly(w.waitlist_date))} · {w.event_type_id}</div>
                    </div>
                  </div>
                ))}
              </div>
              {waitingCount > 4 && <div className="cv-graphite font-mono text-[10px] tracking-widest uppercase mt-3">+{waitingCount - 4} more below</div>}
            </Panel>
          )}
        </div>
      </div>

      {/* ---- Full bookings list ---- */}
      <div>
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div className="cv-graphite font-mono text-[11px] tracking-widest uppercase">All bookings — {filtered.length} items</div>
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
          <EmptyState
            title="No bookings match this filter"
            body="Try a different status or person, or share your booking link to start accepting appointments."
            actionLabel={copied ? "Copied ✓" : "Copy booking link"}
            onAction={copyLink}
          />
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
                    <Avatar member={m} size={24} />
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
      </div>
    </div>
  );
}

function isSameDayStr(isoDateStr, dateObj) {
  return toDateOnly(isoDateStr).toDateString() === dateObj.toDateString();
}
