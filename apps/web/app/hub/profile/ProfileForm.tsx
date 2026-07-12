"use client";

import { useCallback, useRef, useState, type CSSProperties } from "react";
import type { BiographicalProfile, PersonSex } from "@chronicle/db";
import { common, hub, welcome } from "@/app/_copy";
import {
  saveDisplayNameAction,
  saveSpokenNameAction,
  saveBirthDateAction,
  saveSexAction,
  saveAnchorAction,
} from "./actions";

type FieldKey =
  | "displayName"
  | "spokenName"
  | "birthDate"
  | "sex"
  | keyof BiographicalProfile;

type SaveState = "idle" | "saving" | "saved" | "error";

export interface ProfileFormProps {
  displayName: string;
  spokenName: string;
  email: string | null;
  birthDate: string | null;
  sex: PersonSex;
  anchors: Partial<BiographicalProfile>;
}

const NOW_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 120 }, (_, i) => NOW_YEAR - i);

function parseBirthDate(iso: string | null): { month: string; day: string; year: string } {
  if (!iso) return { month: "", day: "", year: "" };
  const [y, m, d] = iso.split("-");
  return {
    year: y ?? "",
    month: m ? String(Number(m)) : "",
    day: d ? String(Number(d)) : "",
  };
}

function daysInMonth(monthStr: string, yearStr: string): number {
  if (monthStr === "") return 31;
  const month = Number(monthStr);
  const year = yearStr === "" ? 2000 : Number(yearStr);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function boolSelectValue(v: boolean | null | undefined): string {
  if (v === true) return "yes";
  if (v === false) return "no";
  return "";
}

export function ProfileForm({
  displayName: initialDisplayName,
  spokenName: initialSpokenName,
  email,
  birthDate: initialBirthDate,
  sex: initialSex,
  anchors: initialAnchors,
}: ProfileFormProps) {
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [spokenName, setSpokenName] = useState(initialSpokenName);
  const [sex, setSex] = useState<PersonSex>(initialSex);
  const parsed = parseBirthDate(initialBirthDate);
  const [month, setMonth] = useState(parsed.month);
  const [day, setDay] = useState(parsed.day);
  const [year, setYear] = useState(parsed.year);
  const [anchors, setAnchors] = useState<Partial<BiographicalProfile>>(initialAnchors);
  const [fieldState, setFieldState] = useState<Partial<Record<FieldKey, SaveState>>>({});

  const dobComplete = month !== "" && day !== "" && year !== "";
  const savingRef = useRef<Set<FieldKey>>(new Set());

  const mark = useCallback((key: FieldKey, state: SaveState) => {
    setFieldState((s) => ({ ...s, [key]: state }));
    if (state === "saved") {
      window.setTimeout(() => {
        setFieldState((s) => (s[key] === "saved" ? { ...s, [key]: "idle" } : s));
      }, 2000);
    }
  }, []);

  const runSave = useCallback(
    async (key: FieldKey, fn: () => Promise<{ ok: true } | { error: string }>) => {
      if (savingRef.current.has(key)) return;
      savingRef.current.add(key);
      mark(key, "saving");
      const result = await fn();
      mark(key, "ok" in result ? "saved" : "error");
      savingRef.current.delete(key);
    },
    [mark],
  );

  function statusHint(key: FieldKey): string | null {
    const s = fieldState[key];
    if (s === "saving") return hub.profile.saving;
    if (s === "saved") return hub.profile.saved;
    if (s === "error") return hub.profile.saveError;
    return null;
  }

  function hintEl(key: FieldKey) {
    const text = statusHint(key);
    if (!text) return null;
    return (
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--text-label)",
          color: fieldState[key] === "error" ? "var(--accent-strong)" : "var(--text-muted)",
          marginTop: 4,
          display: "block",
        }}
      >
        {text}
      </span>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
      {/* Identity */}
      <section aria-labelledby="profile-identity-heading">
        <h2 id="profile-identity-heading" style={sectionTitle}>
          {hub.profile.identityHeading}
        </h2>
        <p style={sectionIntro}>{hub.profile.identityIntro}</p>
        <div style={fieldStack}>
          <label className="kin-form-label">
            {welcome.nameLabel}
            <input
              type="text"
              className="kin-field"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              onBlur={() => {
                void runSave("displayName", () => saveDisplayNameAction(displayName));
              }}
            />
            {hintEl("displayName")}
          </label>

          <label className="kin-form-label">
            {hub.profile.spokenNameLabel}
            <input
              type="text"
              className="kin-field"
              value={spokenName}
              onChange={(e) => setSpokenName(e.target.value)}
              onBlur={() => {
                void runSave("spokenName", () => saveSpokenNameAction(spokenName));
              }}
            />
            <span style={helpText}>{hub.profile.spokenNameHelp}</span>
            {hintEl("spokenName")}
          </label>

          {email ? (
            <label className="kin-form-label">
              {hub.profile.emailLabel}
              <input type="email" className="kin-field" value={email} readOnly disabled />
              <span style={helpText}>{hub.profile.emailHelp}</span>
            </label>
          ) : null}

          <div>
            <span className="kin-form-label" style={{ display: "block", marginBottom: 8 }}>
              {hub.profile.birthdayLabel}
            </span>
            <div
              style={{ display: "grid", gridTemplateColumns: "1.4fr 0.8fr 1fr", gap: 10 }}
            >
              <label className="kin-form-label">
                {welcome.monthLabel}
                <select
                  className="kin-field"
                  value={month}
                  onChange={(e) => {
                    const m = e.target.value;
                    setMonth(m);
                    if (day !== "" && Number(day) > daysInMonth(m, year)) setDay("");
                  }}
                  onBlur={trySaveBirthDate}
                >
                  <option value="">{welcome.monthLabel}</option>
                  {common.months.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
              <label className="kin-form-label">
                {welcome.dayLabel}
                <select
                  className="kin-field"
                  value={day}
                  onChange={(e) => setDay(e.target.value)}
                  onBlur={trySaveBirthDate}
                >
                  <option value="">{welcome.dayLabel}</option>
                  {Array.from({ length: daysInMonth(month, year) }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
              <label className="kin-form-label">
                {welcome.yearLabel}
                <select
                  className="kin-field"
                  value={year}
                  onChange={(e) => {
                    const y = e.target.value;
                    setYear(y);
                    if (day !== "" && Number(day) > daysInMonth(month, y)) setDay("");
                  }}
                  onBlur={trySaveBirthDate}
                >
                  <option value="">{welcome.yearLabel}</option>
                  {YEARS.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {hintEl("birthDate")}
          </div>

          <label className="kin-form-label">
            {hub.kin.sexFieldLabel}
            <select
              className="kin-field"
              value={sex}
              onChange={(e) => {
                const next = e.target.value as PersonSex;
                setSex(next);
                void runSave("sex", () => saveSexAction(next));
              }}
            >
              <option value="unknown">{hub.kin.sexUnknown}</option>
              <option value="male">{hub.kin.sexMale}</option>
              <option value="female">{hub.kin.sexFemale}</option>
            </select>
            {hintEl("sex")}
          </label>
        </div>
      </section>

      {/* Introduction anchors */}
      <section aria-labelledby="profile-intro-heading">
        <h2 id="profile-intro-heading" style={sectionTitle}>
          {hub.profile.introHeading}
        </h2>
        <p style={sectionIntro}>{hub.profile.introIntro}</p>
        <div style={fieldStack}>
          <AnchorTextField
            label={hub.profile.anchorLabels.hometown}
            fieldKey="hometown"
            value={anchors.hometown ?? ""}
            hint={hintEl("hometown")}
            onChange={(v) => setAnchors((a) => ({ ...a, hometown: v || null }))}
            onSave={(v) =>
              runSave("hometown", () =>
                saveAnchorAction("hometown", v.trim() === "" ? null : v.trim()),
              )
            }
          />
          <AnchorTextField
            label={hub.profile.anchorLabels.siblingContext}
            fieldKey="siblingContext"
            value={anchors.siblingContext ?? ""}
            hint={hintEl("siblingContext")}
            onChange={(v) => setAnchors((a) => ({ ...a, siblingContext: v || null }))}
            onSave={(v) =>
              runSave("siblingContext", () =>
                saveAnchorAction("siblingContext", v.trim() === "" ? null : v.trim()),
              )
            }
          />
          <AnchorTextField
            label={hub.profile.anchorLabels.currentLocation}
            fieldKey="currentLocation"
            value={anchors.currentLocation ?? ""}
            hint={hintEl("currentLocation")}
            onChange={(v) => setAnchors((a) => ({ ...a, currentLocation: v || null }))}
            onSave={(v) =>
              runSave("currentLocation", () =>
                saveAnchorAction("currentLocation", v.trim() === "" ? null : v.trim()),
              )
            }
          />
          <AnchorTextField
            label={hub.profile.anchorLabels.occupationSummary}
            fieldKey="occupationSummary"
            value={anchors.occupationSummary ?? ""}
            hint={hintEl("occupationSummary")}
            onChange={(v) => setAnchors((a) => ({ ...a, occupationSummary: v || null }))}
            onSave={(v) =>
              runSave("occupationSummary", () =>
                saveAnchorAction("occupationSummary", v.trim() === "" ? null : v.trim()),
              )
            }
          />

          <BoolAnchorField
            label={hub.profile.anchorLabels.hasChildren}
            fieldKey="hasChildren"
            value={anchors.hasChildren ?? null}
            hint={hintEl("hasChildren")}
            onChange={(v) => {
              setAnchors((a) => ({
                ...a,
                hasChildren: v,
                ...(v === false ? { hasGrandchildren: null } : {}),
              }));
            }}
            onSave={(v) => runSave("hasChildren", () => saveAnchorAction("hasChildren", v))}
          />

          {anchors.hasChildren === true ? (
            <BoolAnchorField
              label={hub.profile.anchorLabels.hasGrandchildren}
              fieldKey="hasGrandchildren"
              value={anchors.hasGrandchildren ?? null}
              hint={hintEl("hasGrandchildren")}
              onChange={(v) => setAnchors((a) => ({ ...a, hasGrandchildren: v }))}
              onSave={(v) =>
                runSave("hasGrandchildren", () => saveAnchorAction("hasGrandchildren", v))
              }
            />
          ) : null}
        </div>
      </section>
    </div>
  );

  function trySaveBirthDate() {
    if (!dobComplete) return;
    void runSave("birthDate", () =>
      saveBirthDateAction({
        year: Number(year),
        month: Number(month),
        day: Number(day),
      }),
    );
  }
}

function AnchorTextField({
  label,
  value,
  hint,
  onChange,
  onSave,
}: {
  label: string;
  fieldKey: string;
  value: string;
  hint: React.ReactNode;
  onChange: (v: string) => void;
  onSave: (v: string) => void;
}) {
  return (
    <label className="kin-form-label">
      {label}
      <input
        type="text"
        className="kin-field"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onSave(e.target.value)}
      />
      {hint}
    </label>
  );
}

function BoolAnchorField({
  label,
  value,
  hint,
  onChange,
  onSave,
}: {
  label: string;
  fieldKey: string;
  value: boolean | null;
  hint: React.ReactNode;
  onChange: (v: boolean | null) => void;
  onSave: (v: boolean | null) => void;
}) {
  return (
    <label className="kin-form-label">
      {label}
      <select
        className="kin-field"
        value={boolSelectValue(value)}
        onChange={(e) => {
          const raw = e.target.value;
          const next: boolean | null = raw === "yes" ? true : raw === "no" ? false : null;
          onChange(next);
          onSave(next);
        }}
      >
        <option value="">{hub.profile.notAnswered}</option>
        <option value="yes">{hub.profile.yes}</option>
        <option value="no">{hub.profile.no}</option>
      </select>
      {hint}
    </label>
  );
}

const sectionTitle: CSSProperties = {
  fontFamily: "var(--font-story)",
  fontSize: "var(--text-story-lg)",
  fontWeight: 400,
  color: "var(--text-body)",
  margin: "0 0 8px",
};

const sectionIntro: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-ui-sm)",
  color: "var(--text-muted)",
  margin: "0 0 20px",
  lineHeight: "var(--leading-snug)",
};

const fieldStack: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 20,
};

const helpText: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-label)",
  color: "var(--text-muted)",
  marginTop: 6,
  display: "block",
  lineHeight: "var(--leading-snug)",
};
