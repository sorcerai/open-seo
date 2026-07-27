import { load } from "cheerio";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 1_500_000;
const EXCERPT_LENGTH = 1_000;

export interface OfficialPageSeed {
  id: string;
  name: string;
  url: string;
  allowedHosts: readonly string[];
  geography: string;
  topics: readonly string[];
}

export interface OfficialPageSnapshot {
  sourceId: string;
  requestedUrl: string;
  finalUrl: string;
  title: string;
  excerpt: string;
  fingerprint: string;
  fetchedAt: string;
  lastModified: string | null;
  etag: string | null;
  contentBytes: number;
  httpStatus: number;
}

export type OfficialPageFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export const ONFARMCOMPOST_OFFICIAL_PAGE_SEEDS: readonly OfficialPageSeed[] = [
  {
    id: "tceq-composting-and-mulching",
    name: "TCEQ Composting and Mulching: Am I Regulated?",
    url: "https://www.tceq.texas.gov/permitting/waste_permits/msw_permits/compmulch",
    allowedHosts: ["www.tceq.texas.gov", "tceq.texas.gov"],
    geography: "Texas",
    topics: [
      "compost notification",
      "compost registration",
      "compost permit",
      "agricultural material exemption",
      "meat dairy oils grease",
    ],
  },
  {
    id: "texas-ag-food-waste-composting",
    name: "Texas Attorney General Food Waste Composting Complaint",
    url: "https://www.texasattorneygeneral.gov/divisions/administrative-law/food-waste-composting-complaint",
    allowedHosts: ["www.texasattorneygeneral.gov", "texasattorneygeneral.gov"],
    geography: "Texas",
    topics: [
      "Texas Health and Safety Code 364.020",
      "commercial food waste composting ordinance",
      "agricultural operation exception",
    ],
  },
  {
    id: "houston-composting-companies",
    name: "City of Houston Composting Resources",
    url: "https://www.houstontx.gov/council/5/composting.html",
    allowedHosts: ["www.houstontx.gov", "houstontx.gov"],
    geography: "Houston, Texas",
    topics: [
      "Houston composting companies",
      "Houston food waste program",
      "Houston pumpkin composting",
      "local provider listing",
    ],
  },
  {
    id: "epa-sustainable-management-food",
    name: "EPA Sustainable Management of Food",
    url: "https://www.epa.gov/sustainable-management-food",
    allowedHosts: ["www.epa.gov", "epa.gov"],
    geography: "United States",
    topics: [
      "wasted food",
      "food waste measurement",
      "landfill methane",
      "food recovery hierarchy",
    ],
  },
  {
    id: "nrcs-texas",
    name: "USDA NRCS Texas",
    url: "https://www.nrcs.usda.gov/conservation-basics/conservation-by-state/texas",
    allowedHosts: ["www.nrcs.usda.gov", "nrcs.usda.gov"],
    geography: "Texas",
    topics: [
      "Texas soil health",
      "conservation practices",
      "farm programs",
      "organic matter",
    ],
  },
  {
    id: "texas-agrilife-extension",
    name: "Texas A&M AgriLife Extension",
    url: "https://agrilifeextension.tamu.edu/",
    allowedHosts: ["agrilifeextension.tamu.edu", "agrilife.tamu.edu"],
    geography: "Texas",
    topics: [
      "compost",
      "soil health",
      "manure",
      "farm management",
      "Gulf Coast agriculture",
    ],
  },
] as const;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeHost(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\./, "");
}

export function extractOfficialPageText(html: string): {
  title: string;
  text: string;
  excerpt: string;
} {
  const $ = load(html);
  $("script, style, noscript, template, svg").remove();

  const title = normalizeWhitespace($("title").first().text());
  const primaryContent = $("main, article, [role='main']").first();
  const readableText =
    primaryContent.length > 0
      ? primaryContent.text()
      : $("body").length > 0
        ? $("body").text()
        : $.root().text();
  const text = normalizeWhitespace(readableText);

  return {
    title,
    text,
    excerpt: text.slice(0, EXCERPT_LENGTH),
  };
}

export function isAllowedOfficialRedirect(
  requestedUrl: string,
  finalUrl: string,
  allowedHosts: readonly string[] = [],
): boolean {
  const requestedHost = normalizeHost(new URL(requestedUrl).hostname);
  const finalHost = normalizeHost(new URL(finalUrl).hostname);
  const approvedHosts = new Set([
    requestedHost,
    ...allowedHosts.map((host) => normalizeHost(host)),
  ]);
  return approvedHosts.has(finalHost);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function readResponseTextBounded(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; bytes: number }> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`Response exceeds ${maxBytes} byte limit`);
  }

  if (!response.body) return { text: "", bytes: 0 };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel("Response byte limit exceeded");
        throw new Error(`Response exceeds ${maxBytes} byte limit`);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { text, bytes };
  } finally {
    reader.releaseLock();
  }
}

function normalizeHttpDate(value: string | null): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export async function fetchOfficialPageSnapshot(
  seed: OfficialPageSeed,
  fetchFn: OfficialPageFetch,
  fetchedAt: string,
): Promise<OfficialPageSnapshot> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetchFn(seed.url, {
      method: "GET",
      redirect: "follow",
      headers: {
        accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.1",
        "user-agent":
          "OpenSEO-DemandPulse/0.1 (+https://github.com/sorcerai/open-seo)",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const finalUrl = response.url || seed.url;
    if (!isAllowedOfficialRedirect(seed.url, finalUrl, seed.allowedHosts)) {
      throw new Error(`Redirected outside official allowlist: ${finalUrl}`);
    }

    const contentType =
      response.headers.get("content-type")?.toLowerCase() ?? "";
    if (
      contentType &&
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml+xml") &&
      !contentType.includes("text/plain")
    ) {
      throw new Error(`Unsupported content type: ${contentType}`);
    }

    const body = await readResponseTextBounded(response, MAX_RESPONSE_BYTES);
    const extracted = extractOfficialPageText(body.text);
    if (extracted.text.length < 100) {
      throw new Error("Official page returned insufficient readable text");
    }

    return {
      sourceId: seed.id,
      requestedUrl: seed.url,
      finalUrl,
      title: extracted.title || seed.name,
      excerpt: extracted.excerpt,
      fingerprint: await sha256Hex(extracted.text),
      fetchedAt,
      lastModified: normalizeHttpDate(response.headers.get("last-modified")),
      etag: response.headers.get("etag"),
      contentBytes: body.bytes,
      httpStatus: response.status,
    };
  } finally {
    clearTimeout(timeout);
  }
}
