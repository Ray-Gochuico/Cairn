import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: string | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): State {
    return { error, info: null };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }): void {
    this.setState({ error, info: info.componentStack ?? null });
    console.error('[ErrorBoundary]', error, info);
  }

  reset = () => this.setState({ error: null, info: null });

  render() {
    if (this.state.error) {
      return (
        <div className="p-6 max-w-3xl">
          <h1 className="text-2xl font-semibold text-destructive mb-2">Something broke</h1>
          <p className="text-sm text-muted-foreground mb-4">
            A render error was caught. The details below should make it debuggable.
          </p>
          <pre className="bg-muted text-xs p-3 rounded overflow-auto whitespace-pre-wrap">
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
            {this.state.info && '\n\nComponent stack:' + this.state.info}
          </pre>
          <button
            type="button"
            className="mt-4 px-3 py-1.5 rounded bg-primary text-primary-foreground text-sm"
            onClick={this.reset}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
