import React from 'react';

type Props = { children: React.ReactNode };
type State = { hasError: boolean; error?: any };

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, info: any) {
    try {
      (window as any).__LAST_ERROR__ = { error: String(error?.message || error), info };
      console.error('App error boundary caught:', error, info);
    } catch {}
  }

  handleReload = () => {
    try { sessionStorage.setItem('app_last_error', JSON.stringify((window as any).__LAST_ERROR__ || {})); } catch {}
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-white px-4">
          <div className="max-w-sm text-center">
            <h1 className="text-lg font-semibold text-slate-800">Something went wrong</h1>
            <p className="mt-2 text-sm text-slate-600">Please refresh the page. If the issue persists, contact support.</p>
            <button
              className="mt-4 inline-flex items-center rounded-md border px-3 py-1.5 text-sm bg-slate-50 hover:bg-slate-100"
              onClick={this.handleReload}
              type="button"
            >
              Reload
            </button>
            {import.meta.env.DEV && this.state.error ? (
              <pre className="mt-4 text-left text-xs whitespace-pre-wrap break-words text-rose-700 bg-rose-50 p-3 rounded-md border border-rose-200">
                {String(this.state.error?.message || this.state.error)}
              </pre>
            ) : null}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
