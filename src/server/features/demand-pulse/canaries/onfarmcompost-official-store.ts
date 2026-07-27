import { z } from "zod";

// Feature-wide R2 namespace. Every key is scoped by the real registered
// project UUID (the projects table primary key) so two profiles never share or
// collide on state or run artifacts. The "onfarmcompost" slug is intentionally
// absent from persisted identity.
const DEMAND_PULSE_PREFIX = "demand-pulse";

export function officialStateKey(projectId: string): string {
  return `${DEMAND_PULSE_PREFIX}/${projectId}/state/official-pages.json`;
}

export function runArtifactKey(projectId: string, localDate: string): string {
  return `${DEMAND_PULSE_PREFIX}/${projectId}/runs/${localDate}.json`;
}

const projectUuidSchema = z.uuid();

// Exact z.uuid() validation — the same schema that validates written state, so
// any project id accepted here is readable back through the state schema.
export function isProjectUuid(value: string): boolean {
  return projectUuidSchema.safeParse(value).success;
}

export interface DemandPulseJsonBody {
  text(): Promise<string>;
}

export interface DemandPulseJsonBucket {
  head(key: string): Promise<unknown>;
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
  // Null until a genuine fingerprint change is observed. The first observation
  // establishes the baseline fingerprint; it is never a change/velocity event.
  lastChangedAt: z.iso.datetime().nullable(),
  lastModified: z.iso.datetime().nullable(),
  etag: z.string().nullable(),
});

// projectId is validated as a UUID and must equal the resolved profile's
// projectId. This rejects stale or foreign state masquerading as this
// project's baseline.
const officialPageStateSchema = z.object({
  schemaVersion: z.literal("1"),
  projectId: z.uuid(),
  updatedAt: z.iso.datetime(),
  sources: z.record(z.string(), officialPageStateEntrySchema),
});

export type OfficialPageStateEntry = z.infer<
  typeof officialPageStateEntrySchema
>;
export type OfficialPageState = z.infer<typeof officialPageStateSchema>;

// Distinguishing "absent" (legitimate first run) from "corrupt" (R2 read
// failure, unparseable body, or schema-invalid) is load-bearing: corrupt state
// must fail closed, never silently degrade to first-run behavior.
export type OfficialPageStateRead =
  | { kind: "absent" }
  | { kind: "ok"; state: OfficialPageState }
  | { kind: "corrupt" };

// Every R2 access — including the initial bucket.get — is classified inside the
// try. A read failure or invalid body yields "corrupt", never a thrown
// exception reaching the caller and never a silent first run.
export async function readOfficialPageState(
  bucket: DemandPulseJsonBucket,
  projectId: string,
): Promise<OfficialPageStateRead> {
  try {
    const object = await bucket.get(officialStateKey(projectId));
    if (!object) return { kind: "absent" };
    const parsed: unknown = JSON.parse(await object.text());
    const result = officialPageStateSchema.safeParse(parsed);
    if (!result.success) return { kind: "corrupt" };
    return { kind: "ok", state: result.data };
  } catch {
    return { kind: "corrupt" };
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
