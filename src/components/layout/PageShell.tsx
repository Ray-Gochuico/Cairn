import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import ErrorBoundary from '@/components/ErrorBoundary';
import { ViewFilter } from './ViewFilter';

export default function PageShell() {
  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="flex justify-end items-center px-6 py-2 border-b border-border min-h-[44px]">
          <ViewFilter />
        </header>
        <main className="flex-1 min-w-0 overflow-y-auto">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
