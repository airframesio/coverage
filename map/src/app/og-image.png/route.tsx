import { ImageResponse } from "next/og";
import { coverageColorScale } from "@/lib/constants/colors";

// 1200x630 share card for Discord, Slack, X and the like (og:image and
// twitter:image in layout.tsx). A route handler so the static export writes it
// as out/og-image.png: an extensionless opengraph-image file would be served
// without an image type. Drawn once at build time; matches the Globe and Board
// cards (dark card, symbol tile and product badge in the site's color).
export const dynamic = "force-static";

const NIGHT = "#070b16";
const TEXT = "#eef2f9";
const MUTED = "#a3adc2";
const DIM = "#5f6b85";
const YELLOW = "#FDE047";
const NAVY = "#031137";

const SYMBOL =
  "M157.054 190.557C164.645 156.345 194.972 132 230 132C265.028 132 295.355 156.345 302.947 190.557L324.236 286.504C328.619 306.261 313.592 325 293.363 325H272.018C254.553 325 240.394 310.835 240.394 293.361V243.356C248.353 246.662 269.986 255.639 271.334 256.156C272.836 256.722 273.852 256.344 274.444 255.934C274.907 255.614 275.679 254.851 275.679 253.35L275.662 252.964C275.598 252.209 275.37 249.846 275.167 248.024C274.924 245.793 273.754 244.849 273.015 244.258C272.528 243.856 246.168 222.983 240.394 218.413V187.734C240.394 178.487 232.956 174.574 230 174.574C227.044 174.574 219.606 178.487 219.606 187.734V218.413C214.465 222.482 187.464 243.865 186.879 244.349L186.876 244.351C186.242 244.86 185.076 245.796 184.833 248.024C184.63 249.846 184.402 252.201 184.338 252.964L184.321 253.35C184.321 254.843 185.101 255.614 185.564 255.934C186.148 256.353 187.172 256.722 188.666 256.156C190.014 255.639 211.647 246.662 219.606 243.356V293.361C219.606 310.835 205.447 325 187.982 325H166.637C146.408 325 131.381 306.261 135.764 286.504L157.054 190.557Z";

// A hex grid like the map's H3 mode: confidence falls off with distance from
// three receivers, so the card shows overlapping coverage the same way.
const R = 22; // hex radius
const W = Math.sqrt(3) * R;
const STATIONS = [
  { x: 150, y: 170, reach: 150 },
  { x: 300, y: 300, reach: 170 },
  { x: 170, y: 380, reach: 120 },
];

function hexes() {
  const out: { points: string; fill: string }[] = [];
  for (let row = 0; row < 14; row++) {
    for (let col = 0; col < 11; col++) {
      const cx = col * W + (row % 2 ? W / 2 : 0) + 20;
      const cy = row * R * 1.5 + 30;
      let score = 0;
      for (const s of STATIONS) {
        const d = Math.hypot(cx - s.x, cy - s.y);
        score += Math.max(0, 1 - d / s.reach);
      }
      score = Math.min(1, score);
      if (score <= 0.02) continue;
      const [r, g, b, a] = coverageColorScale(score);
      const pts = Array.from({ length: 6 }, (_, i) => {
        const ang = (Math.PI / 180) * (60 * i - 30);
        return `${(cx + (R - 1.5) * Math.cos(ang)).toFixed(1)},${(cy + (R - 1.5) * Math.sin(ang)).toFixed(1)}`;
      }).join(" ");
      out.push({ points: pts, fill: `rgba(${r},${g},${b},${(a / 255).toFixed(2)})` });
    }
  }
  return out;
}

export function GET() {
  const cells = hexes();
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: `radial-gradient(circle at 80% 45%, rgba(253,224,71,0.12) 0%, rgba(7,11,22,0) 55%), ${NIGHT}`,
          color: TEXT,
          fontFamily: "sans-serif",
          padding: "64px 0 56px 72px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 610 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
            <svg width="96" height="96" viewBox="70 70 320 320">
              <rect x="70" y="70" width="320" height="320" rx="67" fill={YELLOW} />
              <path d={SYMBOL} fill={NAVY} />
            </svg>
            <div style={{ fontSize: 58, fontWeight: 600, letterSpacing: -1 }}>Airframes</div>
            <div
              style={{
                display: "flex",
                padding: "4px 14px",
                borderRadius: 10,
                background: YELLOW,
                color: NIGHT,
                fontSize: 28,
                letterSpacing: 3,
              }}
            >
              COVERAGE
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ fontSize: 56, lineHeight: 1.1, letterSpacing: -1 }}>Where the network can hear, live</div>
            <div style={{ fontSize: 28, lineHeight: 1.35, color: MUTED }}>
              Live reception coverage of the Airframes feeder network, from every message heard.
            </div>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            {["ACARS", "VDL", "HFDL", "SATCOM", "AIS"].map((t) => (
              <div
                key={t}
                style={{
                  display: "flex",
                  padding: "6px 16px",
                  borderRadius: 10,
                  border: "1px solid #2a3550",
                  color: MUTED,
                  fontSize: 22,
                }}
              >
                {t}
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", position: "relative", width: 518, height: 510 }}>
          <svg width="470" height="500" viewBox="0 -30 470 500">
            {cells.map((c, i) => (
              <polygon key={i} points={c.points} fill={c.fill} stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
            ))}
            {STATIONS.map((s, i) => (
              <circle key={i} cx={s.x} cy={s.y} r="7" fill={TEXT} stroke={NIGHT} strokeWidth="3" />
            ))}
          </svg>
          <div style={{ position: "absolute", right: 72, top: 8, fontSize: 24, color: DIM, letterSpacing: 1 }}>
            coverage.airframes.io
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
