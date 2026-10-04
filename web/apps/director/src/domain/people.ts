/**
 * The Acme Logistics people directory for the org chart. The Gateway knows only the principals who
 * sign in (Maya, Daniel and Priya in the demo seed); everyone else here is a directory profile with
 * no Gateway identity. Who is a principal is read from Gateway data (domain/chats.ts principalIds),
 * matched by display name, which is the same in the live seed and the mock world.
 */
export interface Person {
  id: string;
  name: string;
  title: string;
  department: string;
  /** Who this person reports to; absent only for the chief executive. */
  manager?: string;
  /** Agent teams this person's department owns, for agents that run without a session. */
  teams?: string[];
  email: string;
  location: string;
}

const person = (id: string, name: string, title: string, department: string, extra: Partial<Person> = {}): Person => ({
  id,
  name,
  title,
  department,
  email: `${id.split('-')[0]}@acme-logistics.example`,
  location: 'Rotterdam',
  ...extra,
});

export const PEOPLE: Person[] = [
  person('helena-brooks', 'Helena Brooks', 'Chief Executive Officer', 'Executive', { location: 'Amsterdam' }),
  person('marcus-webb', 'Marcus Webb', 'Chief Financial Officer', 'Finance', { manager: 'helena-brooks', teams: ['finance'] }),
  person('maya-chen', 'Maya Chen', 'Finance Operations Lead', 'Finance', { manager: 'marcus-webb' }),
  person('sofia-alvarez', 'Sofia Alvarez', 'Accounts Payable Specialist', 'Finance', { manager: 'marcus-webb' }),
  person('james-okafor', 'James Okafor', 'Chief Operating Officer', 'Operations', { manager: 'helena-brooks', teams: ['support'] }),
  person('lena-fischer', 'Lena Fischer', 'Customer Support Lead', 'Operations', { manager: 'james-okafor', location: 'Hamburg' }),
  person('tom-nguyen', 'Tom Nguyen', 'Support Specialist', 'Operations', { manager: 'james-okafor' }),
  person('clara-rossi', 'Clara Rossi', 'HR Business Partner', 'Operations', { manager: 'james-okafor', location: 'Milan' }),
  person('grace-kim', 'Grace Kim', 'Chief Information Security Officer', 'Security', { manager: 'helena-brooks', teams: ['security'] }),
  person('daniel-ortiz', 'Daniel Ortiz', 'Security Officer', 'Security', { manager: 'grace-kim' }),
  person('aisha-rahman', 'Aisha Rahman', 'Chief Technology Officer', 'Technology', { manager: 'helena-brooks', teams: ['platform', 'workplace'] }),
  person('priya-raman', 'Priya Raman', 'Platform Administrator', 'Technology', { manager: 'aisha-rahman' }),
  person('ethan-park', 'Ethan Park', 'Site Reliability Engineer', 'Technology', { manager: 'aisha-rahman' }),
  person('samuel-adeyemi', 'Samuel Adeyemi', 'Workplace IT Lead', 'Technology', { manager: 'aisha-rahman' }),
  person('olivia-bennett', 'Olivia Bennett', 'Head of Strategy', 'Strategy', { manager: 'helena-brooks', teams: ['strategy'], location: 'London' }),
  person('noah-schmidt', 'Noah Schmidt', 'Market Analyst', 'Strategy', { manager: 'olivia-bennett', location: 'London' }),
];

const byId = new Map(PEOPLE.map((p) => [p.id, p]));
const byName = new Map(PEOPLE.map((p) => [p.name.toLowerCase(), p]));

export const personById = (id: string) => byId.get(id);
export const personByName = (name: string | undefined | null) => (name ? byName.get(name.trim().toLowerCase()) : undefined);
export const photoOf = (person: Person) => `/people/${person.id}.jpg`;
export const reportsOf = (id: string) => PEOPLE.filter((p) => p.manager === id);

/** The person whose department owns an agent team, for an agent with no session. */
export const ownerOfTeam = (team: string) => PEOPLE.find((p) => p.teams?.includes(team.toLowerCase()));
