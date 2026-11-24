import { useEffect, useRef, useState } from "react";
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
import { Discover } from "./discover/Discover";
import { More } from "./More";
import { ScaleDialog, getActiveBrew, type ActiveBrew } from "./brew/ScaleDialog";

const DISCOVER_TABS = [
  { id: "board", label: "Board" },
  { id: "archive", label: "Past editions" },
  { id: "tastings", label: "Tasting log" },
  { id: "avoid", label: "Avoid list" },
  { id: "refresh", label: "Refresh" },
  { id: "taste", label: "Your taste" },
];
const BREW_TABS = ["recipes", "guide", "stash", "log", "gear", "water"];

function parseHash() {
  const [, section = "brew", tab = "", arg = ""] = (location.hash || "#/brew/recipes").split("/");
  if (section === "more") return { section: "more", tab: "", arg: "" };
  if (section === "discover") return { section, tab: DISCOVER_TABS.some((t) => t.id === tab) ? tab : "board", arg: decodeURIComponent(arg) };
  return { section: "brew", tab: BREW_TABS.includes(tab) ? tab : "recipes", arg: decodeURIComponent(arg) };
}

const I = {
  cup: "M4 8h13v5a6 6 0 0 1-6 6H10a6 6 0 0 1-6-6V8Zm13 1h1.5a2.5 2.5 0 0 1 0 5H17M8 2c0 1.5 1 1.5 1 3M12 2c0 1.5 1 1.5 1 3",
  bag: "M7 7V5a5 5 0 0 1 10 0v2M5 7h14l-1 14H6L5 7Z",
  log: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  compass: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm3.5-12.5-2 5-5 2 2-5 5-2Z",
  ruler: "M3 17 17 3l4 4L7 21l-4-4Zm4-4 2 2m1-5 2 2m1-5 2 2",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  drop: "M12 3s-6 6.6-6 11a6 6 0 0 0 12 0c0-4.4-6-11-6-11Z",
};
const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);

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

  const NAV = [
    { href: "#/brew/recipes", label: "Recipes", icon: I.cup, on: route.section === "brew" && route.tab === "recipes" },
    { href: "#/brew/guide", label: "Guide", icon: I.ruler, on: route.tab === "guide", desk: true },
    { href: "#/brew/stash", label: "Stash", icon: I.bag, on: route.tab === "stash" },
    { href: "#/brew/log", label: "Brew Log", short: "Log", icon: I.log, on: route.tab === "log" },
    { href: "#/brew/gear", label: "Gear", icon: I.gear, on: route.tab === "gear", desk: true },
    { href: "#/brew/water", label: "Water", icon: I.drop, on: route.tab === "water", desk: true },
    { href: "#/discover/board", label: "Discover", icon: I.compass, on: route.section === "discover" },
    { href: "#/more", label: "More", icon: I.more, on: route.section === "more" || (tabbar && (route.tab === "guide" || route.tab === "gear" || route.tab === "water")) },
  ];

  const nav = <MainNav items={NAV} />;


  const TITLES: Record<string, string> = { recipes: "Recipes", guide: "Grind guide", stash: "Stash", log: "Brew Log", gear: "Gear", water: "Water" };
  const title = route.section === "discover" ? "Discover" : route.section === "more" ? "More" : TITLES[route.tab] ?? "Brewlab";
  // Sub-pages reached from More get a back button (and the left-edge swipe) on touch screens.
  const subPage = tabbar && route.section === "brew" && (route.tab === "guide" || route.tab === "gear" || route.tab === "water");
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
        {route.section === "brew" && route.tab === "stash" && <Stash />}
        {route.section === "brew" && route.tab === "log" && <BrewLog />}
        {route.section === "brew" && route.tab === "gear" && <Gear editId={route.arg || null} onEditDone={() => route.arg && go("brew", "gear")} />}
        {route.section === "brew" && route.tab === "water" && <Water />}
        {route.section === "discover" && <Discover tab={route.tab} />}
        {route.section === "more" && <More />}
      </main>
      {tabbar && nav}
      </div>
      {calc && <RatioCalculator onClose={() => setCalc(false)} />}
      {resume && <ScaleDialog plan={resume.plan} resume={resume} onClose={() => setResume(null)} />}
      </Gate>
    </DataProvider>
  );
}

type NavItem = { href: string; label: string; short?: string; icon: string; on: boolean; desk?: boolean };
/** Main navigation; Discover is hidden when turned off in Settings. */
function MainNav({ items }: { items: NavItem[] }) {
  const { settings } = useData();
  return (
    <nav className="nav" aria-label="Main">
      {items.filter((n) => settings.discoverEnabled || !n.href.startsWith("#/discover")).map((n) => (
        <a key={n.href} href={n.href} className={`${n.on ? "on" : ""} ${n.desk ? "desk-only" : ""}`} aria-current={n.on ? "page" : undefined}>
          <span className="ico"><Icon d={n.icon} /></span>
          <span className="lbl">{n.short ?? n.label}</span>
        </a>
      ))}
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
