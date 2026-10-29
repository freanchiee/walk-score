/** Side view of the recommended setup: phone low and facing the walker, 3-4 m away. Decorative; the steps are also written out. */
export function GuideDiagram() {
  return (
    <svg
      viewBox="0 0 360 182"
      className="h-auto w-full"
      role="img"
      aria-label="Side view: a phone stands on the floor at about knee height, facing a person who stands three to four metres away."
    >
      {/* camera view */}
      <polygon points="58,98 290,30 290,128" fill="var(--accent-2)" opacity="0.1" />
      {/* floor */}
      <line x1="8" y1="128" x2="352" y2="128" stroke="var(--muted)" strokeWidth="2" opacity="0.5" />
      {/* phone on a small stand */}
      <path d="M40 128 L52 128 L46 112 Z" fill="var(--muted)" opacity="0.5" />
      <rect x="38" y="82" width="16" height="32" rx="3.5" fill="var(--surface-strong)" stroke="var(--text)" strokeWidth="2" />
      <circle cx="46" cy="90" r="2.2" fill="var(--accent-2)" />
      {/* knee-height marker */}
      <line x1="20" y1="128" x2="20" y2="98" stroke="var(--muted)" strokeWidth="1.5" />
      <line x1="15" y1="98" x2="25" y2="98" stroke="var(--muted)" strokeWidth="1.5" />
      <line x1="20" y1="76" x2="20" y2="94" stroke="var(--muted)" strokeWidth="1" strokeDasharray="2 3" />
      <text x="8" y="70" fontSize="11" fill="var(--muted)">
        knee height (~50 cm)
      </text>
      {/* person */}
      <g stroke="var(--accent)" strokeWidth="3.5" strokeLinecap="round" fill="none">
        <circle cx="300" cy="36" r="9" fill="var(--accent)" stroke="none" />
        <line x1="300" y1="47" x2="300" y2="84" />
        <line x1="300" y1="56" x2="287" y2="78" />
        <line x1="300" y1="56" x2="313" y2="78" />
        <line x1="300" y1="84" x2="291" y2="128" />
        <line x1="300" y1="84" x2="309" y2="128" />
      </g>
      {/* walking direction */}
      <text x="268" y="54" fontSize="11" textAnchor="end" fill="var(--text)">
        walk toward the phone
      </text>
      <g stroke="var(--text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <line x1="268" y1="66" x2="228" y2="66" />
        <polyline points="236,59 228,66 236,73" />
      </g>
      {/* distance */}
      <g stroke="var(--muted)" strokeWidth="1.5" strokeLinecap="round" fill="none">
        <line x1="46" y1="148" x2="298" y2="148" />
        <polyline points="53,143 46,148 53,153" />
        <polyline points="291,143 298,148 291,153" />
      </g>
      <text x="172" y="170" fontSize="12" fontWeight="700" textAnchor="middle" fill="var(--text)">
        3–4 m
      </text>
    </svg>
  );
}
