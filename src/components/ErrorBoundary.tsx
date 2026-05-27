import { Component, type ReactNode } from 'react';
import { Frown } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: string | null;
  showDetails: boolean;
  copyState: 'idle' | 'copied' | 'failed';
}

/**
 * App-wide error boundary mounted around the routed `<Outlet />` in
 * `PageShell`. Catches render errors in any descendant page so the app
 * never goes white.
 *
 * Two-mode UI:
 *   - Production: friendly "Something didn't load right" copy with
 *     Try-again / Reload / Copy details buttons. Raw stack trace is
 *     hidden behind a "Show technical details" disclosure so a non-
 *     developer friend doesn't see scary text. The "Copy details"
 *     button lets the user grab the stack to email the developer.
 *   - Development (`import.meta.env.DEV === true`): the stack is
 *     visible inline immediately — preserving the prior debug-friendly
 *     workflow for the developer.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null, showDetails: false, copyState: 'idle' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error, info: null };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }): void {
    this.setState({ error, info: info.componentStack ?? null });
    console.error('[ErrorBoundary]', error, info);
  }

  reset = () => this.setState({ error: null, info: null, showDetails: false, copyState: 'idle' });

  reload = () => {
    // Hard reload — abandons React state entirely. Friendlier than the
    // user staring at a broken render boundary after pressing "Try again"
    // and seeing the same error pop.
    if (typeof window !== 'undefined') window.location.reload();
  };

  toggleDetails = () => this.setState((s) => ({ showDetails: !s.showDetails }));

  copyDetails = async () => {
    const { error, info } = this.state;
    if (!error) return;
    const payload = [
      `Error: ${error.message}`,
      '',
      'Stack:',
      error.stack ?? '(no stack)',
      info ? '\nComponent stack:' + info : '',
    ].join('\n');
    try {
      if (
        typeof navigator !== 'undefined' &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === 'function'
      ) {
        await navigator.clipboard.writeText(payload);
        this.setState({ copyState: 'copied' });
        setTimeout(() => this.setState({ copyState: 'idle' }), 2000);
      } else {
        this.setState({ copyState: 'failed' });
      }
    } catch {
      this.setState({ copyState: 'failed' });
    }
  };

  render() {
    if (!this.state.error) return this.props.children;

    const isDev = import.meta.env.DEV;
    const { error, info, showDetails, copyState } = this.state;
    const stackBlock = (
      <pre
        data-testid="error-boundary-stack"
        className="bg-muted text-xs p-3 rounded overflow-auto whitespace-pre-wrap max-h-72"
      >
        {error.message}
        {'\n\n'}
        {error.stack}
        {info && '\n\nComponent stack:' + info}
      </pre>
    );

    if (isDev) {
      // Dev path: keep the stack visible inline (the prior behavior the
      // developer relied on). Friendly framing on top so dev still gets
      // muscle-memory of how the production UI feels.
      return (
        <div className="p-6 max-w-3xl" role="alert" data-testid="error-boundary-dev">
          <h1 className="text-2xl font-semibold text-destructive mb-2">Something broke</h1>
          <p className="text-sm text-muted-foreground mb-4">
            A render error was caught. The stack below is visible because the
            app is running in development mode.
          </p>
          {stackBlock}
          <div className="mt-4 flex gap-2">
            <Button type="button" onClick={this.reset}>
              Try again
            </Button>
            <Button type="button" variant="outline" onClick={this.reload}>
              Reload app
            </Button>
          </div>
        </div>
      );
    }

    // Production path: friendly copy, stack hidden behind a disclosure.
    return (
      <div
        className="p-6 max-w-2xl mx-auto mt-12"
        role="alert"
        data-testid="error-boundary-prod"
      >
        <div className="rounded-lg border bg-card text-card-foreground p-6 shadow-sm space-y-4">
          <div className="flex items-start gap-3">
            <Frown
              className="h-8 w-8 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-semibold">Something didn&apos;t load right</h1>
              <p className="text-sm text-muted-foreground mt-1">
                The app hit an unexpected error. Your data is safe — it&apos;s
                stored locally. Try again, or reload the app if the problem
                sticks around.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={this.reset}>
              Try again
            </Button>
            <Button type="button" variant="outline" onClick={this.reload}>
              Reload app
            </Button>
            <Button type="button" variant="ghost" onClick={this.toggleDetails}>
              {showDetails ? 'Hide technical details' : 'Show technical details'}
            </Button>
          </div>

          {showDetails && (
            <div className="space-y-2">
              {stackBlock}
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={this.copyDetails}
                >
                  Copy error details
                </Button>
                <span
                  className="text-xs text-muted-foreground transition-opacity"
                  style={{ opacity: copyState === 'idle' ? 0 : 1 }}
                  aria-live="polite"
                >
                  {copyState === 'copied'
                    ? 'Copied to clipboard'
                    : copyState === 'failed'
                      ? 'Copy failed — select the text manually'
                      : ''}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }
}
