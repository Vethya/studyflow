/**
 * Single-key shortcuts must never fire while the user is typing or working
 * inside a dialog, menu or listbox — those own the keyboard.
 */
export function isShortcutBlocked(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return true;
  return target.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]') !== null;
}

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);
}
