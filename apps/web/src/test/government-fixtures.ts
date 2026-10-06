import type {
  AllocationCandidate,
  GovernmentAllocationPanel,
  GovernmentAllocationView,
  GovernmentContext,
  GovernmentDashboard,
  GovernmentProblemDetail,
  GovernmentQueueItem,
} from '@samadhaan/shared';

export function governmentContext(
  overrides: Partial<GovernmentContext> = {},
): GovernmentContext {
  return {
    organization: {
      id: 'gov-1',
      slug: 'gurgaon-mc',
      name: 'Gurgaon Municipal Corporation',
      logoUrl: null,
      verificationStatus: 'VERIFIED',
      jurisdiction: {
        type: 'MUNICIPAL_CORPORATION',
        name: 'Gurgaon',
        basis: 'boundary',
        cities: ['Gurugram'],
        postalCodes: [],
        bbox: [76.93, 28.36, 77.15, 28.54],
      },
    },
    membership: { id: 'm1', membershipRole: 'MEMBER' },
    viewer: { name: 'Priya Mehta', firstName: 'Priya' },
    permissions: { canReview: true, canAddNotes: true },
    ...overrides,
  };
}

export function queueItem(
  overrides: Partial<GovernmentQueueItem> = {},
): GovernmentQueueItem {
  return {
    publicId: 'SAM-1023',
    title: 'Large pothole causing traffic disruption',
    category: 'POTHOLES',
    subcategory: 'Road surface cavity',
    status: 'SUBMITTED',
    severity: 'HIGH',
    urgency: 'HIGH',
    area: 'Sector 48',
    city: 'Gurugram',
    distanceMeters: null,
    voteCount: 124,
    commentCount: 3,
    followCount: 37,
    thumbnailUrl: null,
    createdAt: '2026-10-06T08:00:00.000Z',
    hasAiAnalysis: true,
    ai: {
      status: 'COMPLETED',
      category: 'POTHOLES',
      subcategory: 'Road surface cavity',
      confidence: 0.94,
    },
    duplicates: { possible: 1, confirmedOf: null },
    ...overrides,
  };
}

export function governmentDashboard(
  overrides: Partial<GovernmentDashboard> = {},
): GovernmentDashboard {
  return {
    metrics: {
      totalReports: 1284,
      pendingReview: 186,
      submitted: 120,
      underReview: 66,
      verified: 342,
      highSeverityOpen: 74,
      inProgress: 60,
      resolved: 512,
      rejected: 40,
      duplicates: 12,
      pendingAllocations: 3,
      acceptedAllocations: 9,
      declinedAllocations: 2,
    },
    trend: {
      rangeDays: 7,
      points: Array.from({ length: 7 }, (_, index) => ({
        date: `2026-10-0${index + 1}`,
        reported: index + 1,
        resolved: index % 2,
      })),
    },
    reviewQueue: [queueItem()],
    recentActivity: [
      {
        id: 'a1',
        kind: 'STATUS_CHANGED',
        organizationName: null,
        problemPublicId: 'SAM-1023',
        problemTitle: 'Large pothole causing traffic disruption',
        fromStatus: 'UNDER_REVIEW',
        toStatus: 'VERIFIED',
        actor: { name: 'Priya Mehta', kind: 'TEAM' },
        createdAt: '2026-10-06T09:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

export function problemDetail(
  overrides: Partial<GovernmentProblemDetail> = {},
): GovernmentProblemDetail {
  return {
    problem: {
      publicId: 'SAM-1023',
      title: 'Large pothole causing traffic disruption',
      description: 'A deep pothole on the main road.',
      category: 'POTHOLES',
      subcategory: 'Road surface cavity',
      status: 'UNDER_REVIEW',
      severity: 'HIGH',
      urgency: 'HIGH',
      createdAt: '2026-10-06T08:00:00.000Z',
      updatedAt: '2026-10-06T08:00:00.000Z',
      location: {
        address: 'Sector 48',
        city: 'Gurugram',
        state: 'Haryana',
        postalCode: '122018',
        latitude: 28.4183,
        longitude: 77.0434,
      },
      images: [],
    },
    analysis: {
      status: 'COMPLETED',
      modelName: 'Samadhaan Vision Model',
      modelVersion: 'v1.2',
      analysedAt: '2026-10-06T09:02:00.000Z',
      processingMs: 1200,
      category: 'POTHOLES',
      subcategory: 'Road surface cavity',
      severity: 'HIGH',
      urgency: 'HIGH',
      severityScore: 7.8,
      confidence: 0.94,
      summary: 'Large road damage creating a potential safety hazard.',
      observations: ['A deep cavity across the lane.'],
      textOnly: false,
    },
    duplicates: {
      confirmedOf: null,
      possible: [
        {
          publicId: 'SAM-0987',
          title: 'Similar road damage',
          status: 'SUBMITTED',
          similarity: 0.87,
          verdict: 'LIKELY_DUPLICATE',
          signals: { text: 0.81, geographic: 0.95, category: 1, image: null },
          distanceMeters: 300,
        },
      ],
    },
    community: { supporters: 124, followers: 37, comments: 3, lastCommentAt: null },
    nearby: { radiusMeters: 1000, total: 2, sameCategory: 1, items: [] },
    allowedTransitions: ['VERIFIED', 'REJECTED'],
    allocation: allocationPanel({ canAllocate: false, blockedReason: 'NOT_VERIFIED' }),
    notes: [],
    audit: [],
    ...overrides,
  };
}

export function allocationCandidate(
  overrides: Partial<AllocationCandidate> = {},
): AllocationCandidate {
  return {
    organization: {
      id: '7f0a8d4e-35a1-4a3d-9b61-0d1c9b1e2a10',
      slug: 'green-earth',
      name: 'Green Earth NGO',
      type: 'NGO',
      logoUrl: null,
      verificationStatus: 'VERIFIED',
      location: { city: 'Gurugram', state: 'Haryana' },
    },
    match: {
      relevance: 0.86,
      reasons: [{ code: 'EXPERTISE_STRONG', value: 1 }],
      matchedExpertise: [
        { category: 'POTHOLES', subcategory: null, level: 'SPECIALIST' },
      ],
    },
    eligible: true,
    ineligibleReason: null,
    previouslyDeclined: false,
    ...overrides,
  };
}

export function governmentAllocation(
  overrides: Partial<GovernmentAllocationView> = {},
): GovernmentAllocationView {
  return {
    id: 'a7c1b0e4-0f7e-4c55-9b0b-6c0a3c8b1f01',
    status: 'PENDING',
    organization: {
      slug: 'green-earth',
      name: 'Green Earth NGO',
      type: 'NGO',
      logoUrl: null,
    },
    instructions: 'Coordinate with the ward engineer.',
    internalReason: 'Strong record on road repair.',
    responseNote: null,
    declineReason: null,
    cancellationReason: null,
    allocatedBy: { name: 'Priya Mehta', office: 'Gurugram Municipal Corporation' },
    proposedAt: '2026-10-06T10:00:00.000Z',
    respondedAt: null,
    acceptedAt: null,
    declinedAt: null,
    cancelledAt: null,
    ownedByThisOffice: true,
    ...overrides,
  };
}

export function allocationPanel(
  overrides: Partial<GovernmentAllocationPanel> = {},
): GovernmentAllocationPanel {
  return {
    canAllocate: true,
    blockedReason: null,
    active: null,
    history: [],
    candidates: [allocationCandidate()],
    verifiedAt: '2026-10-06T09:30:00.000Z',
    ...overrides,
  };
}
