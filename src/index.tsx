import {
  ButtonItem,
  DropdownItem,
  Field,
  Focusable,
  PanelSection,
  PanelSectionRow,
  Router,
  SliderField,
  ToggleField,
  staticClasses,
} from "@decky/ui";
import {
  addEventListener,
  callable,
  definePlugin,
  removeEventListener,
  toaster,
} from "@decky/api";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  FaBatteryThreeQuarters,
  FaBell,
  FaBolt,
  FaChartArea,
  FaChevronDown,
  FaChevronRight,
  FaFan,
  FaMicrochip,
  FaPlug,
  FaRedo,
  FaShieldAlt,
  FaSlidersH,
  FaThermometerHalf,
  FaUserShield,
} from "react-icons/fa";
import { BsGpuCard } from "react-icons/bs";
import { registerQamTab } from "./qamTab";
import { CurveChart, HistoryChart, HOT, TempBar, tempColor, tempStatus, WARM } from "./charts";
import { ACCENT, Styles } from "./styles";
import { CpuControls, GPU_LABELS, PowerOptions, TdpGpuControls, type PowerProfile, type PowerSettings, type PowerState } from "./power";

type Sensors = {
  cpu_c: number | null;
  gpu_c: number | null;
  nvme_c: number | null;
  board_c: number | null;
  apu_w: number | null;
  gpu_busy: number | null;
  tdp_w: number | null;
  tdp_slow_w: number | null;
  tdp_fast_w: number | null;
  battery_pct: number | null;
  battery_status: string | null;
  battery_w: number | null;
  charge_limit: boolean;
  ac_online: boolean;
  charger_ma: number | null;
  charger_max_w_est: number | null;
  fan_rpm: number | null;
  control_temp: number | null;
  cpu_mhz: number | null;
};

type Settings = {
  enabled: boolean;
  preset: string;
  steps: number[];
  alert_enabled: boolean;
  alert_temp: number;
  protect_enabled: boolean;
  protect_temp: number;
  protect_interval_min: number;
  charge_limit: boolean;
} & PowerSettings;

type Stats = {
  seconds: number;
  temp_max: number | null;
  temp_avg: number | null;
  above_85_s: number;
  above_90_s: number;
  rpm_max: number | null;
  apu_w_max: number | null;
  throttle_events: number;
  protect_events: number;
};

type State = {
  ec_ok: boolean;
  driving: boolean;
  duty: number | null;
  error: string | null;
  guard_temp: number;
  step_temps: number[];
  presets: Record<string, number[]>;
  auto_mode: string;
  settings: Settings;
  sensors: Partial<Sensors>;
  stats: Stats;
  version: string;
  game: { appid: number | null; name: string | null };
  power: PowerState;
  protect: { cap: number | null; floor: number; step: number; emergency_temp: number };
};

type HistoryPoint = [number, number | null, number | null, number | null];

const getState = callable<[], State>("get_state");
const setRunningGame = callable<[appid: number | null, name: string | null], boolean>("set_running_game");
const onSuspend = callable<[], boolean>("on_suspend");
const onResume = callable<[], boolean>("on_resume");
const getHistory = callable<[], HistoryPoint[]>("get_history");
const resetStats = callable<[], boolean>("reset_stats");
const setEnabled = callable<[enabled: boolean], boolean>("set_enabled");
const setSteps = callable<[steps: number[]], boolean>("set_steps");
const applyPreset = callable<[name: string], boolean>("apply_preset");
const setAlert = callable<[enabled: boolean, temp: number], boolean>("set_alert");
const setProtect = callable<[enabled: boolean, temp: number, intervalMin: number], boolean>("set_protect");
const setChargeLimit = callable<[enabled: boolean], boolean>("set_charge_limit");

const NAME = "Legion of Fans";
const TAGLINE = "Too Hot To Handle";

const PRESET_LABELS: Record<string, string> = {
  silenziosa: "🤫 Silenziosa",
  bilanciata: "⚖️ Bilanciata",
  ottimale: "🎯 Ottimale",
  massima: "🚀 Massima",
  automatica: "🤖 Automatica",
  personalizzata: "🛠️ Personalizzata",
};
const PRESET_ORDER = ["silenziosa", "bilanciata", "ottimale", "massima", "automatica", "personalizzata"];

const fmt = (v: number | null | undefined, unit: string, digits = 0) =>
  v === null || v === undefined ? "—" : `${v.toFixed(digits)} ${unit}`;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function spinDuration(rpm: number | null | undefined) {
  if (!rpm || rpm <= 0) return undefined;
  return `${Math.max(0.3, Math.min(2, 2250 / rpm)).toFixed(2)}s`;
}

function adjustSteps(steps: number[], index: number, value: number): number[] {
  const out = [...steps];
  out[index] = value;
  for (let i = index + 1; i < out.length; i++) out[i] = Math.max(out[i], value);
  for (let i = index - 1; i >= 0; i--) out[i] = Math.min(out[i], value);
  out[out.length - 1] = 100;
  return out;
}

function activeStep(stepTemps: number[], temp: number | null | undefined) {
  if (temp == null) return -1;
  let idx = 0;
  stepTemps.forEach((t, i) => {
    if (temp >= t) idx = i;
  });
  return idx;
}

// ----- collapsible sections (open state survives closing the menu) -----------
const OPEN_KEY = "legion-of-fans:open";
const openSections: Record<string, boolean> = (() => {
  try {
    return JSON.parse(localStorage.getItem(OPEN_KEY) ?? "{}");
  } catch {
    return {};
  }
})();

function Section(props: { id: string; icon: ReactNode; title: string; hint?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(!!openSections[props.id]);
  const toggle = () => {
    const next = !open;
    openSections[props.id] = next;
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(openSections));
    } catch {
      /* not persisted, fine */
    }
    setOpen(next);
  };
  return (
    <>
      <PanelSectionRow>
        <Focusable className="lof-sec-head lof-sec" onActivate={toggle} onClick={toggle}>
          <span className="lof-sec-title">
            <span style={{ color: ACCENT, display: "inline-flex" }}>{props.icon}</span>
            {props.title}
          </span>
          <span className="lof-sec-hint">
            {props.hint}
            {open ? <FaChevronDown size={11} /> : <FaChevronRight size={11} />}
          </span>
        </Focusable>
      </PanelSectionRow>
      {open && <div className="lof-sec-body">{props.children}</div>}
    </>
  );
}

function Label({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="lof-label">
      {icon}
      {children}
    </span>
  );
}

function FanIcon({ rpm, size = 14 }: { rpm?: number | null; size?: number }) {
  const d = spinDuration(rpm);
  return (
    <span className={d ? "lof-spin" : undefined} style={d ? { animationDuration: d } : { display: "inline-flex" }}>
      <FaFan size={size} />
    </span>
  );
}

function BigTemp(props: { icon: ReactNode; label: string; temp: number | null | undefined; sub?: string }) {
  return (
    <div className="lof-metric">
      <span className="lof-metric-label">
        {props.icon}
        {props.label}
      </span>
      <span className="lof-metric-value" style={{ color: tempColor(props.temp) }}>
        {props.temp == null ? "—" : Math.round(props.temp)}
        <span className="lof-metric-unit">°C</span>
      </span>
      <TempBar temp={props.temp} />
      {props.sub && <span className="lof-mini-sub">{props.sub}</span>}
    </div>
  );
}

function Mini(props: { icon: ReactNode; label: string; value: ReactNode; sub?: ReactNode; color?: string }) {
  return (
    <div className="lof-mini">
      <div className="lof-mini-label">
        {props.icon}
        {props.label}
      </div>
      <div className="lof-mini-value" style={{ color: props.color }}>
        {props.value}
      </div>
      {props.sub && <div className="lof-mini-sub">{props.sub}</div>}
    </div>
  );
}

function runningGame(): { appid: number | null; name: string | null } {
  try {
    const app = Router.MainRunningApp;
    return app ? { appid: Number(app.appid), name: app.display_name ?? null } : { appid: null, name: null };
  } catch {
    return { appid: null, name: null };
  }
}

function Content() {
  const [state, setState] = useState<State | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const pendingSteps = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tick = useRef(0);

  const refresh = useCallback(async () => {
    try {
      setState(await getState());
      if (tick.current++ % 2 === 0) setHistory(await getHistory());
    } catch (e) {
      console.error("Legion of Fans: refresh failed", e);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 1000);
    return () => clearInterval(timer);
  }, [refresh]);

  const act = async (p: Promise<unknown>) => {
    await p;
    await refresh();
  };

  if (!state) {
    return (
      <div className="lof">
        <Styles />
        <PanelSection>
          <PanelSectionRow>
            <Field label="Accendo le ventole…" />
          </PanelSectionRow>
        </PanelSection>
      </div>
    );
  }

  const s = state.sensors;
  const cfg = state.settings;
  const st = state.stats;
  const isAuto = cfg.preset === state.auto_mode;
  const active = activeStep(state.step_temps, s.control_temp);
  const status = tempStatus(s.control_temp);
  const capped = state.protect.cap != null;
  const patchEdit = (field: keyof PowerProfile, value: unknown) =>
    setState((prev) =>
      prev ? { ...prev, power: { ...prev.power, edit_profile: { ...prev.power.edit_profile, [field]: value } } } : prev,
    );

  const onStep = (index: number, value: number) => {
    const steps = adjustSteps(cfg.steps, index, value);
    setState({ ...state, settings: { ...cfg, steps, preset: "personalizzata" } });
    if (pendingSteps.current) clearTimeout(pendingSteps.current);
    pendingSteps.current = setTimeout(() => act(setSteps(steps)), 400);
  };

  const batteryFlow =
    s.battery_w == null || s.battery_w === 0
      ? "ferma"
      : s.battery_w > 0
        ? `+${s.battery_w.toFixed(1)} W in carica`
        : `${s.battery_w.toFixed(1)} W in uso`;

  return (
    <div className="lof">
      <Styles />
      <PanelSection>
        {/* ---------- hero: status at a glance ---------- */}
        <PanelSectionRow>
          <div className="lof-card lof-hero">
            <div className="lof-hero-top">
              <span className="lof-status" style={{ color: status.color, background: `${status.color}22` }}>
                {status.text}
              </span>
              <span className="lof-chip">
                <FanIcon rpm={cfg.enabled ? s.fan_rpm : null} size={11} />
                {cfg.enabled ? (PRESET_LABELS[cfg.preset] ?? cfg.preset).replace(/^\S+\s/, "") : "Firmware"}
              </span>
            </div>
            <div className="lof-temps">
              <BigTemp
                icon={<FaMicrochip />}
                label="CPU"
                temp={s.cpu_c}
                sub={`${s.cpu_mhz != null ? `${(s.cpu_mhz / 1000).toFixed(2)} GHz` : ""}`}
              />
              <BigTemp icon={<BsGpuCard />} label="GPU" temp={s.gpu_c} />
            </div>
            <div className="lof-row3">
              <Mini
                icon={<FanIcon rpm={s.fan_rpm} size={10} />}
                label="Ventola"
                value={s.fan_rpm != null ? s.fan_rpm.toLocaleString("it-IT") : "—"}
                sub={state.driving && state.duty != null ? `RPM · ${state.duty} %` : "RPM"}
              />
              <Mini
                icon={<FaBolt size={10} />}
                label="APU"
                value={fmt(s.apu_w, "W", 1)}
                sub={capped ? `🛡️ max ${state.protect.cap} W` : `TDP ${fmt(s.tdp_w, "W")}${state.power?.scope && !state.power.scope.startsWith("default") ? " · gioco" : ""}`}
                color={capped ? WARM : undefined}
              />
              <Mini
                icon={<FaThermometerHalf size={10} />}
                label="Scheda"
                value={s.board_c == null ? "—" : `${Math.round(s.board_c)}°`}
                sub={`SSD ${s.nvme_c == null ? "—" : `${Math.round(s.nvme_c)}°`}`}
                color={tempColor(s.board_c)}
              />
            </div>
          </div>
        </PanelSectionRow>

        {/* ---------- 5-minute chart ---------- */}
        <PanelSectionRow>
          <div className="lof-card" style={{ marginTop: 8 }}>
            <div className="lof-metric-label" style={{ marginBottom: 6 }}>
              <FaChartArea /> Temperatura · ultimi 5 minuti
            </div>
            <HistoryChart points={history} alertTemp={cfg.alert_temp} guardTemp={state.guard_temp} />
            <div className="lof-legend">
              <span>
                <i style={{ borderColor: WARM }} />
                avviso {cfg.alert_temp}°
              </span>
              <span>
                <i style={{ borderColor: HOT }} />
                salvavita {state.guard_temp}°
              </span>
            </div>
          </div>
        </PanelSectionRow>

        {/* ---------- quick controls ---------- */}
        {!state.ec_ok && (
          <PanelSectionRow>
            <Field label="Controllo ventola non disponibile" description={state.error ?? ""} />
          </PanelSectionRow>
        )}
        <PanelSectionRow>
          <ToggleField
            label={<Label icon={<FanIcon rpm={cfg.enabled ? s.fan_rpm : null} />}>Comanda la ventola</Label>}
            description={cfg.enabled ? `Da ${state.guard_temp} °C sempre al 100 %` : "Spento: decide il firmware"}
            checked={cfg.enabled}
            disabled={!state.ec_ok}
            onChange={(v) => act(setEnabled(v))}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <DropdownItem
            label={<Label icon={<FaSlidersH />}>Profilo della ventola</Label>}
            layout="below"
            rgOptions={PRESET_ORDER.map((k) => ({ data: k, label: PRESET_LABELS[k] ?? k }))}
            selectedOption={cfg.preset}
            onChange={(o) => {
              if (o.data !== "personalizzata") act(applyPreset(o.data));
            }}
          />
        </PanelSectionRow>

        {/* ---------- collapsible sections ---------- */}
        <Section
          id="curve"
          icon={<FaFan />}
          title="Curva ventola"
          hint={state.driving && state.duty != null ? `${state.duty} %` : undefined}
        >
          <PanelSectionRow>
            <div className="lof-card">
              <CurveChart
                stepTemps={state.step_temps}
                steps={isAuto ? state.presets.ottimale : cfg.steps}
                temp={s.control_temp}
                duty={state.driving ? state.duty : null}
                auto={isAuto}
              />
              <div className="lof-note" style={{ marginTop: 6 }}>
                {isAuto
                  ? "🤖 Automatica: parte dalla curva Ottimale (tratteggiata) e accelera se la temperatura sale in fretta o c'è un gioco pesante; rallenta piano quando scende."
                  : `Adesso ${fmt(s.control_temp, "°C")} → ${state.driving && state.duty != null ? `${state.duty} %` : "firmware"}`}
              </div>
            </div>
          </PanelSectionRow>
          {!isAuto &&
            state.step_temps.map((t, i) => {
              const locked = i === state.step_temps.length - 1;
              const isActive = i === active && cfg.enabled;
              return (
                <PanelSectionRow key={t}>
                  <SliderField
                    label={
                      <Label icon={locked ? <FaShieldAlt /> : <FaThermometerHalf color={tempColor(t)} />}>
                        <span className={isActive ? "lof-active" : undefined}>
                          {isActive ? "▶ " : ""}
                          {`${t} °C → ${cfg.steps[i]} %`}
                        </span>
                      </Label>
                    }
                    value={cfg.steps[i]}
                    min={0}
                    max={100}
                    step={5}
                    disabled={locked}
                    description={locked ? "Salvavita: bloccato al 100 %" : isActive ? "Scaglione attivo adesso" : undefined}
                    onChange={(v) => onStep(i, v)}
                  />
                </PanelSectionRow>
              );
            })}
        </Section>

        <Section
          id="power"
          icon={<FaBolt />}
          title="TDP e GPU"
          hint={
            state.power?.profile
              ? `${state.power.applied_tdp ?? state.power.profile.tdp} W · ${(GPU_LABELS[state.power.profile.gpuMode] ?? "").replace(/^\S+\s/, "")}`
              : undefined
          }
        >
          {state.power && (
            <TdpGpuControls
              power={state.power}
              settings={cfg}
              gameName={state.game.name}
              capped={state.protect.cap}
              refresh={refresh}
              patchEdit={patchEdit}
              Label={Label}
            />
          )}
        </Section>

        <Section id="cpu" icon={<FaMicrochip />} title="CPU avanzate" hint={state.power ? (state.power.cpu.smt ? "SMT on" : "SMT off") : undefined}>
          {state.power && (
            <CpuControls power={state.power} settings={cfg} refresh={refresh} patchEdit={patchEdit} Label={Label} />
          )}
        </Section>

        <Section id="poweropts" icon={<FaSlidersH />} title="Opzioni TDP" hint={`max ${cfg.max_tdp} W`}>
          {state.power && <PowerOptions power={state.power} settings={cfg} refresh={refresh} />}
        </Section>


        <Section
          id="protect"
          icon={<FaUserShield />}
          title="Protezione automatica"
          hint={capped ? <span style={{ color: WARM }}>{state.protect.cap} W</span> : cfg.protect_enabled ? "attiva" : "spenta"}
        >
          <PanelSectionRow>
            <ToggleField
              label="Abbassa il TDP se scalda"
              description={`−${state.protect.step} W ogni ${cfg.protect_interval_min} min sopra la soglia (minimo ${state.protect.floor} W), +${state.protect.step} W dopo ${cfg.protect_interval_min} min al fresco. Da ${state.protect.emergency_temp} °C interviene subito.`}
              checked={cfg.protect_enabled}
              onChange={(v) => act(setProtect(v, cfg.protect_temp, cfg.protect_interval_min))}
            />
          </PanelSectionRow>
          <PanelSectionRow>
            <SliderField
              label={`Soglia: ${cfg.protect_temp} °C`}
              value={cfg.protect_temp}
              min={75}
              max={90}
              step={1}
              disabled={!cfg.protect_enabled}
              onChange={(v) => act(setProtect(cfg.protect_enabled, v, cfg.protect_interval_min))}
            />
          </PanelSectionRow>
          <PanelSectionRow>
            <SliderField
              label={`Intervallo: ${cfg.protect_interval_min} min`}
              value={cfg.protect_interval_min}
              min={3}
              max={15}
              step={1}
              disabled={!cfg.protect_enabled}
              onChange={(v) => act(setProtect(cfg.protect_enabled, cfg.protect_temp, v))}
            />
          </PanelSectionRow>
          {capped && (
            <PanelSectionRow>
              <div className="lof-note" style={{ color: WARM }}>
                🛡️ In corso: TDP limitato a {state.protect.cap} W finché la Legion Go non si raffredda.
              </div>
            </PanelSectionRow>
          )}
        </Section>

        <Section
          id="alert"
          icon={<FaBell />}
          title="Avviso temperatura"
          hint={cfg.alert_enabled ? `${cfg.alert_temp}°` : "spento"}
        >
          <PanelSectionRow>
            <ToggleField
              label="Avvisami se scalda"
              description="Notifica se resta sopra la soglia per 10 secondi (al massimo ogni 2 minuti)"
              checked={cfg.alert_enabled}
              onChange={(v) => act(setAlert(v, cfg.alert_temp))}
            />
          </PanelSectionRow>
          <PanelSectionRow>
            <SliderField
              label={`Soglia: ${cfg.alert_temp} °C`}
              value={cfg.alert_temp}
              min={70}
              max={95}
              step={1}
              disabled={!cfg.alert_enabled}
              onChange={(v) => act(setAlert(cfg.alert_enabled, v))}
            />
          </PanelSectionRow>
        </Section>

        <Section
          id="stats"
          icon={<FaChartArea />}
          title="Statistiche sessione"
          hint={st.temp_max != null ? <span style={{ color: tempColor(st.temp_max) }}>max {Math.round(st.temp_max)}°</span> : undefined}
        >
          <PanelSectionRow>
            <div className="lof-card">
              <div className="lof-kv">
                <span>Durata</span>
                <span>{mmss(st.seconds)}</span>
                <span>Temperatura max</span>
                <span style={{ color: tempColor(st.temp_max) }}>{fmt(st.temp_max, "°C")}</span>
                <span>Temperatura media</span>
                <span>{fmt(st.temp_avg, "°C")}</span>
                <span>Sopra 85 °C</span>
                <span>{mmss(st.above_85_s)}</span>
                <span>Sopra 90 °C</span>
                <span style={{ color: st.above_90_s ? HOT : undefined }}>{mmss(st.above_90_s)}</span>
                <span>Ventola max</span>
                <span>{st.rpm_max != null ? `${st.rpm_max.toLocaleString("it-IT")} RPM` : "—"}</span>
                <span>Potenza APU max</span>
                <span>{fmt(st.apu_w_max, "W", 1)}</span>
                <span>Tagli del firmware</span>
                <span style={{ color: st.throttle_events ? WARM : undefined }}>
                  {st.throttle_events ? `⚠️ ${st.throttle_events}` : "nessuno"}
                </span>
                <span>Interventi protezione</span>
                <span>{st.protect_events || "nessuno"}</span>
              </div>
            </div>
          </PanelSectionRow>
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={() => act(resetStats())}>
              <Label icon={<FaRedo />}>Azzera statistiche</Label>
            </ButtonItem>
          </PanelSectionRow>
        </Section>

        <Section
          id="power"
          icon={s.ac_online ? <FaPlug /> : <FaBatteryThreeQuarters />}
          title="Alimentazione"
          hint={fmt(s.battery_pct, "%")}
        >
          <PanelSectionRow>
            <div className="lof-card">
              <div className="lof-kv">
                <span>Caricatore</span>
                <span>
                  {s.ac_online ? (s.charger_max_w_est ? `fino a ~${s.charger_max_w_est} W` : "collegato") : "scollegato"}
                </span>
                <span>Batteria</span>
                <span>
                  {fmt(s.battery_pct, "%")} · {batteryFlow}
                </span>
              </div>
              <div className="lof-note" style={{ marginTop: 6 }}>
                Il sistema non espone i watt reali in ingresso: la potenza del caricatore è stimata dalla corrente
                USB‑PD a 20 V.
              </div>
            </div>
          </PanelSectionRow>
          <PanelSectionRow>
            <ToggleField
              label={<Label icon={<FaBatteryThreeQuarters />}>Limite di carica 80 %</Label>}
              description="Protegge la batteria se giochi sempre col caricatore"
              checked={cfg.charge_limit}
              onChange={(v) => act(setChargeLimit(v))}
            />
          </PanelSectionRow>
        </Section>

        <PanelSectionRow>
          <div className="lof-note" style={{ textAlign: "center", marginTop: 10, color: "rgba(255,255,255,0.35)" }}>
            {NAME} v{state.version} · <i>{TAGLINE}</i>
          </div>
        </PanelSectionRow>
      </PanelSection>
    </div>
  );
}

function TabTitle() {
  return (
    <div className={staticClasses.Title} style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ color: ACCENT, display: "inline-flex" }}>
        <FaFan />
      </span>
      {NAME}
    </div>
  );
}

export default definePlugin(() => {
  const alertListener = addEventListener<[temp: number]>("temp_alert", (temp) => {
    toaster.toast({
      title: "🔥 Too Hot To Handle",
      body: `La Legion Go è a ${Math.round(temp)} °C da oltre 10 secondi. Valuta di abbassare il TDP.`,
      icon: <FaFan />,
    });
  });
  const protectListener = addEventListener<[kind: string, cap: number | null, temp: number | null]>(
    "protect_event",
    (kind, cap, temp) => {
      if (kind === "down") return;
      toaster.toast({
        title: kind === "on" ? "🛡️ Protezione attivata" : "✅ Protezione terminata",
        body:
          kind === "on"
            ? `${Math.round(temp ?? 0)} °C: TDP limitato a ${cap} W finché la Legion Go non si raffredda.`
            : "Temperatura tornata normale: TDP ripristinato.",
        icon: <FaUserShield />,
      });
    },
  );

  // Follow the running game even while the menu is closed (per-game profiles).
  // Steam sometimes reports "no game" for a few seconds while one is running:
  // a game counts as closed only after 5 polls (10 s) without it.
  let lastGame: string | null = null;
  let missing = 0;
  const gameTimer = setInterval(() => {
    const g = runningGame();
    if (g.appid == null && lastGame !== null && lastGame !== "null" && ++missing < 5) return;
    missing = 0;
    const key = `${g.appid}`;
    if (key !== lastGame) {
      lastGame = key;
      setRunningGame(g.appid, g.name).catch((e) => console.error("Legion of Fans: set_running_game", e));
    }
  }, 2000);
  // Suspend / resume hooks (the backend also detects resume on its own).
  const unregs: (() => void)[] = [];
  try {
    const sys = (window as unknown as { SteamClient?: { System?: Record<string, (cb: () => void) => { unregister: () => void }> } })
      .SteamClient?.System;
    const s1 = sys?.RegisterForOnSuspendRequest?.(() => void onSuspend());
    const s2 = sys?.RegisterForOnResumeFromSuspend?.(() => void onResume());
    if (s1) unregs.push(() => s1.unregister());
    if (s2) unregs.push(() => s2.unregister());
  } catch (e) {
    console.warn("Legion of Fans: suspend hooks unavailable", e);
  }

  const removeTab = registerQamTab({
    title: <TabTitle />,
    content: (
      <div style={{ paddingBottom: 24 }}>
        <Content />
      </div>
    ),
    icon: <FaFan size={20} />,
  });

  return {
    name: NAME,
    titleView: <TabTitle />,
    content: <Content />,
    icon: <FaFan />,
    onDismount() {
      removeEventListener("temp_alert", alertListener);
      removeEventListener("protect_event", protectListener);
      removeTab();
      clearInterval(gameTimer);
      unregs.forEach((u) => u());
    },
  };
});
