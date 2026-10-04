import type { IconName } from './components/icon.tsx';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  match: RegExp;
  /** What the place answers, for search. */
  hint: string;
  /**
   * The dock tile's gradient. Blues, cyans and greys only: green, red, amber, violet, pink and
   * orange mean outcomes everywhere else in the Director.
   */
  tint: [string, string];
}

export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Monitor',
    items: [
      { to: '/', label: 'Overview', icon: 'overview', match: /^\/$/, hint: 'Is anything wrong right now?', tint: ['#6a96ff', '#2f5bea'] },
      { to: '/activity', label: 'Activity', icon: 'activity', match: /^\/(activity|traces)/, hint: 'Every decision, newest first', tint: ['#3fd0f0', '#0a8bbd'] },
      { to: '/graph', label: 'Graph', icon: 'map', match: /^\/graph/, hint: 'Who touched what', tint: ['#8a93ff', '#4a4fd8'] },
    ],
  },
  {
    label: 'Organization',
    items: [
      { to: '/agents', label: 'Org chart', icon: 'network', match: /^\/agents/, hint: 'People and the agents they run', tint: ['#7d8fa8', '#34465f'] },
      { to: '/access', label: 'Access', icon: 'key', match: /^\/access/, hint: 'Grant and revoke what agents and people may do', tint: ['#5ab8e0', '#1d6fa5'] },
      { to: '/configuration', label: 'Configuration', icon: 'settings', match: /^\/configuration/, hint: 'Use cases, delegations, people and policies', tint: ['#9fb0c6', '#52627a'] },
    ],
  },
  {
    label: 'Assurance',
    items: [
      { to: '/determinism', label: 'Determinism', icon: 'cpu', match: /^\/determinism/, hint: 'Non-deterministic agents, deterministic decisions', tint: ['#4a5568', '#101828'] },
      { to: '/coverage', label: 'Coverage', icon: 'shield', match: /^\/coverage/, hint: 'OWASP agentic risks and evidence', tint: ['#5f8fd0', '#1f4f99'] },
      { to: '/guardrails', label: 'Guardrails', icon: 'shield-check', match: /^\/guardrails/, hint: 'Profiles, playground, threat feed, budgets', tint: ['#7c9cc4', '#2e4d78'] },
    ],
  },
];

export const NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);
