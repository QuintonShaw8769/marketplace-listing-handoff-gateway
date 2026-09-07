import assert from "node:assert/strict";
import { test } from "node:test";
import { decideHandoff, draftPrompt } from "../src/handoff_decision";
import { BuyerUpdate, HandoffRequest, SellerListing } from "../src/listing_schemas";

const listing: SellerListing = {
  listingId: "sku-4471",
  title: "Herman Miller Aeron, size B",
  description: "Office chair, lumbar support, hardwood casters.",
  priceCents: 48000,
  condition: "refurbished",
};

const update: BuyerUpdate = {
  orderId: "ord-1001",
  askedBy: "buyer_92",
  message: "Does the tilt lock still work?",
};

test("a plain question inside budget is rewritten automatically", () => {
  const d = decideHandoff(listing, update, 120, 600);
  assert.equal(d.auto, true);
});

test("a buyer asking for a different condition goes to a human", () => {
  const d = decideHandoff(listing, { ...update, wantsCondition: "new" }, 120, 600);
  assert.equal(d.auto, false);
  assert.match(d.reason, /condition/);
});

test("an oversized draft goes to a human even with no condition change", () => {
  const d = decideHandoff(listing, update, 900, 600);
  assert.equal(d.auto, false);
  assert.match(d.reason, /900 tokens/);
});

test("the measured draft carries the order the buyer wrote from", () => {
  const prompt = draftPrompt(listing, update);
  assert.ok(prompt.includes("ord-1001"));
  assert.ok(prompt.includes("sku-4471"));
});

test("the request body defaults the token budget", () => {
  const parsed = HandoffRequest.parse({ listing, update });
  assert.equal(parsed.tokenBudget, 600);
});
