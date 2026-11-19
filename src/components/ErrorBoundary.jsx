import React from 'react';
import Icon from './Icon';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an unhandled rendering error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          data-testid="error-boundary-fallback"
          className="p-8 rounded-2xl bg-white dark:bg-slate-800 border border-red-200 dark:border-red-800 shadow-sm space-y-4 my-6"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-950/60 flex items-center justify-center text-red-600 shrink-0">
              <Icon name="alert-triangle" className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                {this.props.title || 'Dashboard Section Error'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                An unexpected rendering error occurred in this view. Your session and operational data remain safe.
              </p>
            </div>
          </div>
          <div className="p-3.5 rounded-xl bg-red-50/50 dark:bg-slate-900/50 border border-red-100 dark:border-red-900/40 text-xs font-mono text-red-700 dark:text-red-300">
            {this.state.error?.message || 'Unknown runtime error.'}
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                if (this.props.onReset) this.props.onReset();
              }}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition-colors cursor-pointer"
            >
              Reload View
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
