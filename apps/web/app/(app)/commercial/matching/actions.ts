"use server";

import { revalidatePath } from "next/cache";
import { setMatchStatus, suggestComparables } from "@crm/core";
import { runAction, type ActionResult } from "@/lib/actions";

export async function setMatchStatusAction(input: unknown): Promise<ActionResult<undefined>> {
  const r = await runAction(async (db, ctx) => {
    await setMatchStatus(db, ctx, input);
    return undefined;
  });
  if (r.ok) {
    revalidatePath("/crm/leads", "layout");
    revalidatePath("/commercial/matching");
    revalidatePath("/properties", "layout");
  }
  return r;
}

export interface ComparableSuggestion {
  zone: "neighborhood" | "locality" | "any";
  currency: "UYU" | "USD";
  confidence: "low" | "medium" | "high";
  closedCount: number;
  medianPricePerM2: string | null;
  suggestedValue: string | null;
  items: {
    propertyId: string;
    code: string;
    displayTitle: string;
    address: string | null;
    neighborhoodName: string | null;
    bedrooms: number | null;
    areaM2: number | null;
    source: "closed" | "listed";
    priceMinor: string;
  }[];
}

/** Comparables del inventario propio para una tasación (montos como texto: sin bigint al cliente). */
export async function suggestComparablesAction(input: unknown): Promise<ActionResult<ComparableSuggestion>> {
  return runAction(async (db, ctx) => {
    const r = await suggestComparables(db, ctx, input);
    return {
      zone: r.zone,
      currency: r.currency,
      confidence: r.confidence,
      closedCount: r.closedCount,
      medianPricePerM2: r.medianPricePerM2Minor?.toString() ?? null,
      suggestedValue: r.suggestedValueMinor?.toString() ?? null,
      items: r.items.map((i) => ({
        propertyId: i.propertyId,
        code: i.code,
        displayTitle: i.displayTitle,
        address: i.address,
        neighborhoodName: i.neighborhoodName,
        bedrooms: i.bedrooms,
        areaM2: i.areaM2,
        source: i.source,
        priceMinor: i.priceMinor.toString(),
      })),
    };
  });
}
