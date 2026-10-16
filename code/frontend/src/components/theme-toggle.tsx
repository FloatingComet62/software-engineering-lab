"use client";

import { useSyncExternalStore } from "react";

const key = "iseeitype-appearance";
function subscribe(update: () => void) {
  const sync = () => {
    try {
      document.documentElement.dataset.appearance =
        localStorage.getItem(key) === "light" ? "light" : "dark";
    } catch {
      /* Keep the current appearance if storage is unavailable. */
    }
    update();
  };
  window.addEventListener("storage", sync);
  window.addEventListener("appearance-change", update);
  return () => {
    window.removeEventListener("storage", sync);
    window.removeEventListener("appearance-change", update);
  };
}
export default function ThemeToggle() {
  const light = useSyncExternalStore(
    subscribe,
    () => document.documentElement.dataset.appearance === "light",
    () => false,
  );
  function toggle() {
    const next = light ? "dark" : "light";
    document.documentElement.dataset.appearance = next;
    try {
      localStorage.setItem(key, next);
    } catch {
      /* Switching still works without storage. */
    }
    window.dispatchEvent(new Event("appearance-change"));
  }
  return (
    <button
      type="button"
      className="appearance-toggle"
      aria-label={light ? "Switch to dark mode" : "Switch to light mode"}
      title={light ? "Switch to dark mode" : "Switch to light mode"}
      onClick={toggle}
    >
      <span aria-hidden="true">{light ? "☾" : "☀"}</span>
      {light ? "Dark mode" : "Light mode"}
    </button>
  );
}
