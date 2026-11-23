import { useState } from "react";
import { api, type Bag, type Brew, type Recipe } from "../api";
import { useData, Field, FullScreen, ErrorBox, NumInput, Stars, Menu, fmtDate, daysSince, useAction } from "../ui";
import { RecipeCard } from "./Recipes";
import { ScaleDialog, type BrewPlan } from "./ScaleDialog";

const VERDICTS = [
  { id: "loved", label: "Loved" },
  { id: "liked", label: "Liked" },
  { id: "not_for_me", label: "Not for me" },
  { id: "disliked", label: "Disliked" },
];

export function Stash() {
  const { bags, loaded } = useData();
  const [editing, setEditing] = useState<Bag | "new" | null>(null);
  useAction("add-bag", () => setEditing("new"));
  return (
    <div className="stack">
      {!loaded && <p className="muted">Loading…</p>}
      {loaded && bags.length === 0 && <p className="muted">No bags yet.</p>}
      <div className="cards">
        {bags.map((b) => <BagCard key={b.id} b={b} onEdit={() => setEditing(b)} />)}
      </div>
      {editing && <BagForm bag={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** Rest / peak guidance from the roast date (filter coffee; espresso usually wants a little longer). */
export function freshness(b: Pick<Bag, "roastDate" | "status">): { text: string; tone: "info" | "ok" | "warn" } | null {
  const d = daysSince(b.roastDate);
  if (d == null || b.status === "finished" || d < 0) return null;
  if (d < 7) return { text: `Day ${d} off roast — resting; usually best from about day 7`, tone: "info" };
  if (d <= 30) return { text: `Day ${d} off roast — in its peak window`, tone: "ok" };
  return { text: `Day ${d} off roast — past the usual peak window`, tone: "warn" };
}

/** Low-stock estimate from the bag's own average dose (20 g if it has no brews yet). */
export function stock(b: Bag, brews: Brew[]): { text: string; tone: "warn" } | null {
  if (b.remainingG == null || b.status === "finished") return null;
  if (b.remainingG <= 0) return { text: "Empty — mark it finished?", tone: "warn" };
  const doses = brews.filter((x) => x.inventoryId === b.id).map((x) => x.doseG);
  const avg = doses.length ? doses.reduce((a, c) => a + c, 0) / doses.length : 20;
  const left = Math.floor(b.remainingG / avg);
  if (left <= 2) return { text: left <= 0 ? "Less than one brew left" : `About ${left} brew${left === 1 ? "" : "s"} left`, tone: "warn" };
  return null;
}

function BagCard({ b, onEdit }: { b: Bag; onEdit: () => void }) {
  const { reload, act, brews, limits } = useData();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<{ recipes: Recipe[]; brews: Brew[] } | null>(null);
  const [brewing, setBrewing] = useState<BrewPlan | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [sizing, setSizing] = useState(false);
  const [size, setSize] = useState<number | null>(null);
  const roast = daysSince(b.roastDate);
  const opened = daysSince(b.openedDate);
  const fresh = freshness(b);
  const low = stock(b, brews);

  const loadDetail = () => api.get<{ recipes: Recipe[]; brews: Brew[] }>(`/api/inventory/${b.id}`).then(setDetail);
  const toggle = () =>
    act(async () => {
      if (!open) await loadDetail();
      setOpen(!open);
    });
  const markOpened = () =>
    act(async () => {
      await api.post(`/api/inventory/${b.id}/open`);
      await reload(["bags"]);
    }, "Marked opened");
  const del = async () => {
    if (!confirm(`Delete ${b.name}? Linked recipes and brews keep the coffee name.`)) return;
    await act(async () => {
      await api.del(`/api/inventory/${b.id}`);
      await reload(["bags", "recipes", "brews"]);
    }, "Bag deleted");
  };
  const saveSize = () =>
    act(async () => {
      await api.put(`/api/inventory/${b.id}`, { amountG: size });
      await reload(["bags"]);
      setSizing(false);
    }, "Bag size saved");

  return (
    <article className={`card bag ${b.status}`} data-testid={`bag-${b.id}`}>
      <header>
        {b.photo && <img className="bag-thumb" src={b.photo} alt="" loading="lazy" />}
        <h3>{b.name}</h3>
        <span className={`status ${b.status}`} data-testid="bag-status">{b.status}</span>
        <Menu label={`More actions for ${b.name}`} items={[{ label: "Edit", onClick: onEdit }, { label: "Delete", onClick: del, danger: true }]} />
      </header>
      <div className="muted">{[b.roaster, b.origin, b.processMethod, b.roastLevel].filter(Boolean).join(" · ")}</div>
      {(fresh || low) && (
        <div className="nudges">
          {low && <span className="nudge warn" data-testid="bag-low">{low.text}</span>}
          {fresh && <span className={`nudge ${fresh.tone}`}>{fresh.text}</span>}
        </div>
      )}
      <dl className="facts">
        <div><dt>Since roast</dt><dd>{roast != null ? `${roast} days` : "—"}</dd></div>
        <div><dt>Since opened</dt><dd>{opened != null ? `${opened} days` : "—"}</dd></div>
        <div>
          <dt>Remaining</dt>
          <dd data-testid="bag-remaining">
            {b.remainingG != null ? `${Math.max(0, b.remainingG)} g of ${b.amountG}` : sizing ? null : (
              <button className="link" onClick={() => { setSize(null); setSizing(true); }}>Add bag size</button>
            )}
          </dd>
        </div>
        <div><dt>Price</dt><dd>{b.price != null ? `$${b.price}` : "—"}</dd></div>
      </dl>
      {sizing && (
        <div className="row inline-edit">
          <NumInput aria-label="Bag size in grams" placeholder="e.g. 340" value={size} onChange={setSize} min={limits?.amountG.min} max={limits?.amountG.max} decimals={0} />
          <span className="muted">g</span>
          <button onClick={() => setSizing(false)}>Cancel</button>
          <button className="primary" disabled={!size} onClick={saveSize}>Save</button>
        </div>
      )}
      <div className="muted small">
        {b.purchaseDate && <>Bought {fmtDate(b.purchaseDate)} · </>}
        {b.openedDate && <span data-testid="bag-opened">Opened {fmtDate(b.openedDate)} · </span>}
        {b.finishedDate && <span data-testid="bag-finished">Finished {fmtDate(b.finishedDate)} · </span>}
        Source: {b.source}
      </div>
      {b.rating != null && <Stars value={b.rating} />}
      {b.notes && <p className="small">{b.notes}</p>}
      {b.url && <a href={b.url} target="_blank" rel="noreferrer noopener" className="small">Roaster page ↗</a>}
      <div className="row wrap">
        {b.status === "unopened" && <button className="primary" onClick={markOpened}>Mark opened</button>}
        {b.status === "open" && <button className="primary" onClick={() => setFinishing(true)}>Mark finished</button>}
        <button onClick={toggle} aria-expanded={open}>{open ? "Hide" : "Recipes & brews"}</button>
        {b.status === "unopened" && <button onClick={() => setFinishing(true)}>Mark finished</button>}
      </div>
      {open && detail && (
        <div className="expand">
          <h4>Linked recipes</h4>
          {detail.recipes.length === 0 ? <p className="muted small">No recipes linked to this bag.</p> : (
            <div className="rows">{detail.recipes.map((r) => <RecipeCard key={r.id} r={r} onBrew={setBrewing} />)}</div>
          )}
          <h4>Brew history</h4>
          {detail.brews.length === 0 ? <p className="muted small">No brews logged against this bag yet.</p> : (
            <ul className="plain small">{detail.brews.map((x) => <li key={x.id}>{fmtDate(x.brewedAt)} — {x.recipeName ?? "Brew"} · {x.doseG} g / {x.waterG} g{x.grindSetting ? ` · ${x.grindSetting}` : ""}{x.rating ? ` · ${x.rating}★` : ""}</li>)}</ul>
          )}
        </div>
      )}
      {brewing && <ScaleDialog plan={{ ...brewing, inventoryId: brewing.inventoryId ?? b.id }} onClose={() => { setBrewing(null); if (open) loadDetail().catch(() => {}); }} />}
      {finishing && <FinishDialog bag={b} onClose={() => setFinishing(false)} />}
    </article>
  );
}

/** Finishing a bag can log a verdict, which feeds the Discover matching rules. */
function FinishDialog({ bag, onClose }: { bag: Bag; onClose: () => void }) {
  const { reload, toast } = useData();
  const [verdict, setVerdict] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const finish = async (withVerdict: boolean) => {
    setError(null);
    setBusy(true);
    try {
      const r = await api.post<{ alreadyLogged: boolean; tasting: unknown }>(`/api/inventory/${bag.id}/finish`, withVerdict ? { verdict, notes } : {});
      await reload(["bags"]);
      toast(!withVerdict ? "Marked finished" : r.alreadyLogged ? "Marked finished — it was already in your tasting log" : "Marked finished and added to the tasting log");
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <FullScreen title={`Finish ${bag.name}`} onClose={onClose}
      footer={<div className="row"><button disabled={busy} onClick={() => finish(false)}>Finish without logging</button><button className="primary grow" disabled={busy || !verdict} onClick={() => finish(true)}>Finish &amp; log</button></div>}>
      <div className="stack form">
        <p>How was it? Logging a verdict adds it to the Discover tasting log, so the weekly board won't suggest it again and learns what you like.</p>
        <Field label="Verdict" htmlFor="fin-verdict">
          <select id="fin-verdict" value={verdict} onChange={(e) => setVerdict(e.target.value)}>
            <option value="">Choose…</option>
            {VERDICTS.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </Field>
        <Field label="Notes" htmlFor="fin-notes"><textarea id="fin-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What stood out?" /></Field>
        <ErrorBox error={error} />
      </div>
    </FullScreen>
  );
}

type Draft = Record<string, string | number | undefined>;
interface ImportRes { found: boolean; message: string; draft?: Draft; fields?: string[]; rawText?: string; photo?: string }

function BagForm({ bag, onClose }: { bag: Bag | null; onClose: () => void }) {
  const { limits, reload, toast } = useData();
  const [f, setF] = useState({
    name: bag?.name ?? "", roaster: bag?.roaster ?? "", origin: bag?.origin ?? "", processMethod: bag?.processMethod ?? "",
    roastLevel: bag?.roastLevel ?? "", roastDate: bag?.roastDate ?? "", purchaseDate: bag?.purchaseDate ?? "",
    openedDate: bag?.openedDate ?? "", finishedDate: bag?.finishedDate ?? "", amountG: bag?.amountG ?? null as number | null,
    price: bag?.price ?? null as number | null, url: bag?.url ?? "", rating: bag?.rating ?? null as number | null, notes: bag?.notes ?? "",
    photo: bag?.photo ?? null as string | null,
  });
  const [error, setError] = useState<string | null>(null);
  const [imp, setImp] = useState<ImportRes | null>(null);
  const [busy, setBusy] = useState<"" | "photo" | "link">("");
  const [link, setLink] = useState("");
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const applyDraft = (r: ImportRes) => {
    setImp(r);
    if (r.photo) setF((x) => ({ ...x, photo: r.photo! }));
    if (!r.found || !r.draft) return;
    const d = r.draft;
    setF((x) => {
      const n = { ...x };
      for (const k of ["name", "roaster", "origin", "processMethod", "roastLevel", "roastDate"] as const) if (d[k]) n[k] = String(d[k]);
      if (d.amountG != null) n.amountG = Number(d.amountG);
      if (d.price != null) n.price = Number(d.price);
      if (d.url) n.url = String(d.url);
      if (d.tastingNotes) n.notes = [n.notes, `Tasting notes: ${d.tastingNotes}`].filter(Boolean).join(" · ");
      if (d.details) n.notes = [n.notes, String(d.details)].filter(Boolean).join(" · ");
      return n;
    });
  };
  const fromPhoto = async (file: File, read = true) => {
    setBusy("photo");
    setImp(null);
    try {
      const fd = new FormData();
      fd.append("photo", file);
      applyDraft(await api.post<ImportRes>(`/api/import/photo${read ? "" : "?read=0"}`, fd));
    } catch (e: any) {
      setImp({ found: false, message: e.message });
    } finally {
      setBusy("");
    }
  };
  const fromLink = async () => {
    setBusy("link");
    setImp(null);
    try {
      applyDraft(await api.post<ImportRes>("/api/import/link", { url: link }));
    } catch (e: any) {
      setImp({ found: false, message: e.message });
    } finally {
      setBusy("");
    }
  };
  const save = async () => {
    setError(null);
    const body = { ...f, url: f.url || null, notes: f.notes || null };
    try {
      if (bag) await api.put(`/api/inventory/${bag.id}`, body);
      else await api.post("/api/inventory", { ...body, source: "manual" });
      await reload(["bags", "recipes"]);
      toast(bag ? "Bag updated" : "Bag added to the Stash");
      onClose();
    } catch (e: any) {
      setError(e.message);
    }
  };
  const text = (k: "name" | "roaster" | "origin" | "processMethod" | "roastLevel", label: string) => (
    <Field label={label} htmlFor={`bf-${k}`}><input id={`bf-${k}`} value={f[k]} onChange={(e) => set(k, e.target.value)} /></Field>
  );
  const dateF = (k: "roastDate" | "purchaseDate" | "openedDate" | "finishedDate", label: string) => (
    <Field label={label} htmlFor={`bf-${k}`}><input id={`bf-${k}`} type="date" value={f[k] ?? ""} onChange={(e) => set(k, e.target.value)} /></Field>
  );

  return (
    <FullScreen title={bag ? "Edit bag" : "Add a bag"} onClose={onClose}
      footer={<div className="row"><button onClick={onClose}>Cancel</button><button className="primary grow" onClick={save}>Save bag</button></div>}>
      <div className="stack form" data-testid="bag-form">
        {!bag && (
          <section className="import">
            <h3>Import the details</h3>
            <p className="hint">Both only pre-fill the form — check and edit before saving.</p>
            <div className="field">
              <label htmlFor="bf-photo">Photo of the bag</label>
              <input id="bf-photo" type="file" accept="image/jpeg,image/png" capture="environment" disabled={!!busy}
                onChange={(e) => e.target.files?.[0] && fromPhoto(e.target.files[0])} />
            </div>
            <div className="field">
              <label htmlFor="bf-link">Roaster product link</label>
              <div className="row">
                <input id="bf-link" type="url" placeholder="https://roaster.com/products/…" value={link} onChange={(e) => setLink(e.target.value)} />
                <button onClick={fromLink} disabled={!link || !!busy}>{busy === "link" ? "Fetching…" : "Fetch"}</button>
              </div>
            </div>
            {busy === "photo" && <p className="muted">Reading the label…</p>}
            {imp && (
              <div className={imp.found ? "ok-box" : "note"} role="status" data-testid="import-result">
                {imp.message}
                {imp.found && imp.fields && <div className="small">Filled: {imp.fields.join(", ")}</div>}
                {imp.rawText && <details><summary>Text read from the photo</summary><pre>{imp.rawText}</pre></details>}
              </div>
            )}
          </section>
        )}
        {f.photo ? (
          <div className="photo-row">
            <img className="bag-photo" src={f.photo} alt="Bag photo" />
            <button className="link danger" onClick={() => set("photo", null)}>Remove photo</button>
          </div>
        ) : bag ? (
          <div className="field">
            <label htmlFor="bf-attach">Photo (optional)</label>
            <input id="bf-attach" type="file" accept="image/jpeg,image/png" capture="environment" disabled={!!busy}
              onChange={(e) => e.target.files?.[0] && fromPhoto(e.target.files[0], false)} />
          </div>
        ) : null}
        <div className="grid2">{text("name", "Coffee / bean name")}{text("roaster", "Roaster")}</div>
        <div className="grid3">{text("origin", "Origin")}{text("processMethod", "Process")}{text("roastLevel", "Roast level")}</div>
        <div className="dates">
          {dateF("roastDate", "Roast date")}{dateF("purchaseDate", "Purchase date")}{dateF("openedDate", "Opened date")}{dateF("finishedDate", "Finished date")}
        </div>
        <div className="grid2">
          <Field label="Bag size (g)" htmlFor="bf-amount"><NumInput id="bf-amount" value={f.amountG} onChange={(n) => set("amountG", n)} min={limits?.amountG.min} max={limits?.amountG.max} decimals={0} /></Field>
          <Field label="Price ($)" htmlFor="bf-price"><NumInput id="bf-price" value={f.price} onChange={(n) => set("price", n)} min={limits?.price.min} max={limits?.price.max} decimals={2} /></Field>
        </div>
        <Field label="Roaster / product link" htmlFor="bf-url"><input id="bf-url" type="url" value={f.url} onChange={(e) => set("url", e.target.value)} /></Field>
        <Field label="Rating"><Stars value={f.rating} onChange={(n) => set("rating", n)} /></Field>
        <Field label="Notes" htmlFor="bf-notes"><textarea id="bf-notes" rows={3} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
        <ErrorBox error={error} />
      </div>
    </FullScreen>
  );
}
