import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import ErrorBoundary from '@/components/ErrorBoundary';

export default function PageShell() {
  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar />
      <main className="flex-1 min-w-0 overflow-y-auto">
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  );
}
