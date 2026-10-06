import type {
  OrganizationDashboard,
  OrganizationMemberSummary,
  OrganizationProblemItem,
  OrganizationProblemPage,
  OrganizationWorkspace,
  RecommendationItem,
  WorkspacePermissions,
} from '@samadhaan/shared';

/** Fixtures for the organisation workspace, shaped exactly like the API's. */

export const OWNER_PERMISSIONS: WorkspacePermissions = {
  canEditProfile: true,
  canManageExpertise: true,
  canManageMembers: true,
  assignableRoles: ['OWNER', 'ADMIN', 'MEMBER'],
};

export const ADMIN_PERMISSIONS: WorkspacePermissions = {
  ...OWNER_PERMISSIONS,
  assignableRoles: ['ADMIN', 'MEMBER'],
};

export const MEMBER_PERMISSIONS: WorkspacePermissions = {
  canEditProfile: false,
  canManageExpertise: false,
  canManageMembers: false,
  assignableRoles: [],
};

export function problemItem(
  overrides: Partial<OrganizationProblemItem> = {},
): OrganizationProblemItem {
  return {
    publicId: 'SAM-1023',
    title: 'Large pothole causing traffic disruption',
    category: 'POTHOLES',
    subcategory: 'Road surface failure',
    status: 'SUBMITTED',
    severity: 'HIGH',
    urgency: 'HIGH',
    area: 'Sector 48',
    city: 'Gurugram',
    distanceMeters: 2300,
    voteCount: 124,
    commentCount: 3,
    thumbnailUrl: null,
    createdAt: '2026-10-04T00:00:00.000Z',
    hasAiAnalysis: true,
    isOwnReport: false,
    supportedByCurrentUser: false,
    followedByCurrentUser: false,
    relevance: {
      reasons: ['EXPERTISE_MATCH', 'IN_SERVICE_AREA'],
      expertiseLevel: 'SPECIALIST',
    },
    ai: {
      category: 'ROADS',
      subcategory: 'Potholes',
      severity: 'HIGH',
      confidence: 0.94,
    },
    ...overrides,
  };
}

export function recommendationItem(
  overrides: Partial<RecommendationItem> = {},
  match: Partial<RecommendationItem['match']> = {},
): RecommendationItem {
  return {
    ...problemItem(),
    match: {
      relevance: 0.92,
      rank: 1,
      status: 'CALCULATED',
      signals: {
        semantic: 0.88,
        expertise: 1,
        category: 1,
        geographic: 0.9,
        capability: 0.6,
        activity: 0.5,
      },
      reasons: [
        { code: 'EXPERTISE_STRONG', value: 1 },
        { code: 'WITHIN_SERVICE_AREA', value: 2400 },
      ],
      matchedExpertise: [
        { category: 'ROADS', subcategory: 'Road infrastructure', level: 'SPECIALIST' },
      ],
      computedAt: '2026-10-07T00:00:00.000Z',
      ...match,
    },
    ...overrides,
  };
}

export function problemPage(
  items: OrganizationProblemItem[],
  overrides: Partial<OrganizationProblemPage> = {},
): OrganizationProblemPage {
  return {
    items,
    page: 1,
    limit: 12,
    totalCount: items.length,
    totalPages: 1,
    origin: { kind: 'organization', radiusMeters: null },
    ...overrides,
  };
}

export function workspaceFixture(
  overrides: Partial<OrganizationWorkspace> = {},
): OrganizationWorkspace {
  return {
    organization: {
      id: 'org-1',
      name: 'Samadhaan Foundation',
      slug: 'samadhaan-foundation',
      type: 'NGO',
      description: 'Drainage and sanitation across the northern wards.',
      logoUrl: null,
      websiteUrl: 'https://example.org',
      email: 'contact@example.org',
      phone: null,
      address: null,
      location: { city: 'Gurugram', state: 'Haryana', country: 'India' },
      verificationStatus: 'VERIFIED',
      verifiedAt: null,
      memberCount: 3,
      expertise: [
        {
          id: 'e1',
          category: 'DRAINAGE',
          subcategory: 'Stormwater drainage',
          level: 'SPECIALIST',
          createdAt: '2026-09-01T00:00:00.000Z',
        },
      ],
      createdAt: '2026-09-01T00:00:00.000Z',
    },
    membership: {
      id: 'm-owner',
      membershipRole: 'OWNER',
      joinedAt: '2026-09-01T00:00:00.000Z',
    },
    permissions: OWNER_PERMISSIONS,
    coordinates: { latitude: 28.4595, longitude: 77.0266 },
    ...overrides,
  };
}

export function member(
  id: string,
  name: string,
  role: OrganizationMemberSummary['membershipRole'],
  status: OrganizationMemberSummary['status'] = 'ACTIVE',
): OrganizationMemberSummary {
  return {
    id,
    membershipRole: role,
    status,
    joinedAt: status === 'INVITED' ? null : '2026-09-01T00:00:00.000Z',
    user: {
      id: `u-${id}`,
      fullName: name,
      displayName: null,
      avatarUrl: null,
      role: 'NGO',
    },
  };
}

export function dashboardFixture(
  overrides: Partial<OrganizationDashboard> = {},
): OrganizationDashboard {
  return {
    viewer: { firstName: 'Aarav', membershipRole: 'OWNER' },
    metrics: {
      opportunities: 17,
      newOpportunities: 4,
      problemsSupportedByTeam: 9,
      suggestionsMade: 2,
      suggestionsAccepted: 1,
      teamMembers: 3,
      pendingInvitations: 1,
      pendingAllocations: 0,
      activeAssignments: 0,
      openRooms: 0,
    },
    projects: [],
    opportunitiesByCategory: [
      { category: 'DRAINAGE', count: 11 },
      { category: 'WATER', count: 6 },
    ],
    relevantProblems: [problemItem()],
    recommendations: { total: 0, items: [] },
    recentProblems: [
      problemItem({ publicId: 'SAM-2001', title: 'Streetlight out on MG Road' }),
    ],
    teamSummary: {
      total: 3,
      byRole: { OWNER: 1, ADMIN: 1, MEMBER: 1 },
      recentMembers: [member('m1', 'Aarav Sharma', 'OWNER')],
    },
    setup: { hasExpertise: true, hasLocation: true },
    ...overrides,
  };
}
