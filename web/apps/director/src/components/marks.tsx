import type { LifecycleState } from '@betsee/api';
import { Icon } from '@betsee/ui';
import { initials } from '../domain/format.ts';

/** Humans are always circles with initials; agents are always rounded squares (contract 10.2). */
export function HumanAvatar({ name, size = 'sm' }: { name: string; size?: 'xs' | 'sm' | 'md' }) {
  const box = { xs: 'h-5 w-5 text-[length:var(--bs-font-size-2xs)]', sm: 'h-6 w-6 text-2xs', md: 'h-8 w-8 text-xs' }[size];
  return (
    <span aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center rounded-pill bg-surface-3 font-semibold text-fg-secondary ${box}`}>
      {initials(name)}
    </span>
  );
}

export function AgentMark({ state = 'active', size = 'md', className = '' }: { state?: LifecycleState; size?: 'sm' | 'md'; className?: string }) {
  const box = size === 'md' ? 'h-8 w-8' : 'h-6 w-6';
  const tone = state === 'active' ? 'text-accent-text' : state === 'quarantined' ? 'text-quarantined-fg' : 'text-suspended-fg';
  return (
    <span aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center rounded-sm bg-surface-3 ${box} ${tone} ${className}`}>
      <Icon name="streamline-flex:ai-chip-robot" size={size === 'md' ? 16 : 14} />
    </span>
  );
}
