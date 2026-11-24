import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Wordmark } from "./Logo";
import { DataProvider, BackButton, IconButton, fireAction, useEdgeSwipeBack, anyDialogOpen, useData } from "./ui";
import { Setup } from "./Setup";
import { RatioCalculator } from "./brew/RatioCalculator";
import type { ReactNode } from "react";
import { Recipes } from "./brew/Recipes";
import { Guide } from "./brew/Guide";
import { Stash } from "./brew/Stash";
import { BrewLog } from "./brew/BrewLog";
import { Gear } from "./brew/Gear";
import { Water } from "./brew/Water";
import { Insights } from "./insights/Insights";
import { Discover } from "./discover/Discover";
import { More, Settings } from "./More";
import { NAV_ICONS as I, Icon } from "./icons";
import { ScaleDialog, getActiveBrew, type ActiveBrew } from "./brew/ScaleDialog";

const DISCOVER_TABS = [
  { id: "board", label: "Board" },
  { id: "archive", label: "Past editions" },
  { id: "tastings", label: "Tasting log" },
  { id: "avoid", label: "Avoid list" },
  { id: "refresh", label: "Refresh" },
  { id: "taste", label: "Your taste" },
];
const BREW_TABS = ["recipes", "guide", "stash", "log", "gear", "water", "insights"];
/** Tabs that move into More when the bar has no room, first to go first. Touch tab bars always keep them in More. */
const OVERFLOW = ["insights", "water", "gear", "guide"];

function parseHash() {
  const [, section = "brew", tab = "", arg = ""] = (location.hash || "#/brew/recipes").split("/");
  if (section === "more") return { section: "more", tab: tab === "settings" ? "settings" : "", arg: "" };
  if (section === "discover") return { section, tab: DISCOVER_TABS.some((t) => t.id === tab) ? tab : "board", arg: decodeURIComponent(arg) };
  return { section: "brew", tab: BREW_TABS.includes(tab) ? tab : "recipes", arg: decodeURIComponent(arg) };
}

/**
 * Touch devices always get the bottom tab bar (phones, the iPhone Duo's wide inner screen,
 * tablets); only mouse/trackpad desktops get the top nav. Width alone can't tell a large
 * foldable from a laptop. Sets html.tabbar so CSS can switch the whole layout.
 */
const DESKTOP_QUERY = "(hover: hover) and (pointer: fine) and (min-width: 900px)";
function useTabbar() {
  const [tabbar, setTabbar] = useState(() => !window.matchMedia(DESKTOP_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    const on = () => setTabbar(!mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("tabbar", tabbar);
  }, [tabbar]);
  return tabbar;
}

/**
 * iOS home-screen apps can keep stale viewport dimensions after the screen changes size
 * (rotate, fold/unfold) until something forces a re-layout. Nudge one on every such event,
 * and again as iOS settles, and when the app comes back to the foreground.
 */
function useRelayoutOnResize() {
  useEffect(() => {
    const timers: number[] = [];
    const nudge = () => {
      const b = document.body;
      b.style.transform = "translateZ(0)";
      void b.offsetHeight; // force layout
      b.style.transform = "";
    };
    const schedule = () => {
      timers.splice(0).forEach(clearTimeout);
      requestAnimationFrame(nudge);
      [150, 500, 1200].forEach((ms) => timers.push(window.setTimeout(nudge, ms)));
    };
    const vis = () => document.visibilityState === "visible" && schedule();
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    document.addEventListener("visibilitychange", vis);
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      document.removeEventListener("visibilitychange", vis);
    };
  }, []);
}

export function App() {
  const tabbar = useTabbar();
  const [calc, setCalc] = useState(false);
  useRelayoutOnResize();
  const [route, setRoute] = useState(parseHash);
  const inAppNavs = useRef(0); // hash navigations this session — is there an in-app page to go back to?
  useEffect(() => {
    const on = () => {
      inAppNavs.current++;
      setRoute(parseHash());
      window.scrollTo(0, 0);
      document.querySelector("main")?.scrollTo(0, 0); // with the tab bar, <main> is the scroller
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const go = (section: string, tab: string, arg = "") => (location.hash = `#/${section}/${tab}${arg ? "/" + encodeURIComponent(arg) : ""}`);
  const editGrinder = (id: string) => go("brew", "gear", id);

  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  // A brew that was running when the app was closed (iOS kills backgrounded PWAs) reopens on launch.
  const [resume, setResume] = useState<ActiveBrew | null>(() => getActiveBrew());

  const [deskHidden, setDeskHidden] = useState<string[]>([]);
  const inMore = tabbar ? OVERFLOW : deskHidden; // tabs reached from More right now
  const NAV: NavItem[] = [
    { id: "recipes", href: "#/brew/recipes", label: "Recipes", icon: I.cup, on: route.section === "brew" && route.tab === "recipes" },
    { id: "guide", href: "#/brew/guide", label: "Guide", icon: I.ruler, on: route.tab === "guide" },
    { id: "stash", href: "#/brew/stash", label: "Stash", icon: I.bag, on: route.tab === "stash" },
    { id: "log", href: "#/brew/log", label: "Brew Log", short: "Log", icon: I.log, on: route.tab === "log" },
    { id: "gear", href: "#/brew/gear", label: "Gear", icon: I.gear, on: route.tab === "gear" },
    { id: "water", href: "#/brew/water", label: "Water", icon: I.drop, on: route.tab === "water" },
    { id: "insights", href: "#/brew/insights", label: "Insights", icon: I.chart, on: route.tab === "insights" },
    { id: "discover", href: "#/discover/board", label: "Discover", icon: I.compass, on: route.section === "discover" },
    { id: "more", href: "#/more", label: "More", icon: I.more, on: route.section === "more" || (route.section === "brew" && inMore.includes(route.tab)) },
  ];

  const nav = <MainNav items={NAV} hidden={inMore} measure={!tabbar} onFit={setDeskHidden} />;


  const TITLES: Record<string, string> = { recipes: "Recipes", guide: "Grind guide", stash: "Stash", log: "Brew Log", gear: "Gear", water: "Water", insights: "Insights" };
  const title = route.section === "discover" ? "Discover" : route.section === "more" ? (route.tab === "settings" ? "Settings" : "More") : TITLES[route.tab] ?? "Brewlab";
  // Sub-pages reached from More get a back button (and the left-edge swipe) on touch screens.
  // Settings is always reached from More, so it has one on desktop too.
  const subPage = (route.section === "brew" && inMore.includes(route.tab)) || (route.section === "more" && route.tab === "settings");
  const goBack = () => {
    if (inAppNavs.current > 0) history.back();
    else location.replace("#/more"); // opened directly (e.g. relaunch) — don't leave the app
  };
  useEdgeSwipeBack(() => {
    if (!anyDialogOpen()) goBack();
  }, subPage);
  // Title-bar actions come from the route alone (not registered by pages), so they're always there.
  const headerActions = (): ReactNode => {
    if (route.section !== "brew") return null;
    switch (route.tab) {
      case "recipes":
        return (
          <>
            <IconButton label="Ratio calculator" icon="calc" onClick={() => setCalc(true)} />
            <IconButton label="New recipe" icon="plus" primary onClick={() => fireAction("new-recipe")} />
          </>
        );
      case "stash":
        return <IconButton label="Add a bag" icon="plus" primary onClick={() => fireAction("add-bag")} />;
      case "log":
        return <IconButton label="Log a brew manually" icon="plus" primary onClick={() => fireAction("log-brew")} />;
      case "gear":
        return <IconButton label="Add gear" icon="plus" primary onClick={() => fireAction("add-gear")} />;
      case "water":
        return <IconButton label="Add water" icon="plus" primary onClick={() => fireAction("add-water")} />;
      default:
        return null;
    }
  };
  const pagebar = (
    <div className="pagebar">
      {subPage && <BackButton onClick={goBack} label="More" />}
      <h1>{title}</h1>
      <div className="head-actions">{headerActions()}</div>
    </div>
  );

  return (
    <DataProvider>
      <Gate>
      <div className="shell">
      {tabbar ? (
        <header className="top">{pagebar}</header>
      ) : (
        <>
          <header className="top">
            <a className="brand" href="#/brew/recipes" aria-label="Brewlab"><Wordmark height={30} /></a>
            {nav}
          </header>
          <div className="desk-pagebar">{pagebar}</div>
        </>
      )}
      {!online && <div className="offline" role="status">You're offline — Brewlab needs a connection to load or save your data.</div>}
      {route.section === "discover" && (
        <nav className="tabs" aria-label="Discover tabs">
          {DISCOVER_TABS.map((t) => (
            <a key={t.id} href={`#/discover/${t.id}`} className={route.tab === t.id ? "on" : ""} aria-current={route.tab === t.id ? "page" : undefined}>{t.label}</a>
          ))}
        </nav>
      )}
      <main>
        {route.section === "brew" && route.tab === "recipes" && <Recipes onEditGrinder={editGrinder} />}
        {route.section === "brew" && route.tab === "guide" && <Guide onEditGrinder={editGrinder} />}
        {route.section === "brew" && route.tab === "stash" && <Stash view={route.arg} />}
        {route.section === "brew" && route.tab === "log" && <BrewLog />}
        {route.section === "brew" && route.tab === "gear" && <Gear editId={route.arg || null} onEditDone={() => route.arg && go("brew", "gear")} />}
        {route.section === "brew" && route.tab === "water" && <Water />}
        {route.section === "brew" && route.tab === "insights" && <Insights />}
        {route.section === "discover" && <Discover tab={route.tab} />}
        {route.section === "more" && route.tab === "" && <More inMore={inMore} />}
        {route.section === "more" && route.tab === "settings" && <Settings />}
      </main>
      {tabbar && nav}
      </div>
      {calc && <RatioCalculator onClose={() => setCalc(false)} />}
      {resume && <ScaleDialog plan={resume.plan} resume={resume} onClose={() => setResume(null)} />}
      </Gate>
    </DataProvider>
  );
}

type NavItem = { id: string; href: string; label: string; short?: string; icon: string; on: boolean };
/**
 * Main navigation; Discover is hidden when turned off in Settings. On desktop it measures itself:
 * when the top bar has no room for every tab, OVERFLOW tabs move into More (onFit), first ones first.
 * A hidden copy with every tab gives the widths, so the check doesn't depend on what's shown.
 */
function MainNav({ items, hidden, measure, onFit }: { items: NavItem[]; hidden: string[]; measure: boolean; onFit: (ids: string[]) => void }) {
  const { settings } = useData();
  const all = items.filter((n) => settings.discoverEnabled || n.id !== "discover");
  const box = useRef<HTMLElement>(null);
  const ruler = useRef<HTMLDivElement>(null);
  const key = all.map((n) => n.id).join();
  useLayoutEffect(() => {
    if (!measure) return;
    const fit = () => {
      if (!box.current || !ruler.current) return;
      const room = box.current.clientWidth;
      const gap = parseFloat(getComputedStyle(ruler.current).columnGap) || 0;
      const widths = new Map([...ruler.current.children].map((el) => [(el as HTMLElement).dataset.id!, (el as HTMLElement).getBoundingClientRect().width]));
      let total = [...widths.values()].reduce((a, w) => a + w + gap, -gap);
      const out: string[] = [];
      for (const id of OVERFLOW) {
        if (total <= room + 0.5) break;
        if (!widths.has(id)) continue;
        out.push(id);
        total -= widths.get(id)! + gap;
      }
      onFit(out);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box.current!);
    document.fonts?.ready.then(fit).catch(() => {});
    return () => ro.disconnect();
  }, [measure, key]); // eslint-disable-line react-hooks/exhaustive-deps
  const link = (n: NavItem, live: boolean) => (
    <a key={n.id} href={n.href} data-id={n.id} className={n.on && live ? "on" : ""} aria-current={n.on && live ? "page" : undefined} tabIndex={live ? undefined : -1}>
      <span className="ico"><Icon d={n.icon} /></span>
      <span className="lbl">{n.short ?? n.label}</span>
    </a>
  );
  return (
    <nav className="nav" aria-label="Main" ref={box}>
      {all.filter((n) => !hidden.includes(n.id)).map((n) => link(n, true))}
      {measure && <div className="nav-ruler" ref={ruler} aria-hidden="true" {...{ inert: "" }}>{all.map((n) => link(n, false))}</div>}
    </nav>
  );
}

/** First-run setup until it's finished or skipped; then the app. */
function Gate({ children }: { children: ReactNode }) {
  const { setup } = useData();
  if (!setup) return <div className="shell"><main><p className="muted" style={{ padding: 24 }}>Loading…</p></main></div>;
  if (!setup.onboarded) return <Setup />;
  return <>{children}</>;
}
