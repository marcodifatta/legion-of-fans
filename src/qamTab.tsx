// Registers a dedicated tab in Steam's Quick Access Menu tab bar (the icons above
// the notifications), next to Decky's own tab. Uses Decky Loader's tabs hook,
// which is not a public API: every step is guarded, and if anything looks off we
// simply don't register (the plugin stays reachable from the Decky plugin list).
import type { ReactNode } from "react";

const DECKY_TAB_ID = 999; // Decky Loader's own QAM tab
export const LOF_TAB_ID = 0x4c4f46; // "LOF"

type Tab = { id: number; title: ReactNode; content: ReactNode; icon: ReactNode };
type TabsHook = {
  tabs: Tab[];
  add: (tab: Tab) => void;
  removeById: (id: number) => void;
};

function tabsHook(): TabsHook | null {
  const hook = (window as unknown as { __TABS_HOOK_INSTANCE?: TabsHook }).__TABS_HOOK_INSTANCE;
  if (
    !hook ||
    !Array.isArray(hook.tabs) ||
    typeof hook.add !== "function" ||
    typeof hook.removeById !== "function" ||
    !hook.tabs.some((t) => t?.id === DECKY_TAB_ID)
  ) {
    return null;
  }
  return hook;
}

/** Adds the tab; returns a cleanup function (no-op when registration was skipped). */
export function registerQamTab(tab: Omit<Tab, "id">): () => void {
  try {
    const hook = tabsHook();
    if (!hook) {
      console.warn("Legion of Fans: QAM tabs hook unavailable, tab not added");
      return () => {};
    }
    if (hook.tabs.some((t) => t.id === LOF_TAB_ID)) hook.removeById(LOF_TAB_ID);
    hook.add({ ...tab, id: LOF_TAB_ID });
    return () => {
      try {
        tabsHook()?.removeById(LOF_TAB_ID);
      } catch (e) {
        console.error("Legion of Fans: QAM tab cleanup failed", e);
      }
    };
  } catch (e) {
    console.error("Legion of Fans: QAM tab registration failed", e);
    return () => {};
  }
}
