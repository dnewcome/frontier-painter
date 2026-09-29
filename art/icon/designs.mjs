// art/icon/designs.mjs — app icon designs as SVG bodies (512x512 viewBox).
// v1 "Porthole stroke" is the shipped icon (scripts/make-icons.mjs renders it);
// v2/v3 are the alternates from the 2026-09-29 exploration (art/icon/compare.png).
const stars = (n, seed, box = [0, 0, 512, 512], col = "#dcecff") => {
  let a = seed;
  const r = () => ((a = (a * 16807) % 2147483647) / 2147483647);
  let s = "";
  for (let i = 0; i < n; i++) {
    s += `<circle cx="${box[0] + r() * (box[2] - box[0])}" cy="${box[1] + r() * (box[3] - box[1])}" r="${0.8 + r() * 1.8}" fill="${col}" opacity="${0.45 + r() * 0.5}"/>`;
  }
  return s;
};
const TRI = `<linearGradient id="tri" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="#7cc8ee"/><stop offset="0.5" stop-color="#ff9a3c"/><stop offset="1" stop-color="#a672ff"/></linearGradient>`;

// A brush stroke with dry-brush bristle streaks, along path d.
const brush = (d, w, grad = "url(#tri)") => `
  <path d="${d}" fill="none" stroke="#0b0f1a" stroke-width="${w + 22}" stroke-linecap="round" opacity="0.35"/>
  <path d="${d}" fill="none" stroke="${grad}" stroke-width="${w}" stroke-linecap="round"/>
  <path d="${d}" fill="none" stroke="#ffffff" stroke-width="${w * 0.12}" stroke-linecap="round" opacity="0.55" transform="translate(0 ${-w * 0.22})"/>
  <path d="${d}" fill="none" stroke="#000" stroke-width="${w * 0.07}" stroke-linecap="round" opacity="0.18" transform="translate(0 ${w * 0.24})"/>
  <path d="${d}" fill="none" stroke="#fff" stroke-width="${w * 0.05}" stroke-dasharray="${w * 0.9} ${w * 0.6}" stroke-linecap="round" opacity="0.35" transform="translate(0 ${w * 0.05})"/>`;

export const V = {
  // 1. Porthole onto space, a tri-colour brush stroke painted across the glass.
  v1: `
  <defs>${TRI}
    <radialGradient id="bg" cx="50%" cy="42%" r="75%"><stop offset="0" stop-color="#2a3a52"/><stop offset="1" stop-color="#101723"/></radialGradient>
    <radialGradient id="glass" cx="42%" cy="36%" r="70%"><stop offset="0" stop-color="#1b3a78"/><stop offset="0.6" stop-color="#0a1633"/><stop offset="1" stop-color="#02040a"/></radialGradient>
    <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e9eef4"/><stop offset="0.5" stop-color="#9aa6b4"/><stop offset="1" stop-color="#5d6877"/></linearGradient>
    <clipPath id="g"><circle cx="256" cy="256" r="160"/></clipPath>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <circle cx="256" cy="256" r="206" fill="url(#ring)"/>
  <circle cx="256" cy="256" r="178" fill="#3d4654"/>
  ${[...Array(10)].map((_, i) => { const a = (i / 10) * Math.PI * 2; return `<circle cx="${256 + Math.cos(a) * 192}" cy="${256 + Math.sin(a) * 192}" r="8" fill="#4b5563"/><circle cx="${256 + Math.cos(a) * 192 - 2}" cy="${256 + Math.sin(a) * 192 - 2}" r="4" fill="#dfe6ee"/>`; }).join("")}
  <circle cx="256" cy="256" r="160" fill="url(#glass)"/>
  <g clip-path="url(#g)">${stars(40, 7, [96, 96, 416, 416])}
    <ellipse cx="200" cy="180" rx="120" ry="60" fill="#fff" opacity="0.06" transform="rotate(-35 200 180)"/></g>
  ${brush("M78 356 C 170 250, 300 318, 438 170", 62)}
  <circle cx="438" cy="170" r="10" fill="#fff" opacity="0.8"/>`,

  // 2. Safety-orange hull panel, hazard band, her signature flourish.
  v2: `
  <defs>${TRI}
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f58a45"/><stop offset="1" stop-color="#d9542a"/></linearGradient>
    <pattern id="chev" width="56" height="56" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="56" height="56" fill="#23252b"/><rect width="26" height="56" fill="#f2b33d"/></pattern>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <rect x="34" y="34" width="444" height="444" rx="30" fill="none" stroke="#b8441f" stroke-width="10"/>
  <line x1="34" y1="190" x2="478" y2="190" stroke="#b8441f" stroke-width="7"/>
  ${[[60, 60], [452, 60], [60, 452], [452, 452], [60, 190], [452, 190]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="12" fill="#b8441f"/><circle cx="${x - 2}" cy="${y - 2}" r="7" fill="#ffd2b0"/>`).join("")}
  <rect x="34" y="400" width="444" height="52" fill="url(#chev)"/>
  <text x="72" y="152" font-family="DejaVu Sans Mono, monospace" font-weight="700" font-size="46" fill="#8f3417" opacity="0.75">WO-000001</text>
  ${brush("M84 330 C 150 250, 230 260, 262 300 S 360 350, 430 240", 58)}`,

  // 3. The applicator, trailing a glowing cryo spiral glyph.
  v3: `
  <defs>
    <radialGradient id="bg" cx="40%" cy="38%" r="80%"><stop offset="0" stop-color="#173063"/><stop offset="0.6" stop-color="#0a1633"/><stop offset="1" stop-color="#02040a"/></radialGradient>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="10" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  ${stars(26, 3)}
  <path d="${(() => { let d = ""; for (let i = 0; i <= 80; i++) { const t = i / 80, a = -1.2 + t * 1.5 * 2 * Math.PI, r = 150 * (1 - 0.8 * t); d += `${i ? "L" : "M"}${190 + Math.cos(a) * r} ${200 + Math.sin(a) * r} `; } return d; })()}"
        fill="none" stroke="#7cc8ee" stroke-width="22" stroke-linecap="round" filter="url(#glow)"/>
  <g transform="translate(300 300) rotate(-38)">
    <rect x="-40" y="10" width="62" height="140" rx="16" fill="#3b3f47"/>
    <rect x="-70" y="-40" width="230" height="70" rx="22" fill="#f6f3ec"/>
    <rect x="-70" y="-40" width="230" height="22" rx="11" fill="#ffffff"/>
    <rect x="20" y="-28" width="80" height="14" rx="7" fill="#ff9a3c"/>
    <rect x="-150" y="-18" width="86" height="26" rx="10" fill="#3b3f47"/>
    <circle cx="-158" cy="-5" r="18" fill="#bfeaff" filter="url(#glow)"/>
    <circle cx="-158" cy="-5" r="8" fill="#fff"/>
    ${["#7cc8ee", "#ff9a3c", "#a672ff"].map((c, i) => `<rect x="${60 + i * 30}" y="-78" width="22" height="46" rx="8" fill="${c}"/>`).join("")}
  </g>`,
};


/** The shipped app icon, as a full SVG document string. */
export const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%">${V.v1}</svg>`;
