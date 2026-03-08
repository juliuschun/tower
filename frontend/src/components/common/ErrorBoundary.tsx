import React, { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallbackLabel?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div role="alert" className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
          <div className="text-red-400 text-lg font-semibold">
            {this.props.fallbackLabel || 'Something went wrong'}
          </div>
          <details className="text-xs text-gray-500 max-w-md">
            <summary className="cursor-pointer hover:text-gray-400 transition-colors">Error details</summary>
            <pre className="mt-2 p-2 bg-surface-900 rounded text-left overflow-auto break-all max-h-32">
              {this.state.error?.message}
            </pre>
          </details>
          <button
            onClick={this.handleReset}
            className="mt-2 px-4 py-1.5 text-xs font-medium text-white bg-primary-600 hover:bg-primary-500 rounded-lg transition-colors cursor-pointer"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
