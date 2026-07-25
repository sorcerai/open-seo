import { describe, expect, it } from "vitest";
import { getDemandRetentionProfile } from "../retention";

describe("demand pulse retention", () => {
  it("keeps Reddit behind the strict compliance profile", () => {
    const profile = getDemandRetentionProfile("community_observed", "reddit");
    expect(profile.requiresLegalApproval).toBe(true);
    expect(profile.storeAuthorIdentity).toBe(false);
    expect(profile.mustHonorDeletion).toBe(true);
    expect(profile.rawContentDays).toBeLessThanOrEqual(7);
  });
});
