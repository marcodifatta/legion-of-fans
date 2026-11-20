// The Quick Access Menu is its own window/document, so a <style> injected into the
// main Steam document never reaches it. Render the stylesheet inside our content
// instead: it then lives in whichever document the panel is shown in.

export const ACCENT = "#5ec8ff"; // ice blue
export const ACCENT_SOFT = "rgba(94, 200, 255, 0.16)";
export const TEXT_DIM = "rgba(255, 255, 255, 0.62)";
export const TEXT_FAINT = "rgba(255, 255, 255, 0.42)";
export const CARD_BG = "rgba(255, 255, 255, 0.045)";
export const CARD_BORDER = "rgba(255, 255, 255, 0.08)";

const CSS = `
.lof { --accent: ${ACCENT}; --accent-soft: ${ACCENT_SOFT}; color: #fff; }
@keyframes lof-spin { to { transform: rotate(360deg); } }
.lof-spin { display: inline-flex; animation: lof-spin linear infinite; }

.lof-card { background: ${CARD_BG}; border: 1px solid ${CARD_BORDER}; border-radius: 10px; padding: 10px 12px; box-sizing: border-box; width: 100%; }
.lof-hero { display: flex; flex-direction: column; gap: 10px; }
.lof-hero-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.lof-status { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; padding: 3px 10px; border-radius: 999px; }
.lof-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--accent); background: var(--accent-soft); padding: 3px 10px; border-radius: 999px; font-weight: 600; }

.lof-temps { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.lof-metric { display: flex; flex-direction: column; gap: 2px; }
.lof-metric-label { display: flex; align-items: center; gap: 6px; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: ${TEXT_DIM}; }
.lof-metric-value { font-size: 30px; font-weight: 700; line-height: 1.05; font-variant-numeric: tabular-nums; }
.lof-metric-unit { font-size: 15px; font-weight: 600; color: ${TEXT_DIM}; margin-left: 2px; }
.lof-bar { height: 5px; width: 100%; background: rgba(255,255,255,0.09); border-radius: 3px; overflow: hidden; margin-top: 4px; }
.lof-bar > div { height: 100%; border-radius: 3px; transition: width .6s ease; }

.lof-row3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
.lof-mini { background: rgba(255,255,255,0.035); border-radius: 8px; padding: 6px 8px; }
.lof-mini-label { display: flex; align-items: center; gap: 5px; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: ${TEXT_DIM}; }
.lof-mini-value { font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; margin-top: 2px; }
.lof-mini-sub { font-size: 10px; color: ${TEXT_FAINT}; }

.lof-sec { margin-top: 8px; }
.lof-sec-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-radius: 10px; background: ${CARD_BG}; border: 1px solid ${CARD_BORDER}; font-size: 14px; font-weight: 600; }
.lof-sec-head.gpfocus, .lof-sec-head:hover { background: var(--accent-soft); border-color: var(--accent); }
.lof-sec-title { display: flex; align-items: center; gap: 8px; }
.lof-sec-hint { font-size: 12px; color: ${TEXT_DIM}; font-weight: 500; display: flex; align-items: center; gap: 6px; }
.lof-sec-body { padding: 6px 2px 2px; }

.lof-kv { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 12px; font-size: 13px; width: 100%; }
.lof-kv > :nth-child(odd) { color: ${TEXT_DIM}; }
.lof-kv > :nth-child(even) { text-align: right; white-space: nowrap; font-weight: 600; font-variant-numeric: tabular-nums; }
.lof-note { font-size: 12px; color: ${TEXT_DIM}; line-height: 1.4; }
.lof-label { display: inline-flex; align-items: center; gap: 8px; }
.lof-active { color: var(--accent); font-weight: 700; }
.lof-legend { display: flex; gap: 12px; font-size: 11px; color: ${TEXT_DIM}; margin-top: 4px; }
.lof-legend i { display: inline-block; width: 14px; height: 0; border-top: 2px dashed; vertical-align: middle; margin-right: 4px; }
`;

export function Styles() {
  return <style>{CSS}</style>;
}
