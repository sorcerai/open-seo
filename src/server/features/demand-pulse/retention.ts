import type { DemandSourceClass } from "./types";

export interface DemandRetentionProfile {
  id: string;
  rawContentDays: number;
  excerptDays: number;
  derivedFeatureDays: number;
  storeAuthorIdentity: boolean;
  mustHonorDeletion: boolean;
  rehydrateOnDemand: boolean;
  requiresLegalApproval: boolean;
}

const BASE_PROFILES: Record<DemandSourceClass, DemandRetentionProfile> = {
  primary_authoritative: {
    id: "primary-authoritative-v1",
    rawContentDays: 365,
    excerptDays: 730,
    derivedFeatureDays: 1095,
    storeAuthorIdentity: false,
    mustHonorDeletion: true,
    rehydrateOnDemand: true,
    requiresLegalApproval: false,
  },
  first_party_observed: {
    id: "first-party-controlled-v1",
    rawContentDays: 365,
    excerptDays: 730,
    derivedFeatureDays: 1095,
    storeAuthorIdentity: false,
    mustHonorDeletion: true,
    rehydrateOnDemand: false,
    requiresLegalApproval: false,
  },
  search_observed: {
    id: "search-observed-v1",
    rawContentDays: 90,
    excerptDays: 180,
    derivedFeatureDays: 730,
    storeAuthorIdentity: false,
    mustHonorDeletion: false,
    rehydrateOnDemand: true,
    requiresLegalApproval: false,
  },
  community_observed: {
    id: "community-minimal-v1",
    rawContentDays: 30,
    excerptDays: 90,
    derivedFeatureDays: 730,
    storeAuthorIdentity: false,
    mustHonorDeletion: true,
    rehydrateOnDemand: true,
    requiresLegalApproval: false,
  },
  market_event_observed: {
    id: "market-event-v1",
    rawContentDays: 180,
    excerptDays: 365,
    derivedFeatureDays: 1095,
    storeAuthorIdentity: false,
    mustHonorDeletion: false,
    rehydrateOnDemand: true,
    requiresLegalApproval: false,
  },
  ai_surface_observed: {
    id: "ai-surface-v1",
    rawContentDays: 90,
    excerptDays: 180,
    derivedFeatureDays: 730,
    storeAuthorIdentity: false,
    mustHonorDeletion: false,
    rehydrateOnDemand: false,
    requiresLegalApproval: false,
  },
  generated_candidate: {
    id: "generated-candidate-v1",
    rawContentDays: 30,
    excerptDays: 90,
    derivedFeatureDays: 365,
    storeAuthorIdentity: false,
    mustHonorDeletion: false,
    rehydrateOnDemand: false,
    requiresLegalApproval: false,
  },
};

const PLATFORM_OVERRIDES: Record<string, DemandRetentionProfile> = {
  reddit: {
    id: "reddit-compliance-gated-v1",
    rawContentDays: 7,
    excerptDays: 30,
    derivedFeatureDays: 365,
    storeAuthorIdentity: false,
    mustHonorDeletion: true,
    rehydrateOnDemand: true,
    requiresLegalApproval: true,
  },
};

export function getDemandRetentionProfile(
  sourceClass: DemandSourceClass,
  sourcePlatform?: string,
): DemandRetentionProfile {
  const override = sourcePlatform
    ? PLATFORM_OVERRIDES[sourcePlatform.toLowerCase()]
    : undefined;
  return { ...(override ?? BASE_PROFILES[sourceClass]) };
}

export function calculateExpiry(collectedAt: string, days: number): string {
  const timestamp = Date.parse(collectedAt);
  if (!Number.isFinite(timestamp)) {
    throw new TypeError(`Invalid collectedAt timestamp: ${collectedAt}`);
  }
  return new Date(timestamp + days * 86_400_000).toISOString();
}
