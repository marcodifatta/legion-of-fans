// "TDP e GPU", "CPU avanzate" and "Opzioni TDP" sections: the SimpleDeckyTDP
// features, specialised for the Legion Go.
import { ButtonItem, DropdownItem, PanelSectionRow, SliderField, ToggleField } from "@decky/ui";
import { callable } from "@decky/api";
import { useRef, type ReactElement, type ReactNode } from "react";
import { FaBolt, FaMicrochip, FaRedo, FaSlidersH } from "react-icons/fa";
import { BsGpuCard } from "react-icons/bs";
import { WARM } from "./charts";

export type PowerProfile = {
  tdp: number;
  gpuMode: string;
  minGpuFrequency: number;
  maxGpuFrequency: number;
  fixedGpuFrequency: number;
  smt: boolean;
  cpuBoost: boolean;
  powerGovernor: string;
  epp: string;
};

export type PowerState = {
  scope: string;
  edit_scope: string;
  has_game_profile: boolean;
  profile: PowerProfile;
  edit_profile: PowerProfile;
  applied_tdp: number | null;
  boosting: boolean;
  rails: Record<string, number | null>;
  tdp_min: number;
  gpu_level: string | null;
  gpu_range: [number, number];
  gpu_modes: string[];
  cpu: {
    governors: string[];
    epps: string[];
    smt_supported: boolean;
    boost_supported: boolean;
    smt: boolean;
    cpuBoost: boolean;
    powerGovernor: string | null;
    epp: string | null;
  };
  corrections: number;
  profile_count: number;
};

export type PowerSettings = {
  tdp_enabled: boolean;
  gpu_enabled: boolean;
  cpu_enabled: boolean;
  per_game: boolean;
  ac_profiles: boolean;
  max_tdp: number;
  smart_check: boolean;
  max_tdp_on_resume: boolean;
  skip_tdp_on_resume: boolean;
  suspend_actions: boolean;
  max_tdp_on_game_change_s: number;
};

const setProfileValue = callable<[field: string, value: unknown], boolean>("set_profile_value");
const resetGameProfile = callable<[], boolean>("reset_game_profile");
const setPowerOption = callable<[name: string, value: unknown], boolean>("set_power_option");

export const GPU_LABELS: Record<string, string> = {
  BATTERY: "🔋 Batteria",
  BALANCE: "⚖️ Bilanciata",
  RANGE: "↔️ Intervallo",
  FIXED: "📌 Fissa",
};
const GPU_HELP: Record<string, string> = {
  BATTERY: "GPU alla frequenza minima: consuma e scalda meno",
  BALANCE: "La GPU decide da sola la frequenza (consigliata)",
  RANGE: "La GPU resta tra una frequenza minima e una massima",
  FIXED: "La GPU resta sempre alla stessa frequenza",
};

export function scopeLabel(scope: string, gameName: string | null) {
  if (scope === "default") return "Predefinito";
  if (scope === "default-ac-power") return "Predefinito con caricatore";
  return gameName ? `Profilo di ${gameName}` : "Profilo del gioco";
}

function useDebounced() {
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  return (key: string, fn: () => void, ms = 350) => {
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(fn, ms);
  };
}

type Props = {
  power: PowerState;
  settings: PowerSettings;
  gameName: string | null;
  capped: number | null;
  refresh: () => Promise<void>;
  /** optimistic local update while a slider moves */
  patchEdit: (field: keyof PowerProfile, value: unknown) => void;
  Label: (p: { icon: ReactNode; children: ReactNode }) => ReactElement;
};

export function TdpGpuControls({ power, settings, gameName, capped, refresh, patchEdit, Label }: Props) {
  const debounce = useDebounced();
  const p = power.edit_profile;
  const [gmin, gmax] = power.gpu_range;
  const editingGame = power.edit_scope !== "default" && power.edit_scope !== "default-ac-power";
  const save = (field: keyof PowerProfile, value: unknown, slider = false) => {
    patchEdit(field, value);
    const run = async () => {
      await setProfileValue(field, value);
      await refresh();
    };
    if (slider) debounce(field, run);
    else run();
  };

  return (
    <>
      <PanelSectionRow>
        <div className="lof-card">
          <div className="lof-kv">
            <span>Profilo in uso</span>
            <span>{scopeLabel(power.scope, gameName)}</span>
            <span>Modifiche salvate in</span>
            <span>{editingGame ? "questo gioco" : scopeLabel(power.edit_scope, null)}</span>
            <span>TDP applicato</span>
            <span>
              {["ppt_pl1_spl", "ppt_pl2_sppt", "ppt_pl3_fppt"]
                .map((r) => power.rails[r] ?? "—")
                .join("/")}{" "}
              W
            </span>
            <span>GPU</span>
            <span>{power.gpu_level ?? "—"}</span>
          </div>
          {(capped != null || power.boosting) && (
            <div className="lof-note" style={{ marginTop: 6, color: WARM }}>
              {capped != null
                ? `🛡️ Protezione attiva: TDP limitato a ${capped} W`
                : "⚡ TDP massimo temporaneo (avvio gioco / risveglio)"}
            </div>
          )}
        </div>
      </PanelSectionRow>

      {!settings.tdp_enabled && !settings.gpu_enabled ? (
        <PanelSectionRow>
          <div className="lof-note">Controllo di TDP e GPU spento: attivalo in "Opzioni TDP".</div>
        </PanelSectionRow>
      ) : null}

      {settings.tdp_enabled && (
        <PanelSectionRow>
          <SliderField
            label={<Label icon={<FaBolt />}>{`TDP: ${p.tdp} W`}</Label>}
            value={p.tdp}
            min={power.tdp_min}
            max={settings.max_tdp}
            step={1}
            description={`${editingGame ? "Salvato per questo gioco" : "Salvato nel profilo predefinito"} · da ${power.tdp_min} a ${settings.max_tdp} W`}
            onChange={(v) => save("tdp", v, true)}
          />
        </PanelSectionRow>
      )}

      {settings.gpu_enabled && (
        <>
          <PanelSectionRow>
            <DropdownItem
              label={<Label icon={<BsGpuCard />}>Modalità GPU</Label>}
              layout="below"
              description={GPU_HELP[p.gpuMode]}
              rgOptions={power.gpu_modes.map((m) => ({ data: m, label: GPU_LABELS[m] ?? m }))}
              selectedOption={p.gpuMode}
              onChange={(o) => save("gpuMode", o.data)}
            />
          </PanelSectionRow>
          {p.gpuMode === "RANGE" && (
            <>
              <PanelSectionRow>
                <SliderField
                  label={`Frequenza minima: ${p.minGpuFrequency} MHz`}
                  value={p.minGpuFrequency}
                  min={gmin}
                  max={gmax}
                  step={50}
                  onChange={(v) => save("minGpuFrequency", v, true)}
                />
              </PanelSectionRow>
              <PanelSectionRow>
                <SliderField
                  label={`Frequenza massima: ${p.maxGpuFrequency} MHz`}
                  value={p.maxGpuFrequency}
                  min={gmin}
                  max={gmax}
                  step={50}
                  onChange={(v) => save("maxGpuFrequency", v, true)}
                />
              </PanelSectionRow>
            </>
          )}
          {p.gpuMode === "FIXED" && (
            <PanelSectionRow>
              <SliderField
                label={`Frequenza fissa: ${p.fixedGpuFrequency} MHz`}
                value={p.fixedGpuFrequency}
                min={gmin}
                max={gmax}
                step={50}
                onChange={(v) => save("fixedGpuFrequency", v, true)}
              />
            </PanelSectionRow>
          )}
        </>
      )}

      {power.has_game_profile && (
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            onClick={async () => {
              await resetGameProfile();
              await refresh();
            }}
          >
            <Label icon={<FaRedo />}>Usa il predefinito per questo gioco</Label>
          </ButtonItem>
        </PanelSectionRow>
      )}
    </>
  );
}

export function CpuControls({ power, settings, refresh, patchEdit, Label }: Omit<Props, "gameName" | "capped">) {
  const p = power.edit_profile;
  const cpu = power.cpu;
  const save = async (field: keyof PowerProfile, value: unknown) => {
    patchEdit(field, value);
    await setProfileValue(field, value);
    await refresh();
  };
  if (!settings.cpu_enabled) {
    return (
      <PanelSectionRow>
        <div className="lof-note">Controllo CPU spento: attivalo in "Opzioni TDP".</div>
      </PanelSectionRow>
    );
  }
  return (
    <>
      {cpu.smt_supported && (
        <PanelSectionRow>
          <ToggleField
            label={<Label icon={<FaMicrochip />}>SMT (16 thread)</Label>}
            description="Spento: 8 thread, a volte meno consumi nei giochi che non li usano"
            checked={p.smt}
            onChange={(v) => save("smt", v)}
          />
        </PanelSectionRow>
      )}
      {cpu.boost_supported && (
        <PanelSectionRow>
          <ToggleField
            label="Boost della CPU"
            description="Spento: frequenza CPU più bassa, meno calore"
            checked={p.cpuBoost}
            onChange={(v) => save("cpuBoost", v)}
          />
        </PanelSectionRow>
      )}
      {cpu.governors.length > 0 && (
        <PanelSectionRow>
          <DropdownItem
            label={<Label icon={<FaSlidersH />}>Governor</Label>}
            layout="below"
            rgOptions={cpu.governors.map((g) => ({ data: g, label: g }))}
            selectedOption={p.powerGovernor}
            onChange={(o) => save("powerGovernor", o.data)}
          />
        </PanelSectionRow>
      )}
      {cpu.epps.length > 0 && (
        <PanelSectionRow>
          <DropdownItem
            label="EPP (preferenza energetica)"
            layout="below"
            description={
              p.powerGovernor === "performance"
                ? "Con il governor performance il sistema usa sempre EPP performance"
                : undefined
            }
            disabled={p.powerGovernor === "performance"}
            rgOptions={cpu.epps.map((e) => ({ data: e, label: e }))}
            selectedOption={p.epp}
            onChange={(o) => save("epp", o.data)}
          />
        </PanelSectionRow>
      )}
    </>
  );
}

export function PowerOptions({ power, settings, refresh }: Pick<Props, "power" | "settings" | "refresh">) {
  const set = async (name: keyof PowerSettings, value: unknown) => {
    await setPowerOption(name, value);
    await refresh();
  };
  const toggle = (name: keyof PowerSettings, label: string, description?: string) => (
    <PanelSectionRow>
      <ToggleField label={label} description={description} checked={!!settings[name]} onChange={(v) => set(name, v)} />
    </PanelSectionRow>
  );
  return (
    <>
      {toggle("tdp_enabled", "Controlla il TDP")}
      {toggle("gpu_enabled", "Controlla la GPU")}
      {toggle("cpu_enabled", "Controlla la CPU", "SMT, boost, governor ed EPP")}
      {toggle("per_game", "Profili per gioco", `Le modifiche fatte in gioco si salvano per quel gioco · ${power.profile_count} profili`)}
      {toggle("ac_profiles", "Profilo predefinito con caricatore", "Un predefinito separato quando il caricatore è collegato")}
      <PanelSectionRow>
        <SliderField
          label={`TDP massimo dello slider: ${settings.max_tdp} W`}
          value={settings.max_tdp}
          min={15}
          max={40}
          step={1}
          description="Il firmware limita comunque il sostenuto a 30 W e il breve a 35 W"
          onChange={(v) => set("max_tdp", v)}
        />
      </PanelSectionRow>
      {toggle("smart_check", "Controllo intelligente", `Ogni 5 s verifica TDP e GPU e li riapplica solo se cambiati · ${power.corrections} correzioni`)}
      <PanelSectionRow>
        <SliderField
          label={`TDP massimo all'avvio di un gioco: ${settings.max_tdp_on_game_change_s ? `${settings.max_tdp_on_game_change_s} s` : "spento"}`}
          value={settings.max_tdp_on_game_change_s}
          min={0}
          max={60}
          step={5}
          description="Aiuta i caricamenti iniziali, poi torna al profilo"
          onChange={(v) => set("max_tdp_on_game_change_s", v)}
        />
      </PanelSectionRow>
      {toggle("max_tdp_on_resume", "TDP massimo al risveglio", "Per 15 s dopo la sospensione, poi torna al profilo")}
      {toggle("skip_tdp_on_resume", "Non toccare il TDP al risveglio", "Lascia il valore del firmware dopo la sospensione")}
      {toggle("suspend_actions", "Riattiva SMT prima della sospensione", "Come SimpleDeckyTDP, evita problemi al risveglio")}
    </>
  );
}
