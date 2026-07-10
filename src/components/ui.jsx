export function Panel({ children, className = "" }) {
  return (
    <div className={`cv-panel relative p-6 sm:p-8 ${className}`}>
      <span className="absolute w-3 h-3 border-t-2 border-l-2 top-0 left-0 cv-bracket" style={{ borderColor: "var(--ink)" }} />
      <span className="absolute w-3 h-3 border-t-2 border-r-2 top-0 right-0 cv-bracket" style={{ borderColor: "var(--ink)" }} />
      <span className="absolute w-3 h-3 border-b-2 border-l-2 bottom-0 left-0 cv-bracket" style={{ borderColor: "var(--ink)" }} />
      <span className="absolute w-3 h-3 border-b-2 border-r-2 bottom-0 right-0 cv-bracket" style={{ borderColor: "var(--ink)" }} />
      {children}
    </div>
  );
}

export function Field({ label, children }) {
  return (
    <label className="block">
      <div className="cv-graphite font-mono text-[10px] tracking-widest mb-1 uppercase">{label}</div>
      {children}
    </label>
  );
}

export function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="cv-graphite">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

export function BackLink({ onClick, label }) {
  return (
    <button onClick={onClick} className="cv-link flex items-center gap-2 font-mono text-xs tracking-widest uppercase">
      ← {label}
    </button>
  );
}

export function StepRail({ steps, activeId }) {
  const activeIndex = steps.findIndex((s) => s.id === activeId);
  return (
    <div className="flex items-center gap-0 font-mono text-[11px] tracking-widest uppercase mb-10 overflow-x-auto">
      {steps.map((s, i) => {
        const done = i < activeIndex;
        const active = i === activeIndex;
        const cls = done ? "cv-step-done" : active ? "cv-step-active" : "cv-step-pending";
        return (
          <div key={s.id} className="flex items-center shrink-0">
            <div className="flex items-center gap-2">
              <span className={`cv-step-num flex items-center justify-center w-5 h-5 border ${cls}`}>{done ? "✓" : s.num}</span>
              <span className={cls}>{s.label}</span>
            </div>
            {i < steps.length - 1 && <span className="cv-divider w-8 sm:w-14 h-px mx-3" />}
          </div>
        );
      })}
    </div>
  );
}

export function LoadingBlock({ label = "Loading…" }) {
  return <div className="cv-faint font-mono text-sm py-16 text-center">{label}</div>;
}

export function Avatar({ member, size = 24, className = "" }) {
  const style = { width: size, height: size, fontSize: Math.max(9, size * 0.4) };
  if (member?.avatar_url) {
    return (
      <img
        src={member.avatar_url}
        alt={member.name || ""}
        style={style}
        className={`cv-pill-badge rounded-full object-cover border shrink-0 ${className}`}
      />
    );
  }
  return (
    <span style={style} className={`cv-pill-badge font-mono flex items-center justify-center border shrink-0 ${className}`}>
      {member?.initials || "?"}
    </span>
  );
}

export function ErrorBlock({ message }) {
  return (
    <div className="cv-note font-mono text-sm px-4 py-3" style={{ borderColor: "var(--stamp)", color: "var(--stamp)" }}>
      {message}
    </div>
  );
}
