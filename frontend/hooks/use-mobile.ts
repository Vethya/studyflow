import * as React from "react"

const MOBILE_BREAKPOINT = 768
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

/**
 * Reads the viewport width as an external store rather than mirroring it into
 * state from an effect, so the first client render already has the right answer
 * instead of flashing the desktop layout.
 */
export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    // The server has no viewport; assume desktop, matching the previous
    // `undefined` default once it was coerced with `!!`.
    () => false,
  )
}
