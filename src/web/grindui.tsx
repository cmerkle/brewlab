import { useMemo } from "react";
import type { Gear, Recipe } from "./api";
import { useData } from "./ui";
import { convertSetting, fmtGrind, NO_DATA_MESSAGE, type Method, rangeFor } from "../shared/grind";

export function useGrinders() {
  const { gear } = useData();
  return useMemo(() => gear.filter((g) => g.type === "grinder"), [gear]);
}

export function methodOf(r: { method: Method | null; brewerId: string | null }, gear: Gear[]): Method {
  if (r.method) return r.method;
  const b = gear.find((g) => g.id === r.brewerId);
  return (b?.defaultMethod as Method) || "pourover";
}

export interface GrindChoice {
  grinderId: string | null;
  grinderName: string | null;
  /** Dial number on the chosen grinder. */
  setting: number | null;
  converted: boolean;
}

/**
 * Converted setting for a recipe on a chosen grinder. The recipe's own grinder
 * returns its recorded grindSetting unchanged.
 */
export function grindFor(
  recipe: Pick<Recipe, "grinderId" | "grinderName" | "grindSetting" | "method" | "brewerId">,
  targetId: string | null,
  grinders: Gear[],
  gear: Gear[],
): GrindChoice & { message?: string; microns?: number | null } {
  const orig = grinders.find((g) => g.id === recipe.grinderId);
  if (!targetId || targetId === recipe.grinderId) {
    return { grinderId: recipe.grinderId, grinderName: orig?.name ?? recipe.grinderName, setting: recipe.grindSetting, converted: false };
  }
  const target = grinders.find((g) => g.id === targetId);
  if (!target) return { grinderId: null, grinderName: null, setting: null, converted: false, message: "Grinder not found" };
  const m = methodOf(recipe, gear);
  if (!orig) {
    return { grinderId: target.id, grinderName: target.name, setting: null, converted: false,
      message: `The recipe's grinder (${recipe.grinderName ?? "unknown"}) isn't in your gear, so there's nothing to convert from — type a setting.` };
  }
  const v = recipe.grindSetting;
  if (v == null) return { grinderId: target.id, grinderName: target.name, setting: null, converted: false, message: "The recipe's grind setting has no number to convert." };
  const r = convertSetting(v, orig, target, m);
  if (!r.ok) return { grinderId: target.id, grinderName: target.name, setting: null, converted: false, message: r.message };
  return { grinderId: target.id, grinderName: target.name, setting: r.value, converted: true, microns: r.microns };
}

export function GrinderSwitcher({
  recipe, value, onChange, idPrefix, onEditGrinder,
}: {
  recipe: Pick<Recipe, "grinderId" | "grinderName" | "grindSetting" | "method" | "brewerId">;
  value: string | null;
  onChange: (id: string) => void;
  idPrefix: string;
  onEditGrinder?: (id: string) => void;
}) {
  const grinders = useGrinders();
  const { gear } = useData();
  const choice = grindFor(recipe, value, grinders, gear);
  const m = methodOf(recipe, gear);
  const id = `${idPrefix}-grinder`;
  const noData = choice.message?.startsWith(NO_DATA_MESSAGE);
  const origMissing = recipe.grinderId && !grinders.some((g) => g.id === recipe.grinderId);
  const target = grinders.find((g) => g.id === choice.grinderId) ?? null;
  const orig = grinders.find((g) => g.id === recipe.grinderId) ?? null;
  return (
    <div className="switcher">
      <label htmlFor={id}>Grinder</label>
      <select id={id} value={value ?? recipe.grinderId ?? ""} onChange={(e) => onChange(e.target.value)}>
        {origMissing || !recipe.grinderId ? (
          <option value={recipe.grinderId ?? ""}>{recipe.grinderName ?? "No grinder"} (original{origMissing ? " — removed from gear" : ""})</option>
        ) : null}
        {grinders.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
            {g.id === recipe.grinderId ? " (original)" : ""}
            {!rangeFor(g, m) ? " — no data" : ""}
          </option>
        ))}
      </select>
      <div className="grind-out" data-testid={`${idPrefix}-grind`}>
        {choice.setting != null ? (
          <>
            <strong>{fmtGrind(choice.setting, target)}</strong>
            {choice.converted ? <span className="muted"> · converted from {fmtGrind(recipe.grindSetting, orig)}{choice.microns ? ` · ~${choice.microns} µm` : ""}</span> : <span className="muted"> · original</span>}
          </>
        ) : (
          <span className="note">
            {choice.message}
            {noData && onEditGrinder && value && (
              <>
                {" "}
                <button type="button" className="link" onClick={() => onEditGrinder(value)}>Edit grinder</button>
              </>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

/** "K-Ultra 88 clicks" / "Ode 5.1" for a recorded brew or recipe (grinder looked up by id). */
export function grindLabel(r: { grinderId: string | null; grinderName: string | null; grindSetting: number | null }, gear: Gear[], withName = true): string {
  const g = gear.find((x) => x.id === r.grinderId) ?? null;
  const n = fmtGrind(r.grindSetting, g);
  const name = g?.name ?? r.grinderName;
  if (!withName) return n || "—";
  return name ? `${name}${n ? ` ${n}` : ""}` : n || "—";
}

/** Unit word for a grinder's number field ("clicks", "rotations"), or "". */
export const grindUnits = (g: Gear | null | undefined) => g?.units ?? "";
