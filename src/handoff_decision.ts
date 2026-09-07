import type { BuyerUpdate, SellerListing } from "./listing_schemas";

/** The exact text the model would rewrite — also what we measure before spending. */
export function draftPrompt(listing: SellerListing, update: BuyerUpdate): string {
  return [
    `Listing ${listing.listingId} (${listing.condition}, ${listing.priceCents} cents)`,
    listing.title,
    listing.description,
    `Buyer ${update.askedBy} on order ${update.orderId} asks: ${update.message}`,
    update.wantsCondition ? `Buyer expects condition: ${update.wantsCondition}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * The storefront rule: a buyer who wants a different condition than the listing
 * states is a price question, so it goes to a human. Everything else is rewritten
 * automatically as long as the draft fits the seller's token budget.
 */
export function decideHandoff(
  listing: SellerListing,
  update: BuyerUpdate,
  tokens: number,
  tokenBudget: number,
): { auto: boolean; reason: string } {
  if (update.wantsCondition && update.wantsCondition !== listing.condition) {
    return { auto: false, reason: "buyer asked for a different condition than the listing states" };
  }
  if (tokens > tokenBudget) {
    return { auto: false, reason: `draft is ${tokens} tokens, over the ${tokenBudget} budget` };
  }
  return { auto: true, reason: "within budget and no condition change" };
}
