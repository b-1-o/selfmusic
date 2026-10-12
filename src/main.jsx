import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.warn("SelfMusic service worker could not be registered:", error);
    });
  });
}

/**
 * Keep SelfMusic's player UI at a fixed scale. Prevent browser zoom shortcuts
 * and cancellable touch/trackpad gestures. Browser chrome overrides stay outside
 * a webpage's control.
 */
const preventBrowserZoom = (event) => {
  if (event.cancelable) event.preventDefault();
};

for (const eventName of ["gesturestart", "gesturechange", "gestureend"]) {
  document.addEventListener(eventName, preventBrowserZoom, { passive: false, capture: true });
}

document.addEventListener("touchmove", (event) => {
  if (event.touches && event.touches.length > 1) preventBrowserZoom(event);
}, { passive: false, capture: true });

document.addEventListener("wheel", (event) => {
  if (event.ctrlKey || event.metaKey) preventBrowserZoom(event);
}, { passive: false, capture: true });

document.addEventListener("keydown", (event) => {
  if (!(event.ctrlKey || event.metaKey)) return;
  const zoomKeys = new Set(["+", "=", "-", "_", "0"]);
  const zoomCodes = new Set(["NumpadAdd", "NumpadSubtract", "Numpad0"]);
  if (zoomKeys.has(event.key) || zoomCodes.has(event.code)) preventBrowserZoom(event);
}, { capture: true });
