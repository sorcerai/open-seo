import { z } from "zod";
import { DomainService } from "@/server/features/domain/services/DomainService";
import { mcpResponse } from "@/server/mcp/formatters";
import { buildProjectMeta } from "@/server/mcp/context";
import { optionalMetaOutputSchema } from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { resolveLabsMarket } from "@/shared/keyword-locations";
import {
  assertLabsLocationCode,
  assertLanguageForLocation,
} from "@/server/lib/market";
import {
  languageCodeSchema,
  locationCodeSchema,
  projectIdSchema,
} from "@/server/mcp/schemas";

const inputSchema = {
  projectId: projectIdSchema,
  domain: z.string().min(1).describe("Domain to analyze (e.g. 'example.com')."),
  includeSubdomains: z
    .boolean()
    .optional()
    .default(false)
    .describe("Include subdomains in the domain's metrics. Defaults to false."),
  locationCode: locationCodeSchema.optional(),
  languageCode: languageCodeSchema.optional(),
} as const;

type Args = z.infer<z.ZodObject<typeof inputSchema>>;

export const getDomainOverviewTool = {
  name: "get_domain_overview",
  config: {
    title: "Get domain overview",
    description:
      "Returns high-level DataForSEO organic estimates for a domain. It does not query backlink data; call get_backlinks_overview for backlinks and referring domains. Use this first for domain research; for the detailed ranked-keyword list, call get_domain_keyword_suggestions next. Charges credits (~100-300 typical). Cached for 12 hours per domain.",
    inputSchema,
    outputSchema: z
      .object({
        domain: z.string().optional(),
        organicTraffic: z.number().nullable().optional(),
        organicKeywords: z.number().nullable().optional(),
        backlinks: z.null().optional(),
        referringDomains: z.null().optional(),
        dataAvailability: z.object({
          organicTraffic: z.enum(["available", "unavailable"]),
          organicKeywords: z.enum(["available", "unavailable"]),
          backlinks: z.literal("not_queried"),
          referringDomains: z.literal("not_queried"),
        }),
        ...optionalMetaOutputSchema,
      })
      .passthrough(),
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: Args, context) => {
    const { locationCode, languageCode } = resolveLabsMarket(
      args,
      context.project,
    );
    assertLabsLocationCode(locationCode);
    assertLanguageForLocation(locationCode, languageCode);
    const result = await DomainService.getOverview(
      {
        projectId: args.projectId,
        domain: args.domain,
        includeSubdomains: args.includeSubdomains,
        locationCode,
        languageCode,
      },
      context.billing,
    );
    const dataAvailability = {
      organicTraffic:
        result.organicTraffic === null ? "unavailable" : "available",
      organicKeywords:
        result.organicKeywords === null ? "unavailable" : "available",
      backlinks: "not_queried",
      referringDomains: "not_queried",
    } as const;
    const text = [
      `Domain: ${result.domain}`,
      `Organic traffic: ${result.organicTraffic ?? "unavailable"}`,
      `Organic keywords: ${result.organicKeywords ?? "unavailable"}`,
      "Backlinks: not queried; call get_backlinks_overview",
      "Referring domains: not queried; call get_backlinks_overview",
    ].join("\n");
    return mcpResponse({
      text,
      meta: buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/domain`,
        {
          domain: args.domain,
        },
      ),
      structuredContent: {
        ...result,
        backlinks: null,
        referringDomains: null,
        dataAvailability,
      },
    });
  }),
};
