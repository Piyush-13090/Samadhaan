import type { OrganizationSummary } from '@/types/domain';

export const ORGANIZATIONS: OrganizationSummary[] = [
  {
    id: 'org-1',
    name: 'Clean City Foundation',
    kind: 'NGO',
    verified: true,
    focusAreas: ['Sanitation', 'Waste management', 'Drainage'],
    problemsResolved: 128,
    serviceArea: 'North & Central zones',
  },
  {
    id: 'org-2',
    name: 'Institute of Urban Systems',
    kind: 'UNIVERSITY',
    verified: true,
    focusAreas: ['Water systems', 'Urban research', 'Flood mapping'],
    problemsResolved: 41,
    serviceArea: 'City-wide',
  },
  {
    id: 'org-3',
    name: 'Meridian Infrastructure',
    kind: 'INDUSTRY',
    verified: true,
    focusAreas: ['Road repair', 'Street lighting'],
    problemsResolved: 76,
    serviceArea: 'Sectors 8–24',
  },
  {
    id: 'org-4',
    name: 'Ward 12 Municipal Office',
    kind: 'GOVERNMENT',
    verified: true,
    focusAreas: ['Allocation', 'Verification'],
    problemsResolved: 312,
    serviceArea: 'Ward 12',
  },
];
