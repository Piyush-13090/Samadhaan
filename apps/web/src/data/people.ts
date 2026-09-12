import type { PersonSummary } from '@/types/domain';

/** Fixture people referenced by problems, comments and the leaderboard. */
export const PEOPLE = {
  priya: { id: 'usr-1', name: 'Priya Sharma' },
  arjun: { id: 'usr-2', name: 'Arjun Mehta' },
  fatima: { id: 'usr-3', name: 'Fatima Khan' },
  rahul: { id: 'usr-4', name: 'Rahul Verma' },
  sneha: { id: 'usr-5', name: 'Sneha Iyer' },
  vikram: {
    id: 'usr-6',
    name: 'Vikram Rao',
    organization: 'Clean City Foundation',
  },
  ananya: { id: 'usr-7', name: 'Ananya Das' },
  imran: { id: 'usr-8', name: 'Imran Sheikh' },
} as const satisfies Record<string, PersonSummary>;

/** The signed-in user for shell and dashboard previews. */
export const CURRENT_USER: PersonSummary = PEOPLE.priya;
