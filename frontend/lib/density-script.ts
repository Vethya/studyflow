/** Kept free of client-only imports so the server root layout can inline it. */
export const DENSITY_STORAGE_KEY = "studyflow-density";

/**
 * Inline script for the root layout, so a compact layout is applied before the
 * first paint instead of visibly snapping in after hydration.
 */
export const DENSITY_BOOT_SCRIPT = `try{if(localStorage.getItem("${DENSITY_STORAGE_KEY}")==="compact")document.documentElement.dataset.density="compact"}catch(e){}`;
