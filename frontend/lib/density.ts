"use client";

import { useSyncExternalStore } from "react";
import { DENSITY_STORAGE_KEY } from "./density-script";

export type Density = "comfortable" | "compact";

const CHANGE_EVENT = "studyflow:density-changed";

export function readDensity(): Density {
  try {
    return window.localStorage.getItem(DENSITY_STORAGE_KEY) === "compact" ? "compact" : "comfortable";
  } catch {
    return "comfortable";
  }
}

function applyDensity(density: Density) {
  if (density === "compact") document.documentElement.dataset.density = "compact";
  else delete document.documentElement.dataset.density;
}

export function setDensity(density: Density) {
  try {
    window.localStorage.setItem(DENSITY_STORAGE_KEY, density);
  } catch {
    // Private mode or a full quota: the choice still applies to this visit.
  }
  applyDensity(density);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void) {
  // Another tab changed the setting: follow it here too.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== DENSITY_STORAGE_KEY) return;
    applyDensity(readDensity());
    onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function useDensity(): Density {
  return useSyncExternalStore(subscribe, readDensity, () => "comfortable");
}
