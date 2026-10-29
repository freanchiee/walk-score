/**
 * Framing guide drawn over the camera preview for the top-down scan: two translucent foot zones, a dashed centre line
 * and a "walk this way" label. The line is the heading reference (the top of the screen is the walking direction): a
 * camera alignment aid, not something to step on. It only helps people frame the shot; the analysis does not depend on it.
 * The zones turn green when the live check sees both feet.
 */
export function FootGuideOverlay({ feetFound = false }: { feetFound?: boolean }) {
  const zone = feetFound ? "rgba(134,239,172,0.22)" : "rgba(255,255,255,0.10)";
  const edge = feetFound ? "rgba(134,239,172,0.9)" : "rgba(255,255,255,0.75)";
  return (
    <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="none">
      <g fill={zone} stroke={edge} strokeWidth="2.5" strokeDasharray="7 6">
        <ellipse cx="31%" cy="64%" rx="7%" ry="9%" />
        <ellipse cx="65%" cy="64%" rx="7%" ry="9%" />
      </g>
      <line x1="48%" y1="24%" x2="48%" y2="84%" stroke="rgba(255,255,255,0.5)" strokeWidth="1.75" strokeDasharray="6 7" />
      <text
        x="48%"
        y="22%"
        textAnchor="middle"
        fill="white"
        fontSize="14"
        fontWeight="700"
        stroke="rgba(0,0,0,0.65)"
        strokeWidth="3"
        style={{ paintOrder: "stroke" }}
      >
        ↑ walk this way
      </text>
    </svg>
  );
}
