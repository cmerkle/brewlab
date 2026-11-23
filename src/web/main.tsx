import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<App />);

// Service worker: browsers only allow it in a secure context (HTTPS or localhost).
// Over plain http on the LAN the app still works — it just isn't offline-capable.
if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("Service worker registration failed:", e));
  });
}
