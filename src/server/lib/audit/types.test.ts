import { describe, expect, it } from "vitest";
import { parseAuditConfig } from "./types";
import { startAuditSchema } from "@/types/schemas/audit";

describe("AI crawler live-check audit config", () => {
  it("defaults new audit requests to disabled", () => {
    const config = startAuditSchema.parse({
      projectId: "project-1",
      startUrl: "https://example.com",
    });

    expect(config.runAiCrawlerLiveCheck).toBe(false);
  });

  it("preserves an explicit opt-in", () => {
    const config = startAuditSchema.parse({
      projectId: "project-1",
      startUrl: "https://example.com",
      runAiCrawlerLiveCheck: true,
    });

    expect(config.runAiCrawlerLiveCheck).toBe(true);
  });

  it("keeps stored configs from older audits readable", () => {
    const config = parseAuditConfig(
      JSON.stringify({ maxPages: 50, lighthouseStrategy: "none" }),
    );

    expect(config?.runAiCrawlerLiveCheck).toBe(false);
  });
});
