import { z } from "zod";

/** What the seller already has in the catalogue. */
export const SellerListing = z.object({
  listingId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  priceCents: z.number().int().positive(),
  condition: z.enum(["new", "refurbished", "used"]),
});

/** What a buyer message asks the seller to change. */
export const BuyerUpdate = z.object({
  orderId: z.string().min(1),
  askedBy: z.string().min(1),
  message: z.string().min(1).max(2000),
  wantsCondition: SellerListing.shape.condition.optional(),
});

export const HandoffRequest = z.object({
  listing: SellerListing,
  update: BuyerUpdate,
  /** Largest draft the storefront will let the model rewrite unattended. */
  tokenBudget: z.number().int().positive().default(600),
});

export type SellerListing = z.infer<typeof SellerListing>;
export type BuyerUpdate = z.infer<typeof BuyerUpdate>;
export type HandoffRequest = z.infer<typeof HandoffRequest>;

export type HandoffResult =
  | { status: "auto_revised"; listingId: string; tokens: number; revisedDescription: string }
  | { status: "queued_for_agent"; listingId: string; tokens: number; reason: string };
