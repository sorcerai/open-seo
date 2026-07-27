import { z } from "zod";

export const ONFARMCOMPOST_PROJECT_ID = "onfarmcompost";
export const ONFARMCOMPOST_ARTIFACT_PREFIX = "demand-pulse/onfarmcompost";
export const ONFARMCOMPOST_OFFICIAL_STATE_KEY = `${ONFARMCOMPOST_ARTIFACT_PREFIX}/state/official-pages.json`;

export interface DemandPulseJsonBody {
  text(): Promise<string>;
}

export interface DemandPulseJsonBucket {
  head(key: string): Promise<unknown | null>;
  get(key: string): Promise<DemandPulseJsonBody | null>;
  put(
    key: string,
    value: string,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<unknown>;
}

const officialPageStateEntrySchema = z.object({
  fingerprint: z.string().min(1),
  finalUrl: z.url(),
  title: z.string(),
  lastFetchedAt: z.iso.datetime(),
  lastChangedAt: z.iso.datetime(),
  lastModified: z.iso.datetime().nullable(),
  etag: z.string().nullable(),
});

const officialPageStateSchema = z.object({
  schemaVersion: z.literal("1"),
  projectId: z.literal(ONFARMCOMPOST_PROJECT_ID),
  updatedAt: z.iso.datetime(),
  sources: z.record(z.string(), officialPageStateEntrySchema),
});

export type OfficialPageStateEntry = z.infer<
  typeof officialPageStateEntrySchema
>;
export type OfficialPageState = z.infer<typeof officialPageStateSchema>;

export async function readOfficialPageState(
  bucket: DemandPulseJsonBucket,
): Promise<OfficialPageState | null> {
  const object = await bucket.get(ONFARMCOMPOST_OFFICIAL_STATE_KEY);
  if (!object) return null;

  try {
    const parsed: unknown = JSON.parse(await object.text());
    const result = officialPageStateSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export async function writeJsonArtifact(
  bucket: DemandPulseJsonBucket,
  key: string,
  value: unknown,
  customMetadata: Record<string, string>,
): Promise<void> {
  await bucket.put(key, JSON.stringify(value), {
    httpMetadata: { contentType: "application/json" },
    customMetadata,
  });
}
