import { useEffect, useState } from 'react';

/**
 * Round-3 cleanup (Settings TOC): true once the URL fragment targets
 * `sectionId`. Internally-collapsible sections OR this into their open
 * state so a TOC/deep-link jump doesn't land on a collapsed card.
 *
 * Reads `window.location.hash` on mount (routers that don't fire
 * `hashchange` for the initial navigation) AND listens for `hashchange`
 * (native anchor jumps like the Settings TOC links).
 */
export function useExpandOnAnchor(sectionId: string): boolean {
  const target = `#${sectionId}`;
  const [anchored, setAnchored] = useState(
    () => typeof window !== 'undefined' && window.location.hash === target,
  );

  useEffect(() => {
    const onHash = () => {
      if (window.location.hash === target) setAnchored(true);
    };
    onHash();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [target]);

  return anchored;
}
