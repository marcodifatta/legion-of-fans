// Inline-SVG charts. Every colour is set explicitly (SVG text defaults to black,
// invisible on Steam's dark background).
import { ACCENT, TEXT_DIM, TEXT_FAINT } from "./styles";

export const HOT = "#ff5a5a";
export const WARM = "#ffa64d";
export const MILD = "#ffd95e";
export const OK = "#6ee7a0";

export function tempColor(t: number | null | undefined): string | undefined {
  if (t === null || t === undefined) return undefined;
  if (t >= 88) return HOT;
  if (t >= 80) return WARM;
  if (t >= 70) return MILD;
  return OK;
}

/** Status text + emoji so the state never depends on colour alone. */
export function tempStatus(t: number | null | undefined): { text: string; color: string } {
  if (t === null || t === undefined) return { text: "In attesa", color: TEXT_DIM };
  if (t >= 88) return { text: "🔥 Critica", color: HOT };
  if (t >= 80) return { text: "⚠️ Calda", color: WARM };
  if (t >= 70) return { text: "🙂 Tiepida", color: MILD };
  return { text: "✅ Fresca", color: OK };
}

export function TempBar({ temp }: { temp: number | null | undefined }) {
  const pct = temp == null ? 0 : Math.max(0, Math.min(100, ((temp - 30) / 70) * 100));
  return (
    <div className="lof-bar">
      <div style={{ width: `${pct}%`, background: tempColor(temp) }} />
    </div>
  );
}

const W = 300;
const LEFT = 34; // room for the axis labels ("100%")

/** Last 5 minutes of temperature, with labelled thresholds. */
export function HistoryChart(props: {
  points: [number, number | null, number | null, number | null][];
  alertTemp: number;
  guardTemp: number;
}) {
  const H = 110;
  const top = 6;
  const tMin = 30;
  const tMax = 100;
  const span = 300;
  const plotW = W - LEFT;
  const x = (ago: number) => LEFT + plotW - (Math.min(ago, span) / span) * plotW;
  const y = (t: number) => top + (H - top) - ((Math.max(tMin, Math.min(tMax, t)) - tMin) / (tMax - tMin)) * (H - top);
  const pts = props.points.filter((p) => p[1] != null) as [number, number, number | null, number | null][];
  const line = pts.map((p) => `${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(" ");
  const area = pts.length ? `${x(pts[0][0]).toFixed(1)},${H} ${line} ${x(pts[pts.length - 1][0]).toFixed(1)},${H}` : "";
  const last = pts[pts.length - 1];
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H + 16}`} style={{ display: "block" }}>
      <defs>
        <linearGradient id="lof-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={ACCENT} stopOpacity={0.35} />
          <stop offset="100%" stopColor={ACCENT} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      {[40, 60, 80, 100].map((t) => (
        <g key={t}>
          <line x1={LEFT} x2={W} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.07)" />
          <text x={LEFT - 4} y={y(t) + 3.5} textAnchor="end" fontSize={10} fill={TEXT_FAINT}>{t}°</text>
        </g>
      ))}
      <line x1={LEFT} x2={W} y1={y(props.alertTemp)} y2={y(props.alertTemp)} stroke={WARM} strokeDasharray="5 4" strokeWidth={1.2} />
      <line x1={LEFT} x2={W} y1={y(props.guardTemp)} y2={y(props.guardTemp)} stroke={HOT} strokeDasharray="2 3" strokeWidth={1.2} />
      {area && <polygon points={area} fill="url(#lof-area)" />}
      {line && <polyline points={line} fill="none" stroke={ACCENT} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />}
      {last && (
        <>
          <circle cx={x(last[0])} cy={y(last[1])} r={4.5} fill={tempColor(last[1])} stroke="#0e141b" strokeWidth={1.5} />
        </>
      )}
      <text x={LEFT} y={H + 13} fontSize={10} fill={TEXT_FAINT}>−5 min</text>
      <text x={LEFT + plotW / 2} y={H + 13} fontSize={10} fill={TEXT_FAINT} textAnchor="middle">−2:30</text>
      <text x={W} y={H + 13} fontSize={10} fill={TEXT_FAINT} textAnchor="end">ora</text>
      {!pts.length && (
        <text x={LEFT + plotW / 2} y={H / 2} fontSize={12} fill={TEXT_DIM} textAnchor="middle">Raccolgo i dati…</text>
      )}
    </svg>
  );
}

/** The fan curve with a marker on where the fan is right now. */
export function CurveChart(props: {
  stepTemps: number[];
  steps: number[];
  temp: number | null | undefined;
  duty: number | null | undefined;
  auto: boolean;
}) {
  const H = 90;
  const top = 6;
  const tMin = 35;
  const tMax = 95;
  const plotW = W - LEFT;
  const x = (t: number) => LEFT + ((Math.max(tMin, Math.min(tMax, t)) - tMin) / (tMax - tMin)) * plotW;
  const y = (d: number) => top + (H - top) - (d / 100) * (H - top);
  const line = [
    `${x(tMin)},${y(props.steps[0])}`,
    ...props.stepTemps.map((t, i) => `${x(t).toFixed(1)},${y(props.steps[i]).toFixed(1)}`),
    `${x(tMax)},${y(100)}`,
  ].join(" ");
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H + 16}`} style={{ display: "block" }}>
      {[0, 50, 100].map((d) => (
        <g key={d}>
          <line x1={LEFT} x2={W} y1={y(d)} y2={y(d)} stroke="rgba(255,255,255,0.07)" />
          <text x={LEFT - 4} y={y(d) + 3.5} textAnchor="end" fontSize={10} fill={TEXT_FAINT}>{d}%</text>
        </g>
      ))}
      <polyline
        points={line}
        fill="none"
        stroke={ACCENT}
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeDasharray={props.auto ? "6 5" : undefined}
        strokeOpacity={props.auto ? 0.55 : 1}
      />
      {props.stepTemps.map((t, i) => (
        <circle key={t} cx={x(t)} cy={y(props.steps[i])} r={3} fill={ACCENT} />
      ))}
      {props.temp != null && props.duty != null && (
        <>
          <line x1={x(props.temp)} x2={x(props.temp)} y1={top} y2={H} stroke={tempColor(props.temp)} strokeOpacity={0.55} strokeDasharray="3 3" />
          <circle cx={x(props.temp)} cy={y(props.duty)} r={5.5} fill={tempColor(props.temp)} stroke="#0e141b" strokeWidth={2} />
        </>
      )}
      {props.stepTemps.map((t) => (
        <text key={t} x={x(t)} y={H + 13} textAnchor="middle" fontSize={10} fill={TEXT_FAINT}>{t}°</text>
      ))}
    </svg>
  );
}
