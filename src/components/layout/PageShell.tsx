import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import ErrorBoundary from '@/components/ErrorBoundary';
import { ViewFilter } from './ViewFilter';

export default function PageShell() {
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
        <main id="main" className="flex-1 min-w-0 overflow-y-auto">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
