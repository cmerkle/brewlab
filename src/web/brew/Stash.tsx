import { useEffect, useRef, useState } from "react";
import { api, type Bag, type Brew, type Recipe } from "../api";
import { useData, Field, FullScreen, ErrorBox, NumInput, Stars, Menu, fmtDate, daysSince, useAction, usePref, SearchInput, useVocab, TagInput } from "../ui";
import { BAG_SORTS, sortBags, bagMatches, freshnessNote, splitTags, type BagSort, type SortDir, type RestOverrides, type RoastLevelDef } from "../../shared/stash";
import { grindLabel } from "../grindui";
import { RecipeCard } from "./Recipes";
import { ScaleDialog, type BrewPlan } from "./ScaleDialog";

const VERDICTS = [
  { id: "loved", label: "Loved" },
  { id: "liked", label: "Liked" },
  { id: "not_for_me", label: "Not for me" },
  { id: "disliked", label: "Disliked" },
];

/** The Stash shows bags you have (unopened, open); finished bags go to the Archive (#/brew/stash/archive). */
export function Stash({ view }: { view?: string }) {
  const { bags, loaded } = useData();
  const [editing, setEditing] = useState<Bag | "new" | null>(null);
  const [copying, setCopying] = useState<Bag | null>(null);
  useAction("add-bag", () => setEditing("new"));
  const archive = view === "archive";
  const current = bags.filter((b) => b.status !== "finished");
  const finished = bags.filter((b) => b.status === "finished");
  // Each tab keeps its own sort (per device); search applies to whichever tab is showing.
  const [stashSort, setStashSort] = usePref<{ by: BagSort; dir: SortDir }>("stash.sort", { by: "status", dir: "asc" });
  const [archiveSort, setArchiveSort] = usePref<{ by: BagSort; dir: SortDir }>("stash.archiveSort", { by: "finishedDate", dir: "desc" });
  const [sort, setSort] = archive ? [archiveSort, setArchiveSort] : [stashSort, setStashSort];
  const by: BagSort = sort.by in BAG_SORTS ? sort.by : "status";
  const [q, setQ] = useState("");
  const pool = archive ? finished : current;
  const shown = sortBags(pool.filter((b) => bagMatches(b, q, fmtDate)), by, sort.dir);
  const kind = BAG_SORTS[by].kind;
  const dirLabel = (d: SortDir) =>
    kind === "text" ? (d === "asc" ? "A → Z" : "Z → A") : kind === "date" ? (d === "asc" ? "oldest first" : "newest first")
      : kind === "number" ? (d === "asc" ? "lowest first" : "highest first") : d === "asc" ? "open first" : "unopened first";
  return (
    <div className="stack">
      <div className="tabs small" role="tablist" aria-label="Stash or archive">
        <button role="tab" aria-selected={!archive} className={!archive ? "on" : ""} onClick={() => { location.hash = "#/brew/stash"; }}>In your stash ({current.length})</button>
        <button role="tab" aria-selected={archive} className={archive ? "on" : ""} onClick={() => { location.hash = "#/brew/stash/archive"; }}>Archive ({finished.length})</button>
      </div>
      {pool.length > 0 && (
        <div className="toolbar">
          <SearchInput placeholder="Search name, roaster, origin, dates…" label={archive ? "Search the archive" : "Search your stash"} value={q} onChange={setQ} />
          <div className="sort-row">
            <select className="pill-select" aria-label="Sort by" value={by}
              onChange={(e) => { const b = e.target.value as BagSort; setSort({ by: b, dir: BAG_SORTS[b].dir }); }}>
              {(Object.keys(BAG_SORTS) as BagSort[]).filter((k) => archive ? k !== "status" && k !== "remainingG" : k !== "finishedDate").map((k) => <option key={k} value={k}>{BAG_SORTS[k].label}</option>)}
            </select>
            <button type="button" className="icon-btn sort-dir" data-testid="sort-dir"
              aria-label={`Sort direction: ${dirLabel(sort.dir)}. Switch to ${dirLabel(sort.dir === "asc" ? "desc" : "asc")}`} title={dirLabel(sort.dir)}
              onClick={() => setSort({ by, dir: sort.dir === "asc" ? "desc" : "asc" })}>
              <span aria-hidden="true">{sort.dir === "asc" ? "↑" : "↓"}</span>
            </button>
          </div>
        </div>
      )}
      {!loaded && <p className="muted">Loading…</p>}
      {loaded && pool.length === 0 && (
        <p className="muted" data-testid="stash-empty">
          {archive ? "No finished bags yet. When you mark a bag finished, it moves here." : finished.length ? "Nothing in your stash: every bag is finished. Add one with +." : "No bags yet."}
        </p>
      )}
      {loaded && pool.length > 0 && shown.length === 0 && <p className="muted" data-testid="stash-no-match">No bags match “{q}”.</p>}
      {archive && finished.length > 0 && !q && <p className="muted small">Finished bags. Their brews and tasting notes are kept.</p>}
      <div className="cards">
        {shown.map((b) => <BagCard key={b.id} b={b} onEdit={() => setEditing(b)} onDuplicate={() => setCopying(b)} />)}
      </div>
      {editing && <BagForm bag={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {copying && <BagForm bag={null} copyOf={copying} onClose={() => setCopying(null)} />}
    </div>
  );
}

/** Rest / peak guidance from the roast date (filter coffee; espresso usually wants a little longer). */
/** Rest / peak guidance from the roast date and roast level; the windows are a setting (More). */
export function freshness(b: Pick<Bag, "roastDate" | "status" | "roastLevel">, levels: RoastLevelDef[], overrides?: RestOverrides): { text: string; tone: "info" | "ok" | "warn" } | null {
  if (b.status === "finished") return null;
  return freshnessNote(daysSince(b.roastDate), b.roastLevel, levels, overrides);
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

function BagCard({ b, onEdit, onDuplicate }: { b: Bag; onEdit: () => void; onDuplicate: () => void }) {
  const { reload, act, brews, limits, gear, settings } = useData();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<{ recipes: Recipe[]; brews: Brew[] } | null>(null);
  const [brewing, setBrewing] = useState<BrewPlan | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [sizing, setSizing] = useState(false);
  const [size, setSize] = useState<number | null>(null);
  const roast = daysSince(b.roastDate);
  const opened = daysSince(b.openedDate);
  const vocab = useVocab();
  const fresh = freshness(b, vocab.roastLevels, settings.restWindows);
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
  // Finished by mistake: clear the finished date and it's back in the Stash.
  const unfinish = () =>
    act(async () => {
      await api.put(`/api/inventory/${b.id}`, { finishedDate: null });
      await reload(["bags"]);
    }, `${b.name} is back in your stash`);
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
        <Menu label={`More actions for ${b.name}`} items={[{ label: "Edit", onClick: onEdit }, { label: "Duplicate", onClick: onDuplicate }, { label: "Delete", onClick: del, danger: true }]} />
      </header>
      <div className="muted">{[b.roaster, b.origin, b.processMethod, b.roastLevel].filter(Boolean).join(" · ")}</div>
      {b.tastingNotes.length > 0 && <ul className="tag-list" aria-label="Tasting notes" data-testid="bag-tags">{b.tastingNotes.map((t) => <li key={t}>{t}</li>)}</ul>}
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
            {b.remainingG != null ? (
              <>
                {Math.max(0, b.remainingG)} g of {b.amountG}
              </>
            ) : sizing ? null : (
              <button className="link" onClick={() => { setSize(null); setSizing(true); }}>Add bag size</button>
            )}
          </dd>
        </div>
        <div><dt>Price</dt><dd>{b.price != null ? `$${b.price}` : "—"}</dd></div>
      </dl>
      {b.unloggedG !== 0 && b.remainingG != null && (
        <div className="muted small" data-testid="bag-unlogged">
          {b.unloggedG > 0 ? `Includes ${b.unloggedG} g used without a logged brew.` : `${-b.unloggedG} g more than the logged brews leave.`}
        </div>
      )}
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
        {b.status === "finished" && <button onClick={unfinish}>Back to stash</button>}
      </div>
      {open && detail && (
        <div className="expand">
          <h4>Linked recipes</h4>
          {detail.recipes.length === 0 ? <p className="muted small">No recipes linked to this bag.</p> : (
            <div className="rows">{detail.recipes.map((r) => <RecipeCard key={r.id} r={r} onBrew={setBrewing} />)}</div>
          )}
          <h4>Brew history</h4>
          {detail.brews.length === 0 ? <p className="muted small">No brews logged against this bag yet.</p> : (
            <ul className="plain small">{detail.brews.map((x) => <li key={x.id}>{fmtDate(x.brewedAt)} — {x.recipeName ?? "Brew"} · {x.doseG} g / {x.waterG} g{x.grindSetting != null ? ` · ${grindLabel(x, gear)}` : ""}{x.rating ? ` · ${x.rating}★` : ""}</li>)}</ul>
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
      toast(!withVerdict ? "Finished — moved to the Archive" : r.alreadyLogged ? "Finished and moved to the Archive — it was already in your tasting log" : "Finished, moved to the Archive and added to the tasting log");
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
interface LookupRes { found: boolean; message: string; draft?: Draft; sources?: Record<string, "page" | "search">; url?: string }

const FIELD_LABELS: Record<string, string> = {
  name: "name", roaster: "roaster", origin: "origin", processMethod: "process", roastLevel: "roast level", roastDate: "roast date",
  amountG: "bag size", price: "price", url: "link", tastingNotes: "tasting notes", details: "details",
};

/**
 * Any image the browser can show → a JPEG (longest side ≤ 2048 px). Handles iPhone HEIC photos,
 * large screenshots and pasted PNGs, and keeps uploads small.
 */
async function toJpeg(blob: Blob, name = "bag.jpg"): Promise<File> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("decode"));
      i.src = url;
    });
    const scale = Math.min(1, 2048 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    const out = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.88));
    if (!out) throw new Error("encode");
    return new File([out], name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    if (blob.type === "image/jpeg" || blob.type === "image/png") return new File([blob], name, { type: blob.type });
    throw new Error("That image format can't be read here — try a JPEG or PNG, or take a photo.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Take a photo, choose one (Photos / Files), paste from the clipboard, or drop a file (desktop). */
function ImagePicker({ id, label, onImage, disabled }: { id: string; label: string; onImage: (f: File) => void; disabled?: boolean }) {
  const camera = useRef<HTMLInputElement>(null);
  const choose = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const take = async (blob: Blob | null | undefined, name?: string) => {
    if (!blob) return;
    setMsg(null);
    try {
      onImage(await toJpeg(blob, name));
    } catch (e: any) {
      setMsg(e.message);
    }
  };
  // ⌘V / Ctrl+V anywhere in the form (not while typing in a field).
  useEffect(() => {
    if (disabled) return;
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (file) {
        e.preventDefault();
        take(file, "pasted.png");
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });
  const paste = async () => {
    setMsg(null);
    try {
      const items = await (navigator.clipboard as any).read();
      for (const it of items) {
        const type = it.types.find((t: string) => t.startsWith("image/"));
        if (type) return take(await it.getType(type), "pasted.png");
      }
      setMsg("There's no image on the clipboard — copy a photo first.");
    } catch {
      setMsg("Couldn't read the clipboard here. Copy the image, then press ⌘V / Ctrl+V — or use Choose.");
    }
  };
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) take(f, f.name);
  };
  return (
    <div className={`field image-picker ${over ? "drop-over" : ""}`} data-testid={`${id}-picker`}
      onDragOver={(e) => { if (!disabled) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled) take([...e.dataTransfer.files].find((f) => f.type.startsWith("image/")), "dropped.jpg"); }}>
      <label htmlFor={`${id}-choose`}>{label}</label>
      <div className="picker-buttons">
        <button type="button" onClick={() => camera.current?.click()} disabled={disabled}>Take photo</button>
        <button type="button" onClick={() => choose.current?.click()} disabled={disabled}>Choose photo or file</button>
        <button type="button" onClick={paste} disabled={disabled}>Paste image</button>
      </div>
      <input ref={camera} id={`${id}-camera`} type="file" accept="image/*" capture="environment" hidden onChange={pick} aria-label="Take a photo" />
      <input ref={choose} id={`${id}-choose`} type="file" accept="image/*" hidden onChange={pick} aria-label="Choose a photo or file" />
      <span className="hint">Or drop an image here, or paste it with ⌘V / Ctrl+V.</span>
      {msg && <p className="error small" role="status">{msg}</p>}
    </div>
  );
}

/**
 * Add / edit a bag. `copyOf` starts a NEW bag from an existing one (bought more than one bag):
 * everything about the coffee is copied; opened/finished dates and the rating start empty.
 */
function BagForm({ bag, copyOf, onClose }: { bag: Bag | null; copyOf?: Bag; onClose: () => void }) {
  const src = bag ?? copyOf ?? null;
  const { limits, reload, toast } = useData();
  const [f, setF] = useState({
    name: src?.name ?? "", roaster: src?.roaster ?? "", origin: src?.origin ?? "", processMethod: src?.processMethod ?? "",
    roastLevel: src?.roastLevel ?? "", roastDate: src?.roastDate ?? "", purchaseDate: src?.purchaseDate ?? "",
    openedDate: bag?.openedDate ?? "", finishedDate: bag?.finishedDate ?? "", amountG: src?.amountG ?? null as number | null,
    price: src?.price ?? null as number | null, url: src?.url ?? "", rating: bag?.rating ?? null as number | null, notes: src?.notes ?? "",
    photo: src?.photo ?? null as string | null,
    tastingNotes: src?.tastingNotes ?? ([] as string[]),
  });
  const vocab = useVocab();
  const { bags } = useData();
  const usedTags = [...new Set(bags.flatMap((x) => x.tastingNotes))];
  const [error, setError] = useState<string | null>(null);
  const [imp, setImp] = useState<ImportRes | null>(null);
  const [busy, setBusy] = useState<"" | "photo" | "link" | "lookup">("");
  const [canLookup, setCanLookup] = useState(false);
  const [look, setLook] = useState<(LookupRes & { filled: string[] }) | null>(null);
  useEffect(() => {
    api.get<{ researchSupported: boolean }>("/api/ai").then((a) => setCanLookup(Boolean(a.researchSupported))).catch(() => {});
  }, []);
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
      if (d.tastingNotes) n.tastingNotes = [...new Set([...n.tastingNotes, ...splitTags(String(d.tastingNotes))])];
      if (d.details) n.notes = [n.notes, String(d.details)].filter(Boolean).join(" · ");
      return n;
    });
  };
  /** Fill only fields that are still empty — the label and anything typed always win. */
  const lookup = async (known: { name?: string; roaster?: string; origin?: string; processMethod?: string; roastLevel?: string }) => {
    setBusy("lookup");
    setLook(null);
    try {
      const r = await api.post<LookupRes>("/api/import/lookup", known);
      const filled: string[] = [];
      if (r.found && r.draft) {
        const d = r.draft;
        setF((x) => {
          const n = { ...x };
          for (const k of ["name", "roaster", "origin", "processMethod", "roastLevel"] as const)
            if (d[k] && !n[k]) { n[k] = String(d[k]); filled.push(k); }
          if (d.amountG != null && n.amountG == null) { n.amountG = Number(d.amountG); filled.push("amountG"); }
          if (d.price != null && n.price == null) { n.price = Number(d.price); filled.push("price"); }
          if (d.url && !n.url) { n.url = String(d.url); filled.push("url"); }
          if (d.tastingNotes && !n.tastingNotes.length) { n.tastingNotes = splitTags(String(d.tastingNotes)); filled.push("tastingNotes"); }
          if (d.details && !n.notes.includes(String(d.details))) { n.notes = [n.notes, String(d.details)].filter(Boolean).join(" · "); filled.push("details"); }
          return n;
        });
      }
      setLook({ ...r, filled });
    } catch (e: any) {
      setLook({ found: false, message: e.message, filled: [] });
    } finally {
      setBusy("");
    }
  };
  const fromPhoto = async (file: File, read = true) => {
    setBusy("photo");
    setImp(null);
    setLook(null);
    let r: ImportRes | null = null;
    try {
      const fd = new FormData();
      fd.append("photo", file);
      r = await api.post<ImportRes>(`/api/import/photo${read ? "" : "?read=0"}`, fd);
      applyDraft(r);
    } catch (e: any) {
      setImp({ found: false, message: e.message });
    } finally {
      setBusy("");
    }
    // Then look the coffee up on the roaster's site to fill what the label doesn't say.
    if (read && r?.found && canLookup) {
      const d = r.draft ?? {};
      const v = (k: string) => (d[k] ? String(d[k]) : (f as any)[k] || undefined);
      if (v("name") || v("roaster"))
        await lookup({ name: v("name"), roaster: v("roaster"), origin: v("origin"), processMethod: v("processMethod"), roastLevel: v("roastLevel") });
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
  // Coffee left: follows the bag size until you type your own (coffee used without logging a brew).
  const [leftTyped, setLeftTyped] = useState<number | null | undefined>(undefined);
  const leftAuto = bag && f.amountG != null ? Math.round((f.amountG - bag.usedG - (bag.unloggedG ?? 0)) * 10) / 10 : null;
  const left = leftTyped !== undefined ? leftTyped : leftAuto == null ? null : Math.max(0, leftAuto);
  const save = async () => {
    setError(null);
    const body = { ...f, url: f.url || null, notes: f.notes || null };
    if (leftTyped !== undefined && (leftTyped == null || leftTyped < 0 || f.amountG == null || leftTyped > f.amountG))
      return setError(`Coffee left must be between 0 and the bag size${f.amountG != null ? ` (${f.amountG} g)` : ""}.`);
    try {
      if (bag) {
        await api.put(`/api/inventory/${bag.id}`, body);
        if (leftTyped !== undefined) await api.post(`/api/inventory/${bag.id}/remaining`, { remainingG: leftTyped });
      }
      else await api.post("/api/inventory", { ...body, source: "manual" });
      await reload(["bags", "recipes"]);
      toast(bag ? "Bag updated" : copyOf ? "Another bag added to the Stash" : "Bag added to the Stash");
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
    <FullScreen title={bag ? "Edit bag" : copyOf ? "Add another bag" : "Add a bag"} onClose={onClose}
      footer={<div className="row"><button onClick={onClose}>Cancel</button><button className="primary grow" onClick={save}>Save bag</button></div>}>
      <div className="stack form" data-testid="bag-form">
        {copyOf && (
          <p className="note small" data-testid="bag-copy-note">
            A copy of <strong>{copyOf.name}</strong>{copyOf.roaster ? ` (${copyOf.roaster})` : ""} as a new, unopened bag — opened and finished dates and the rating start empty. Change anything that's different, like the roast date, then save.
          </p>
        )}
        {!bag && !copyOf && (
          <section className="import">
            <h3>Import the details</h3>
            <p className="hint">Both only pre-fill the form — check and edit before saving.</p>
            <ImagePicker id="bf-photo" label="Photo of the bag" disabled={!!busy} onImage={(file) => fromPhoto(file)} />
            <div className="field">
              <label htmlFor="bf-link">Roaster product link</label>
              <div className="row">
                <input id="bf-link" type="url" placeholder="https://roaster.com/products/…" value={link} onChange={(e) => setLink(e.target.value)} />
                <button onClick={fromLink} disabled={!link || !!busy}>{busy === "link" ? "Fetching…" : "Fetch"}</button>
              </div>
            </div>
            {busy === "photo" && <p className="muted" role="status">Reading the label…</p>}
            {busy === "lookup" && <p className="muted" role="status">Looking it up on the roaster's site…</p>}
            {imp && (
              <div className={imp.found ? "ok-box" : "note"} role="status" data-testid="import-result">
                {imp.message}
                {imp.found && imp.fields && <div className="small">Filled: {imp.fields.join(", ")}</div>}
                {imp.rawText && <details><summary>Text read from the photo</summary><pre>{imp.rawText}</pre></details>}
              </div>
            )}
            {look && (
              <div className={look.found ? "ok-box" : "note"} role="status" data-testid="lookup-result">
                {look.message}
                {look.found && (
                  <div className="small">
                    {look.filled.length
                      ? <>Filled from the web: {look.filled.map((k) => `${FIELD_LABELS[k] ?? k}${look.sources?.[k] === "search" ? "*" : ""}`).join(", ")}.</>
                      : "Nothing new — the form already had those details."}
                    {look.url && <> <a href={look.url} target="_blank" rel="noreferrer noopener">Roaster's page ↗</a></>}
                    {look.filled.some((k) => look.sources?.[k] === "search") && <div className="muted">* from the AI's read of that page — worth a quick check.</div>}
                  </div>
                )}
              </div>
            )}
            {canLookup && (f.name || f.roaster) && !busy && (
              <button type="button" className="link" data-testid="lookup-online"
                onClick={() => lookup({ name: f.name || undefined, roaster: f.roaster || undefined, origin: f.origin || undefined, processMethod: f.processMethod || undefined, roastLevel: f.roastLevel || undefined })}>
                Look it up online — fill empty fields from the roaster's site
              </button>
            )}
          </section>
        )}
        {f.photo ? (
          <div className="photo-row">
            <img className="bag-photo" src={f.photo} alt="Bag photo" />
            <button className="link danger" onClick={() => set("photo", null)}>Remove photo</button>
          </div>
        ) : bag ? (
          <ImagePicker id="bf-attach" label="Photo (optional)" disabled={!!busy} onImage={(file) => fromPhoto(file, false)} />
        ) : null}
        <div className="grid2">{text("name", "Coffee / bean name")}{text("roaster", "Roaster")}</div>
        <div className="grid3">
          <ChoiceField id="bf-origin" label="Origin" value={f.origin} options={vocab.origins} onChange={(v) => set("origin", v)} />
          <ChoiceField id="bf-processMethod" label="Process" value={f.processMethod} options={vocab.processes} onChange={(v) => set("processMethod", v)} />
          <Field label="Roast level" htmlFor="bf-roastLevel">
            <select id="bf-roastLevel" value={f.roastLevel} onChange={(e) => set("roastLevel", e.target.value)}>
              <option value="">—</option>
              {vocab.roastLevels.map((l) => <option key={l.id} value={l.label}>{l.label}</option>)}
              {f.roastLevel && !vocab.roastLevels.some((l) => l.label === f.roastLevel) && <option value={f.roastLevel}>{f.roastLevel} (as entered)</option>}
            </select>
          </Field>
        </div>
        <TagInput id="bf-tags" label="Tasting notes" tags={f.tastingNotes} onChange={(t) => set("tastingNotes", t)}
          suggestions={[...new Set([...usedTags, ...vocab.tastingNotes])]} placeholder="e.g. strawberry, then Enter" />
        <div className="dates">
          {dateF("roastDate", "Roast date")}{dateF("purchaseDate", "Purchase date")}{dateF("openedDate", "Opened date")}{dateF("finishedDate", "Finished date")}
        </div>
        <div className="grid2">
          <Field label="Bag size (g)" htmlFor="bf-amount"><NumInput id="bf-amount" value={f.amountG} onChange={(n) => set("amountG", n)} min={limits?.amountG.min} max={limits?.amountG.max} decimals={0} /></Field>
          <Field label="Price ($)" htmlFor="bf-price"><NumInput id="bf-price" value={f.price} onChange={(n) => set("price", n)} min={limits?.price.min} max={limits?.price.max} decimals={2} /></Field>
        </div>
        {bag && f.amountG != null && (
          <Field label="Coffee left (g)" htmlFor="bf-left"
            hint={`${bag.usedG ? `${bag.usedG} g went into logged brews. ` : ""}Change it for coffee used without logging a brew; logged brews keep counting down from here.`}>
            <NumInput id="bf-left" value={left} onChange={setLeftTyped} min={0} max={f.amountG} decimals={1} />
          </Field>
        )}
        <Field label="Roaster / product link" htmlFor="bf-url"><input id="bf-url" type="url" value={f.url} onChange={(e) => set("url", e.target.value)} /></Field>
        <Field label="Rating"><Stars value={f.rating} onChange={(n) => set("rating", n)} /></Field>
        <Field label="Notes" htmlFor="bf-notes"><textarea id="bf-notes" rows={3} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
        <ErrorBox error={error} />
      </div>
    </FullScreen>
  );
}

const CUSTOM = "__custom";
/** A list to pick from, plus "Custom…" for your own words (a value not on the list shows as custom). */
function ChoiceField({ id, label, value, options, onChange }: { id: string; label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  const known = options.find((o) => o.toLowerCase() === value.trim().toLowerCase());
  const [custom, setCustom] = useState(Boolean(value.trim()) && !known);
  useEffect(() => {
    if (value.trim() && !known && options.length) setCustom(true);
  }, [options.length]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Field label={label} htmlFor={id}>
      <select id={id} value={custom ? CUSTOM : known ?? ""} onChange={(e) => {
        if (e.target.value === CUSTOM) { setCustom(true); if (known) onChange(""); }
        else { setCustom(false); onChange(e.target.value); }
      }}>
        <option value="">—</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
        <option value={CUSTOM}>Custom…</option>
      </select>
      {custom && <input id={`${id}-custom`} aria-label={`${label} (your own)`} value={value} onChange={(e) => onChange(e.target.value)} placeholder={`Your own ${label.toLowerCase()}`} />}
    </Field>
  );
}
