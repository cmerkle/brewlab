import { useState } from "react";
import { useData, NumInput, usePref } from "../ui";
import { useGrinders } from "../grindui";
import { METHODS, METHOD_LABELS, recommend, convertSetting, effectiveRanges, rangeFor, NO_DATA_MESSAGE, DRAFT_NOTE, type Method } from "../../shared/grind";

export function Guide({ onEditGrinder }: { onEditGrinder: (id: string) => void }) {
  const grinders = useGrinders();
  return (
    <div className="stack">
      <Converter onEditGrinder={onEditGrinder} />
      <h2>Grind guide</h2>
      <p className="hint">{DRAFT_NOTE} K-Ultra ranges are from the original guide.</p>
      {grinders.map((g) => {
        const r = effectiveRanges(g);
        const custom = Boolean(g.grindRanges && Object.keys(g.grindRanges.methods ?? {}).length);
        return (
          <section key={g.id} className="card" data-testid={`guide-${g.id}`}>
            <header>
              <h3>{g.name}</h3>
              <span className="tag">{!custom ? "no ranges" : g.library?.confidence ? `library · ${g.library.confidence}` : "your ranges"}</span>
            </header>
            {r?.scale && <div className="muted">{r.scale}</div>}
            <table className="guide">
              <thead><tr><th>Method</th><th>Start</th><th>Range</th><th>≈ µm</th></tr></thead>
              <tbody>
                {METHODS.map((m) => {
                  const rec = recommend(g, m);
                  return (
                    <tr key={m}>
                      <td>{METHOD_LABELS[m]}</td>
                      {rec.ok ? (
                        <>
                          <td><strong>{rec.start}</strong></td>
                          <td>{rec.low} – {rec.high}</td>
                          <td>{rec.microns.low}–{rec.microns.high}</td>
                        </>
                      ) : (
                        <td colSpan={3} className="note">
                          {rec.message}
                          {rec.reason === "no-data" && <> <button className="link" onClick={() => onEditGrinder(g.id)}>Edit grinder</button></>}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}

function Converter({ onEditGrinder }: { onEditGrinder: (id: string) => void }) {
  const grinders = useGrinders();
  const { gear } = useData();
  void gear;
  const [method, setMethod] = useState<Method>("pourover");
  // Start from the last grinder used here, else the first of yours with a pour-over range.
  const [savedFrom, setSavedFrom] = usePref<string>("converter.from", "");
  const fallback = grinders.find((g) => rangeFor(g, "pourover")) ?? grinders[0];
  const from = grinders.find((g) => g.id === savedFrom) ?? fallback;
  const setFromId = (id: string) => setSavedFrom(id);
  const startValue = (() => {
    const r = from ? rangeFor(from, "pourover") : null;
    return r ? Math.round(((r.low + r.high) / 2) * 100) / 100 : null;
  })();
  const [value, setValue] = useState<number | null>(startValue);
  const fromRange = from ? rangeFor(from, method) : null;
  return (
    <section className="card converter" aria-label="Grind-size converter">
      <h2>Grind-size converter</h2>
      <div className="tabs small" role="tablist" aria-label="Brew method">
        {METHODS.map((m) => (
          <button key={m} role="tab" aria-selected={method === m} className={method === m ? "on" : ""} onClick={() => setMethod(m)}>{METHOD_LABELS[m].split(" (")[0]}</button>
        ))}
      </div>
      <div className="grid2">
        <div className="field">
          <label htmlFor="cv-from">From grinder</label>
          <select id="cv-from" value={from?.id ?? ""} onChange={(e) => setFromId(e.target.value)}>
            {grinders.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="cv-value">Setting{from?.units ? ` (${from.units})` : ""}</label>
          <NumInput id="cv-value" value={value} onChange={setValue} decimals={2} />
        </div>
      </div>
      {from && !fromRange && (
        <div className="note">
          {effectiveRanges(from)?.notes?.[method] ?? `${from.name}: ${NO_DATA_MESSAGE}`}{" "}
          {!effectiveRanges(from)?.notes?.[method] && <button className="link" onClick={() => onEditGrinder(from.id)}>Edit grinder</button>}
        </div>
      )}
      {from && fromRange && value != null && (
        <ul className="conv" data-testid="converter-results">
          {grinders.filter((g) => g.id !== from.id).map((g) => {
            const r = convertSetting(value, from, g, method);
            return (
              <li key={g.id} data-grinder={g.id}>
                <span>{g.name}</span>
                {r.ok ? (
                  <strong>{r.display}{r.microns ? <span className="muted"> · ~{r.microns} µm</span> : null}{r.clamped ? <span className="muted"> (at the end of its range)</span> : null}</strong>
                ) : (
                  <span className="note">
                    {r.message}
                    {r.reason === "no-data" && <> <button className="link" onClick={() => onEditGrinder(g.id)}>Edit grinder</button></>}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
