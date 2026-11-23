import { useCallback, useEffect, useState } from "react";
import { api, type Avoid, type Edition, type Pick, type Tasting } from "../api";
import { useData, Field, ErrorBox, NumInput, fmtDate } from "../ui";
import { Taste } from "./Taste";

interface Board {
  latestEdition: Edition | null;
  pastEditions: Edition[];
  refresh: { lastRunAt: string | null; lastStatus: string | null; lastNote: string | null };
  llm: { provider: string; model: string | null; enabled: boolean; researchSupported: boolean; problem: string | null };
  candidates: (Record<string, any> & { id: number })[];
}

const VERDICTS = [
  { id: "loved", label: "Loved" },
  { id: "liked", label: "Liked" },
  { id: "not_for_me", label: "Not for me" },
  { id: "disliked", label: "Disliked" },
];

export function Discover({ tab }: { tab: string }) {
  const [board, setBoard] = useState<Board | null>(null);
  const load = useCallback(async () => setBoard(await api.get<Board>("/api/discover/board")), []);
  useEffect(() => {
    load();
  }, [load]);
  if (!board) return <p className="muted">Loading…</p>;
  if (tab === "tastings") return <Tastings />;
  if (tab === "taste") return <Taste />;
  if (tab === "avoid") return <Avoids />;
  if (tab === "refresh") return <Refresh board={board} reload={load} />;
  if (tab === "archive")
    return (
      <div className="stack">
        {board.pastEditions.length === 0 && <p className="muted">No past editions yet — they appear here once a newer board is published.</p>}
        {board.pastEditions.map((e) => <EditionView key={e.id} e={e} reload={load} past />)}
      </div>
    );
  return (
    <div className="stack">
      <RefreshStatus r={board.refresh} />
      {board.latestEdition ? <EditionView e={board.latestEdition} reload={load} /> : <p className="muted">No board yet.</p>}
    </div>
  );
}

function RefreshStatus({ r }: { r: Board["refresh"] }) {
  return (
    <div className="refresh-status small" data-testid="refresh-status">
      Last refresh: {r.lastRunAt ? new Date(r.lastRunAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "never"} ·{" "}
      <strong>{r.lastStatus ?? "—"}</strong>
      {r.lastNote ? <> — {r.lastNote}</> : null}
    </div>
  );
}

function EditionView({ e, reload, past }: { e: Edition; reload: () => void; past?: boolean }) {
  return (
    <section className="edition" data-testid={`edition-${e.id}`}>
      <h2>{e.weekLabel}</h2>
      {e.seasonNote && <p className="season">{e.seasonNote}</p>}
      <div className="cards">
        {e.picks.map((p) => <PickCard key={p.id} p={p} reload={reload} compact={past} />)}
      </div>
    </section>
  );
}

function PickCard({ p, reload, compact }: { p: Pick; reload: () => void; compact?: boolean }) {
  const { reload: reloadData, toast } = useData();
  const [inv, setInv] = useState(p.inventoryState);
  const [invMsg, setInvMsg] = useState<string | null>(null);
  const [trying, setTrying] = useState(false);
  const [verdict, setVerdict] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setInv(p.inventoryState), [p.inventoryState]);

  const add = async () => {
    setInv("adding");
    setInvMsg(null);
    try {
      const r = await api.post<{ added: boolean }>(`/api/discover/picks/${p.id}/add-to-inventory`);
      setInv("added");
      const msg = r.added ? "Added to your Stash as an unopened bag." : "Already in your inventory.";
      setInvMsg(msg);
      toast(msg);
      await reloadData(["bags"]);
      reload();
    } catch (e: any) {
      setInv("not_added"); // back to the button so it can be retried
      setInvMsg(`Couldn't add: ${e.message}`);
    }
  };
  const status = async (s: Pick["status"], extra: Record<string, unknown> = {}) => {
    setErr(null);
    try {
      await api.patch(`/api/discover/picks/${p.id}`, { status: s, ...extra });
      if (s === "tried") toast("Added to the tasting log");
      setTrying(false);
      reload();
    } catch (e: any) {
      setErr(e.message);
    }
  };
  return (
    <article className={`card pick ${p.kind}`} data-testid={`pick-${p.id}`}>
      <header>
        <span className="rank">#{p.rank}</span>
        <h3>{p.name}</h3>
        {p.kind === "wildcard" && <span className="tag wild">wildcard</span>}
        {p.status !== "new" && <span className={`tag st-${p.status}`}>{p.status}</span>}
      </header>
      <div className="muted">{p.roaster}{p.origin ? ` · ${p.origin}` : ""}</div>
      <dl className="facts">
        <div><dt>Process</dt><dd>{p.processMethod || "—"}</dd></div>
        <div><dt>Roast</dt><dd>{p.roastLevel || "—"}</dd></div>
        <div><dt>Price</dt><dd>{p.priceText || (p.priceAmount != null ? `$${p.priceAmount}` : "—")}</dd></div>
      </dl>
      {p.tastingNotes && <p><strong>Notes:</strong> {p.tastingNotes}</p>}
      {!compact && p.whyFit && <p className="small"><strong>Why it fits:</strong> {p.whyFit}</p>}
      {!compact && p.brewTip && <p className="small"><strong>Brew tip:</strong> {p.brewTip}</p>}
      {p.funkRisk && <p className="small"><strong>Funk risk:</strong> {p.funkRisk}</p>}
      {p.url && <a className="small" href={p.url} target="_blank" rel="noreferrer noopener">Roaster page ↗</a>}
      <div className="row wrap">
        {inv === "added" ? (
          <span className="tag in-inv" data-testid="in-inventory">In inventory</span>
        ) : (
          <button className="primary" disabled={inv === "adding"} onClick={add} data-testid="add-to-inventory">
            {inv === "adding" ? "Adding to inventory…" : "Add to inventory"}
          </button>
        )}
        {!compact && (
          <>
            {p.status !== "saved" && <button onClick={() => status("saved")}>Save</button>}
            {p.status !== "passed" && <button onClick={() => status("passed")}>Pass</button>}
            {p.status !== "tried" && <button onClick={() => setTrying(true)}>Tried it</button>}
            {p.status !== "new" && <button onClick={() => status("new")}>Clear</button>}
          </>
        )}
      </div>
      {invMsg && <div className="small" role="status" data-testid="inv-msg">{invMsg}</div>}
      {trying && (
        <div className="tried-form">
          <Field label="Verdict" htmlFor={`v-${p.id}`}>
            <select id={`v-${p.id}`} value={verdict} onChange={(e) => setVerdict(e.target.value)}>
              <option value="">Choose…</option>
              {VERDICTS.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
          </Field>
          <Field label="Notes" htmlFor={`n-${p.id}`}><textarea id={`n-${p.id}`} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          <div className="row"><button onClick={() => setTrying(false)}>Cancel</button><button className="primary" onClick={() => status("tried", { verdict, notes })}>Save to tasting log</button></div>
        </div>
      )}
      <ErrorBox error={err} />
    </article>
  );
}

function Tastings() {
  const [list, setList] = useState<Tasting[]>([]);
  const [f, setF] = useState({ name: "", roaster: "", origin: "", processMethod: "", verdict: "", notes: "" });
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => setList(await api.get<Tasting[]>("/api/discover/tastings")), []);
  useEffect(() => {
    load();
  }, [load]);
  const add = async () => {
    setErr(null);
    try {
      await api.post("/api/discover/tastings", f);
      setF({ name: "", roaster: "", origin: "", processMethod: "", verdict: "", notes: "" });
      load();
    } catch (e: any) {
      setErr(e.message);
    }
  };
  return (
    <div className="stack">
      <ul className="log" data-testid="tasting-log">
        {list.map((t) => (
          <li key={t.id} className="card">
            <header><h3>{t.name}</h3><span className={`verdict ${t.verdict}`}>{VERDICTS.find((v) => v.id === t.verdict)?.label ?? t.verdict}</span></header>
            <div className="muted small">{[t.roaster, t.origin, t.processMethod].filter(Boolean).join(" · ")} · {fmtDate(t.createdAt)}</div>
            {t.notes && <p className="small">{t.notes}</p>}
            <button className="link danger" onClick={async () => { if (confirm(`Remove ${t.name} from the tasting log?`)) { await api.del(`/api/discover/tastings/${t.id}`); load(); } }}>Remove</button>
          </li>
        ))}
      </ul>
      <section className="card">
        <h3>Log a coffee</h3>
        <div className="grid2">
          <Field label="Coffee" htmlFor="t-name"><input id="t-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Roaster" htmlFor="t-roaster"><input id="t-roaster" value={f.roaster} onChange={(e) => setF({ ...f, roaster: e.target.value })} /></Field>
          <Field label="Origin" htmlFor="t-origin"><input id="t-origin" value={f.origin} onChange={(e) => setF({ ...f, origin: e.target.value })} /></Field>
          <Field label="Process" htmlFor="t-proc"><input id="t-proc" value={f.processMethod} onChange={(e) => setF({ ...f, processMethod: e.target.value })} /></Field>
        </div>
        <Field label="Verdict" htmlFor="t-verdict">
          <select id="t-verdict" value={f.verdict} onChange={(e) => setF({ ...f, verdict: e.target.value })}>
            <option value="">Choose…</option>{VERDICTS.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </Field>
        <Field label="Notes" htmlFor="t-notes"><textarea id="t-notes" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <ErrorBox error={err} />
        <button className="primary" onClick={add}>Add to tasting log</button>
      </section>
    </div>
  );
}

function Avoids() {
  const [list, setList] = useState<Avoid[]>([]);
  const [f, setF] = useState({ name: "", roaster: "", reason: "", url: "" });
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => setList(await api.get<Avoid[]>("/api/discover/avoids")), []);
  useEffect(() => {
    load();
  }, [load]);
  const add = async () => {
    setErr(null);
    try {
      await api.post("/api/discover/avoids", f);
      setF({ name: "", roaster: "", reason: "", url: "" });
      load();
    } catch (e: any) {
      setErr(e.message);
    }
  };
  return (
    <div className="stack">
      <ul className="log" data-testid="avoid-list">
        {list.map((a) => (
          <li key={a.id} className="card">
            <header><h3>{a.name}</h3><span className="muted">{a.roaster}</span></header>
            {a.reason && <p className="small">{a.reason}</p>}
            {a.url && <a className="small" href={a.url} target="_blank" rel="noreferrer noopener">Link ↗</a>}
            <button className="link danger" onClick={async () => { if (confirm(`Remove ${a.name} from the avoid list?`)) { await api.del(`/api/discover/avoids/${a.id}`); load(); } }}>Remove</button>
          </li>
        ))}
      </ul>
      <section className="card">
        <h3>Add to the avoid list</h3>
        <div className="grid2">
          <Field label="Coffee" htmlFor="a-name"><input id="a-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Roaster" htmlFor="a-roaster"><input id="a-roaster" value={f.roaster} onChange={(e) => setF({ ...f, roaster: e.target.value })} /></Field>
        </div>
        <Field label="Reason" htmlFor="a-reason"><textarea id="a-reason" rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
        <Field label="Link" htmlFor="a-url"><input id="a-url" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /></Field>
        <ErrorBox error={err} />
        <button className="primary" onClick={add}>Add</button>
      </section>
    </div>
  );
}

const EMPTY_CAND = {
  kind: "pick", name: "", roaster: "", origin: "", processMethod: "", tastingNotes: "", roastLevel: "",
  priceAmount: null as number | null, priceText: "", url: "", whyFit: "", brewTip: "", funkRisk: "",
};

function Refresh({ board, reload }: { board: Board; reload: () => void }) {
  const [f, setF] = useState(EMPTY_CAND);
  const [err, setErr] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any>(null);
  const set = (k: keyof typeof EMPTY_CAND, v: any) => setF((x) => ({ ...x, [k]: v }));
  const [link, setLink] = useState("");
  const [fetching, setFetching] = useState(false);
  const [linkMsg, setLinkMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fromLink = async () => {
    setFetching(true);
    setLinkMsg(null);
    try {
      const r = await api.post<{ found: boolean; message: string; draft?: Record<string, any> }>("/api/import/link", { url: link });
      if (r.found && r.draft) {
        const d = r.draft;
        setF((x) => ({
          ...x,
          name: d.name ?? x.name, roaster: d.roaster ?? x.roaster, origin: d.origin ?? x.origin,
          processMethod: d.processMethod ?? x.processMethod, tastingNotes: d.tastingNotes ?? x.tastingNotes,
          roastLevel: d.roastLevel ?? x.roastLevel, priceAmount: d.price ?? x.priceAmount,
          priceText: d.price != null ? `$${d.price}${d.amountG ? ` / ${d.amountG} g` : ""}` : x.priceText, url: d.url ?? link,
        }));
      }
      setLinkMsg({ ok: r.found, text: r.message });
    } catch (e: any) {
      setLinkMsg({ ok: false, text: e.message });
    } finally {
      setFetching(false);
    }
  };
  const addCand = async () => {
    setErr(null);
    try {
      await api.post("/api/discover/candidates", f);
      setF(EMPTY_CAND);
      reload();
    } catch (e: any) {
      setErr(e.message);
    }
  };
  const run = async () => {
    setRunning(true);
    setResult(null);
    try {
      setResult(await api.post("/api/discover/refresh"));
    } catch (e: any) {
      setResult({ status: "error", note: e.message, dropped: [], kept: [] });
    } finally {
      setRunning(false);
      reload();
    }
  };
  const t = (k: keyof typeof EMPTY_CAND, label: string, area = false) => (
    <Field label={label} htmlFor={`c-${k}`}>
      {area ? <textarea id={`c-${k}`} rows={2} value={(f as any)[k]} onChange={(e) => set(k, e.target.value)} />
        : <input id={`c-${k}`} value={(f as any)[k]} onChange={(e) => set(k, e.target.value)} />}
    </Field>
  );
  return (
    <div className="stack">
      <RefreshStatus r={board.refresh} />
      <section className="card">
        <h3>Weekly refresh</h3>
        <p className="small">
          Runs automatically on Mondays around 8 a.m.{" "}
          {board.llm.researchSupported
            ? `Research runs on ${board.llm.provider} (${board.llm.model}): it checks roasters' own pages, then applies the matching rules and publishes. Candidates entered below take priority over research.`
            : `${board.llm.problem ? `LLM setup problem: ${board.llm.problem} ` : board.llm.enabled ? `The ${board.llm.provider} provider has no web search, so research is manual. ` : "No AI provider is connected (More → Settings → AI provider), so research is manual. "}Enter candidates below; the refresh drops anything tried, on the avoid list, already in the stash, or matching your "Always leave out" rules (Your taste), ranks the rest by your ratings and publishes them.`}
        </p>
        <button className="primary" onClick={run} disabled={running}>{running ? "Refreshing…" : "Run refresh now"}</button>
        {result && (
          <div className="ok-box" data-testid="refresh-result">
            <strong>{result.status}</strong> — {result.note}
            {result.dropped?.length > 0 && (
              <ul className="small">{result.dropped.map((d: any, i: number) => <li key={i}>Dropped <strong>{d.candidate.name}</strong> ({d.candidate.roaster}): {d.reason}</li>)}</ul>
            )}
          </div>
        )}
      </section>
      <section className="card">
        <h3>Candidates waiting for the next refresh ({board.candidates.length})</h3>
        <ul className="plain small" data-testid="candidates">
          {board.candidates.map((c) => (
            <li key={c.id}>{c.kind === "wildcard" ? "🃏 " : ""}{c.name} — {c.roaster}{c.processMethod ? ` · ${c.processMethod}` : ""}{" "}
              <button className="link danger" onClick={async () => { await api.del(`/api/discover/candidates/${c.id}`); reload(); }}>Remove</button></li>
          ))}
        </ul>
        <h4>Add a candidate</h4>
        <div className="field">
          <label htmlFor="c-link">Fill from a roaster product link</label>
          <div className="row">
            <input id="c-link" type="url" placeholder="https://roaster.example/products/coffee" value={link} onChange={(e) => setLink(e.target.value)} />
            <button onClick={fromLink} disabled={!link || fetching}>{fetching ? "Fetching…" : "Fetch"}</button>
          </div>
          {linkMsg && <div className={linkMsg.ok ? "ok-box small" : "note"} role="status" data-testid="cand-link-result">{linkMsg.text}{linkMsg.ok ? " Add why it fits and a brew tip yourself." : ""}</div>}
        </div>
        <div className="grid2">
          {t("name", "Coffee")}{t("roaster", "Roaster")}{t("origin", "Origin")}{t("processMethod", "Process")}
          {t("tastingNotes", "Tasting notes")}{t("roastLevel", "Roast level")}{t("priceText", "Price as listed")}
          <Field label="Price (USD number)" htmlFor="c-price"><NumInput id="c-price" value={f.priceAmount} onChange={(n) => set("priceAmount", n)} decimals={2} /></Field>
        </div>
        {t("url", "Roaster product page")}{t("whyFit", "Why it fits", true)}{t("brewTip", "Brew tip")}{t("funkRisk", "Funk risk")}
        <Field label="Kind" htmlFor="c-kind">
          <select id="c-kind" value={f.kind} onChange={(e) => set("kind", e.target.value)}><option value="pick">Ranked pick</option><option value="wildcard">Wildcard</option></select>
        </Field>
        <ErrorBox error={err} />
        <button onClick={addCand}>Add candidate</button>
      </section>
    </div>
  );
}
