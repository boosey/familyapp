"use client";
import { useEffect, useState, type CSSProperties } from "react";
import { SKIN_IDS, type SkinId } from "./skin-constants";
import { hub } from "@/app/_copy";
import { PREFERENCES } from "./preferences/registry";
import { readPreference, setPreference, applyPreference } from "./preferences/client";

const pref = PREFERENCES.skin;
const SWATCH: Record<SkinId, { page: string; accent: string }> = {
  playful:  { page: "#FBF1DE", accent: "#EF7A54" },
  heirloom: { page: "#F4ECE0", accent: "#BD5B3D" },
};

export function KindredSkinPicker() {
  const [active, setActive] = useState<SkinId>(pref.default as SkinId);
  useEffect(() => {
    const skin = readPreference(pref) as SkinId;
    setActive(skin);
    applyPreference(pref, skin);
  }, []);
  function choose(skin: SkinId): void { setActive(skin); setPreference(pref, skin); }
  return (
    <div role="group" aria-label={hub.settings.skinAria} style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
      {SKIN_IDS.map((id) => {
        const on = id === active; const sw = SWATCH[id];
        return (
          <button key={id} type="button" onClick={() => choose(id)} aria-pressed={on}
            aria-label={hub.settings.skinLabels[id]} title={hub.settings.skinLabels[id]} style={cell(on)}>
            <span style={swatch(sw.page, sw.accent)} aria-hidden="true" />
            <span style={{ lineHeight: 1.2 }}>{hub.settings.skinShort[id]}</span>
          </button>
        );
      })}
    </div>
  );
}
function cell(on: boolean): CSSProperties { return {
  display:"flex", flexDirection:"column", alignItems:"center", gap:8, padding:"12px 16px", minWidth:100,
  cursor:"pointer", borderRadius:"var(--radius-md)",
  border: on ? "2px solid var(--accent)" : "var(--border-width) solid var(--border-strong)",
  background: on ? "var(--accent-soft)" : "var(--surface-card)",
  fontFamily:"var(--font-ui)", fontSize:"var(--text-ui-sm)", fontWeight:600, color:"var(--text-body)" };
}
function swatch(page: string, accent: string): CSSProperties { return {
  width:48, height:32, borderRadius:6, background:page, border:"1px solid var(--border)",
  boxShadow:`inset 0 -6px 0 ${accent}` };
}
