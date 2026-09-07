import { randomUUID } from "node:crypto";
import { ai, callGateway } from "./gateway_client";
import { decideHandoff, draftPrompt } from "./handoff_decision";
import type { HandoffRequest, HandoffResult } from "./listing_schemas";
import { HandoffRequest as HandoffRequestSchema } from "./listing_schemas";

type TokenCount = { tokens?: number; count?: number };

/** Measure the draft before any generation happens, on the same gateway. */
async function countTokens(input: string): Promise<number> {
  const data = await callGateway<TokenCount>("/v1/ai/tokens/count", {
    model: "auto",
    messages: [{ role: "user", content: input }],
  });
  return data.tokens ?? data.count ?? 0;
}

export async function applyBuyerUpdate(req: HandoffRequest): Promise<HandoffResult> {
  const { listing, update, tokenBudget } = req;
  const prompt = draftPrompt(listing, update);
  const tokens = await countTokens(prompt);
  const decision = decideHandoff(listing, update, tokens, tokenBudget);

  if (!decision.auto) {
    return { status: "queued_for_agent", listingId: listing.listingId, tokens, reason: decision.reason };
  }

  const completion = await ai.chat.completions.create(
    {
      model: "auto",
      messages: [
        {
          role: "system",
          content:
            "Rewrite the marketplace listing description so it answers the buyer. " +
            "Keep the stated condition and price. Reply with the description only.",
        },
        { role: "user", content: prompt },
      ],
    },
    // A retried rewrite of the same order revises the listing once, not twice.
    { headers: { "Idempotency-Key": `${update.orderId}:${listing.listingId}` } },
  );

  return {
    status: "auto_revised",
    listingId: listing.listingId,
    tokens,
    revisedDescription: completion.choices[0]?.message?.content?.trim() ?? listing.description,
  };
}

// `npm run rewrite` — one order through the whole path, printed as JSON.
if (process.argv[1]?.endsWith("rewrite_listing.ts")) {
  const req = HandoffRequestSchema.parse({
    listing: {
      listingId: "sku-4471",
      title: "Herman Miller Aeron, size B",
      description: "Office chair, lumbar support, wheels swapped for hardwood casters.",
      priceCents: 48000,
      condition: "refurbished",
    },
    update: {
      orderId: `ord-${randomUUID().slice(0, 8)}`,
      askedBy: "buyer_92",
      message: "Does the tilt lock still work, and do the casters mark parquet?",
    },
    tokenBudget: 600,
  });
  const result = await applyBuyerUpdate(req);
  console.log(JSON.stringify(result, null, 2));
}
