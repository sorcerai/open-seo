import type { BillingCustomerContext } from "@/server/billing/subscription";
import { DataforseoChargedTaskError } from "@/server/lib/dataforseo/envelope";
import {
  loadDataforseoSections,
  meterDataforseoCallWithEnvelope,
} from "@/server/lib/dataforseo/client";
import type {
  DataForSeoDiscussionItem,
  DataForSeoPaidFetch,
} from "./dataforseo-discussions-normalizer";

export interface DataForSeoDiscussionsPaidFetchOptions {
  customer: BillingCustomerContext;
  locationCode: number;
  languageCode: string;
}

export function createDataForSeoDiscussionsPaidFetch(
  options: DataForSeoDiscussionsPaidFetchOptions,
): DataForSeoPaidFetch {
  return async ({ queries }) => {
    const sections = await loadDataforseoSections();
    const items: DataForSeoDiscussionItem[] = [];
    let costMicros = 0;
    let vendorRequestCount = 0;

    for (const query of queries) {
      try {
        const response = await meterDataforseoCallWithEnvelope(
          options.customer,
          () =>
            sections.fetchLiveSerp({
              keyword: query,
              locationCode: options.locationCode,
              languageCode: options.languageCode,
            }),
        );
        costMicros += Math.round(response.billing.costUsd * 1_000_000);
        vendorRequestCount += 1;

        for (const item of response.data) {
          if (item.type !== "organic") continue;
          items.push({
            query,
            title: item.title ?? "",
            url: item.url ?? "",
            domain: item.domain,
            description: item.description,
            rankGroup: item.rank_group,
            rankAbsolute: item.rank_absolute,
          });
        }
      } catch (error) {
        if (
          !(error instanceof DataforseoChargedTaskError) ||
          error.billing.costUsd <= 0
        ) {
          throw error;
        }
        return {
          kind: "charged_failure",
          error: error.message,
          costMicros:
            costMicros + Math.round(error.billing.costUsd * 1_000_000),
          vendorRequestCount: vendorRequestCount + 1,
        };
      }
    }

    return {
      kind: "paid_success",
      items,
      costMicros,
      vendorRequestCount,
    };
  };
}
