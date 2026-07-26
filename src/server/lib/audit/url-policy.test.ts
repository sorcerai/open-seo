import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppError } from "@/server/lib/errors";
import { normalizeAndValidateStartUrl } from "@/server/lib/audit/url-policy";

describe("normalizeAndValidateStartUrl", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adds https when protocol is missing and strips hash", async () => {
    // Fresh Response per call: A and AAAA are two lookups and a body reads once.
    vi.mocked(fetch).mockImplementation(
      async () =>
        new Response(JSON.stringify({ Status: 0, Answer: [] }), {
          status: 200,
          headers: { "content-type": "application/dns-json" },
        }),
    );

    await expect(
      normalizeAndValidateStartUrl("example.com/path#section"),
    ).resolves.toBe("https://example.com/path");
  });

  it("blocks localhost-like targets", async () => {
    await expect(
      normalizeAndValidateStartUrl("http://localhost:3000"),
    ).rejects.toMatchObject({
      code: "CRAWL_TARGET_BLOCKED",
    } satisfies Partial<AppError>);
  });

  it("blocks private ip targets", async () => {
    await expect(
      normalizeAndValidateStartUrl("http://192.168.0.10"),
    ).rejects.toMatchObject({
      code: "CRAWL_TARGET_BLOCKED",
    } satisfies Partial<AppError>);
  });

  it("rejects invalid URL input", async () => {
    await expect(
      normalizeAndValidateStartUrl("not a url"),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    } satisfies Partial<AppError>);
  });

  it("blocks hostnames that resolve to a private address", async () => {
    // A fresh Response per call: A and AAAA are two lookups, and a single
    // Response body can only be read once.
    vi.mocked(fetch).mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            Status: 0,
            Answer: [{ type: 1, data: "10.0.0.5" }],
          }),
          { status: 200 },
        ),
    );

    await expect(
      normalizeAndValidateStartUrl("https://rebind.example.com"),
    ).rejects.toMatchObject({
      code: "CRAWL_TARGET_BLOCKED",
    } satisfies Partial<AppError>);
  });

  // Fail closed: an unanswerable lookup is "unknown", not "public". Treating it
  // as safe leaves a DNS-rebinding / transient-failure hole.
  it("blocks when the DNS lookup itself fails", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("network unreachable"));

    await expect(
      normalizeAndValidateStartUrl("https://unresolvable.example.com"),
    ).rejects.toMatchObject({
      code: "CRAWL_TARGET_BLOCKED",
    } satisfies Partial<AppError>);
  });

  it("blocks when the DNS resolver returns a non-200", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("nope", { status: 500 }));

    await expect(
      normalizeAndValidateStartUrl("https://resolver-down.example.com"),
    ).rejects.toMatchObject({
      code: "CRAWL_TARGET_BLOCKED",
    } satisfies Partial<AppError>);
  });
});
