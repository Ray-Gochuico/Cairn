import { useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import TourOverlay from './TourOverlay';
import ErrorBoundary from '@/components/ErrorBoundary';
import { ViewFilter } from './ViewFilter';
import { usePersonsStore } from '@/stores/persons-store';
import { documentTitleFor } from '@/lib/route-titles';

/*
 * Layout floor (Wave 11 T19): the desktop window enforces 1024×700
 * (tauri.conf.json windows[0].minWidth/minHeight). The permanent w-56 sidebar
 * is a deliberate consequence — do NOT add responsive collapse for the app
 * shell. Narrower viewports exist only in the browser-shim dev/e2e build, which
 * must degrade without horizontal BODY scroll (wide tables scroll inside
 * overflow-x-auto).
 */

export default function PageShell() {
  // Load persons ONCE at the shell level so the per-person view filter is
  // reliably available app-wide (Frontend M3). PageShell wraps every routed
  // page via <Outlet>, so this covers deep-links into pages that don't load
  // persons in their own effect — previously those pages left `useViewFilter`
  // reading an empty list, which silently hid the household/p1/p2/joint filter
  // in the header. The store's load() is in-flight de-duped and a no-op once
  // resolved, so this is a single DB round-trip regardless of navigation.
  const loadPersons = usePersonsStore((s) => s.load);
  useEffect(() => {
    void loadPersons();
  }, [loadPersons]);

  // Wave-4 a11y: SPA navigations are silent for AT without this — set the
  // tab title per route and move focus onto the <main> landmark so screen
  // readers announce "<title>, main". We focus <main> (not the page h1):
  // routes are lazy chunks, so on pathname-change the new h1 may not exist
  // yet. Skipped on first render (initial focus belongs to the document).
  const location = useLocation();
  const mainRef = useRef<HTMLElement | null>(null);
  const firstRenderRef = useRef(true);
  useEffect(() => {
    document.title = documentTitleFor(location.pathname);
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }
    mainRef.current?.focus();
  }, [location.pathname]);

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {/*
       * Skip-to-main-content link (Wave-5 frontend A+ #1). Visually hidden
       * until keyboard focus lands on it (Tab from the address bar at page
       * load), then it pops into view at the top-left so keyboard users can
       * bypass the sidebar nav and the view-filter header to jump straight
       * to the page body. Standard a11y pattern; targets the <main id="main">
       * landmark below.
       */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-md focus:border focus:bg-background focus:px-3 focus:py-1.5 focus:text-sm focus:shadow-md focus:outline-none focus:ring-2 focus:ring-ring"
      >
        Skip to main content
      </a>
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="flex justify-end items-center px-6 py-2 border-b border-border min-h-[44px]">
          <ViewFilter />
        </header>
        {/* tabIndex={-1}: programmatically focusable for the route-change
            effect above AND makes the #main skip-link actually move focus
            in WebKit. outline-none — this focus is programmatic context,
            not a visible tab stop. */}
        <main id="main" ref={mainRef} tabIndex={-1} className="flex-1 min-w-0 overflow-y-auto outline-none">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
      <TourOverlay />
    </div>
  );
}
