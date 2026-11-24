// Navigation icons: the main bar and the More list share them.
export const NAV_ICONS = {
  cup: "M4 8h13v5a6 6 0 0 1-6 6H10a6 6 0 0 1-6-6V8Zm13 1h1.5a2.5 2.5 0 0 1 0 5H17M8 2c0 1.5 1 1.5 1 3M12 2c0 1.5 1 1.5 1 3",
  bag: "M7 7V5a5 5 0 0 1 10 0v2M5 7h14l-1 14H6L5 7Z",
  log: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  compass: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm3.5-12.5-2 5-5 2 2-5 5-2Z",
  ruler: "M3 17 17 3l4 4L7 21l-4-4Zm4-4 2 2m1-5 2 2m1-5 2 2",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  drop: "M12 3s-6 6.6-6 11a6 6 0 0 0 12 0c0-4.4-6-11-6-11Z",
  calc: "M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm1 4h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h.01M12 19h4",
  sliders: "M4 6h9m4 0h3M4 12h3m4 0h9M4 18h11m4 0h1M15 4v4M9 10v4M17 16v4",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
};
export const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
