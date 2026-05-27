import { Link, useNavigate, useRouteError } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Friendly 404 + render-error page. Used as the root `errorElement` in
 * `src/App.tsx`, replacing react-router's default "Hey developer 👋"
 * message that was leaking out to end users.
 *
 * react-router calls this for both unmatched routes (404) and any
 * uncaught render errors from descendant routes. We display the same
 * friendly copy in either case — the per-component ErrorBoundary in
 * `PageShell` still catches in-page render errors first, so this is
 * mostly the 404 surface in practice.
 */
export default function NotFound() {
  const navigate = useNavigate();
  const error = useRouteError();
  const isDev = import.meta.env.DEV;

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background text-foreground">
      <Card className="max-w-md w-full">
        <CardContent className="py-10 px-6 space-y-4 text-center">
          <Compass
            className="h-16 w-16 mx-auto text-muted-foreground"
            aria-hidden="true"
          />
          <h1 className="text-2xl font-semibold">We couldn&apos;t find that page</h1>
          <p className="text-sm text-muted-foreground">
            The link may be out of date, or the page has moved. Head back to your
            Dashboard and try again.
          </p>
          <div className="flex items-center justify-center gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => navigate(-1)}>
              Go back
            </Button>
            <Button asChild>
              <Link to="/">Go to Dashboard</Link>
            </Button>
          </div>
          {isDev && error ? (
            <details className="text-left text-xs text-muted-foreground mt-4">
              <summary className="cursor-pointer">Developer details</summary>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap">
                {error instanceof Error
                  ? `${error.message}\n\n${error.stack ?? ''}`
                  : JSON.stringify(error, null, 2)}
              </pre>
            </details>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
