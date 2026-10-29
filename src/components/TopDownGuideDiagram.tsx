/**
 * How to hold the phone for the top-down scan: side view (arm out, phone flat, camera looking straight down at the
 * feet) next to what the camera then sees. Decorative; the steps are also written out.
 */
export function TopDownGuideDiagram() {
  return (
    <svg
      viewBox="0 0 360 200"
      className="h-auto w-full"
      role="img"
      aria-label="Left: a person holds the phone out in front of them, flat, with the camera pointing straight down at their feet. Right: the camera view shows two feet seen from above, with the top of the picture pointing the way they walk."
    >
      {/* ---- side view ---- */}
      <line x1="8" y1="176" x2="196" y2="176" stroke="var(--muted)" strokeWidth="2" opacity="0.5" />
      {/* camera cone from the phone down to the floor */}
      <polygon points="118,86 92,176 144,176" fill="var(--accent-2)" opacity="0.14" />
      <line x1="118" y1="86" x2="92" y2="176" stroke="var(--accent-2)" strokeWidth="1.5" strokeDasharray="4 4" />
      <line x1="118" y1="86" x2="144" y2="176" stroke="var(--accent-2)" strokeWidth="1.5" strokeDasharray="4 4" />
      {/* person */}
      <g stroke="var(--accent)" strokeWidth="3.5" strokeLinecap="round" fill="none">
        <circle cx="52" cy="32" r="11" fill="var(--accent)" stroke="none" />
        <line x1="52" y1="44" x2="52" y2="106" />
        <line x1="52" y1="106" x2="46" y2="174" />
        <line x1="52" y1="106" x2="64" y2="174" />
        <line x1="52" y1="58" x2="92" y2="76" />
        <line x1="92" y1="76" x2="108" y2="84" />
      </g>
      {/* feet (side view) */}
      <g stroke="var(--accent)" strokeWidth="3.5" strokeLinecap="round">
        <line x1="46" y1="174" x2="62" y2="174" />
        <line x1="64" y1="174" x2="80" y2="174" />
      </g>
      {/* phone, flat in the hand */}
      <rect x="102" y="82" width="34" height="7" rx="3" fill="var(--surface-strong)" stroke="var(--text)" strokeWidth="2" />
      <circle cx="118" cy="91.5" r="2.2" fill="var(--accent-2)" />
      <text x="8" y="196" fontSize="11" fill="var(--muted)">
        camera points straight down
      </text>

      {/* ---- what the camera sees ---- */}
      <rect x="236" y="12" width="96" height="170" rx="12" fill="var(--surface)" stroke="var(--muted)" strokeWidth="1.5" />
      {/* plain floor lines */}
      <g stroke="var(--muted)" opacity="0.18" strokeWidth="1">
        <line x1="240" y1="60" x2="328" y2="60" />
        <line x1="240" y1="104" x2="328" y2="104" />
        <line x1="240" y1="148" x2="328" y2="148" />
      </g>
      {/* forward arrow */}
      <g stroke="var(--text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <line x1="284" y1="58" x2="284" y2="28" />
        <polyline points="277,36 284,28 291,36" />
      </g>
      <text x="284" y="22" fontSize="10" textAnchor="middle" fill="var(--text)">
        walk this way
      </text>
      {/* two feet from above, toes up */}
      <g fill="var(--accent)">
        <ellipse cx="262" cy="128" rx="13" ry="30" transform="rotate(-3 262 128)" />
        <ellipse cx="306" cy="128" rx="13" ry="30" transform="rotate(3 306 128)" />
        <circle cx="258" cy="95" r="3" fill="var(--text)" />
        <circle cx="310" cy="95" r="3" fill="var(--text)" />
      </g>
      <text x="284" y="196" fontSize="11" textAnchor="middle" fill="var(--muted)">
        your camera view
      </text>
    </svg>
  );
}
