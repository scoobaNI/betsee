import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorCard } from './ui.tsx';

/** Keeps one failing component from blanking the Director on stage; Retry remounts the tree. */
export class ErrorBoundary extends Component<{ children: ReactNode; title?: string }, { error: unknown; key: number }> {
  state = { error: null as unknown, key: 0 };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Director view failed', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="py-6">
          <ErrorCard
            title={this.props.title ?? 'This view failed to render'}
            error={this.state.error}
            onRetry={() => this.setState((s) => ({ error: null, key: s.key + 1 }))}
          />
        </div>
      );
    }
    return <div key={this.state.key} className="contents">{this.props.children}</div>;
  }
}
