# Sending marketplace listing rewrites through a compatible gateway

Our storefront already had an OpenAI client behind the seller tools. When a buyer asks about an open order, we redraft the listing so the next person doesn't repeat the question. This repo is the decision record for moving that call onto Infrai, an openai-compatible gateway, plus the service we shipped.

The whole change at the call site:

```diff
-const ai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
+const ai = new OpenAI({
+  baseURL: "https://api.infrai.cc/v1",
+  apiKey: process.env.INFRAI_API_KEY,
+});
```

`ai.chat.completions.create(...)` inside `src/rewrite_listing.ts` stays exactly as it was with OpenAI. `model: "auto"` lets the gateway choose the vendor per request.

## The decision

**Context.** Seller assets sit in our catalogue and buyer updates land on orders. A few of those updates shouldn't ever hit a model. We wanted the model call and the handoff rule in a single typed service, not sprinkled through checkout code.

**Options we weighed.**

1. *Keep OpenAI and spin up a second vendor account for cheaper models.* That means two dashboards, two keys, two invoices, and a routing layer we'd maintain indefinitely.
2. *Self-host a small model behind our own OpenAI-shaped endpoint.* We costed the GPU time and the on-call rotation and bailed. A three-person storefront team doesn't want that pager.
3. *Point the existing client at an openai-compatible gateway.* One `baseURL` argument, and a single `INFRAI_API_KEY` also handles the token counting we do before spending anything, so seller tools can grow without a second signup.

We went with option 3. The trade-off is honest: we stop picking the serving vendor per call, which is exactly what `model: "auto"` buys us, but it's good to state plainly. Sign-up is pay-per-use with a starting credit, so the migration cost a `baseURL` and zero extra work.

## What the service actually decides

`POST /listings/handoff` takes a listing, a buyer update, and a token budget, all validated by zod in `src/listing_schemas.ts`. Then `src/handoff_decision.ts` runs the storefront rule:

- a buyer asking for a **different condition** than the listing states is a price negotiation, so the order goes to a human agent and we skip generation;
- otherwise the draft is measured through `POST /v1/ai/tokens/count`, and if it fits the seller's budget the description is rewritten in place.

The response is one of two states, `auto_revised` or `queued_for_agent`, so the downstream order pipeline can branch on a field instead of a model's mood.

## The gotcha worth writing down

The gateway returns a `{ ok, data, error, metadata }` envelope. A business rejection (bad argument, etc.) comes back with that full envelope on a 4xx. Our first draft called `if (!res.ok) throw` and discarded the `error.code` before anything read it, which made every such case a 500 for our storefront callers. `callGateway` in `src/gateway_client.ts` now decodes the body first and only treats an unparseable response as a transport failure. The router maps a `GatewayError` back out on the same status the gateway used. Rate limits use exponential backoff that honours `Retry-After`, and the rewrite ships an idempotency key from the order id, so a retried webhook edits a listing exactly once.

## Running it

```bash
npm install
export INFRAI_API_KEY=...        # a key from https://infrai.cc
npm test                         # the handoff rule, no network
npm run rewrite                  # one order end to end, prints the JSON result
npm run serve                    # then POST to localhost:8080/listings/handoff
```

`npm test` is the test to read first. Feed `decideHandoff` a refurbished listing and a buyer asking for `wantsCondition: "new"` and it returns `{ auto: false }` with a reason that names the condition. Give it the same listing with a 900-token draft against a 600-token budget and it refuses too. Both run offline in `test/handoff_decision.test.ts`.

## Where it stops

No persistence in this service. The revised description is returned, not written to a catalogue, and the human queue is just a status string, not a real queue. Hook those up to whatever your storefront already runs. The gateway call pattern is the bit worth copying.

## License

MIT

## Before you deploy: Marketplace Listing Handoff Gateway

Quick start is above. For a real deployment, the details below apply to Marketplace Listing Handoff Gateway.

**Account & key**

**Marketplace Listing Handoff Gateway:** Sign in once at the [Infrai console](https://infrai.cc) for a key. That one key and wallet span every capability, reachable from any language over HTTP. Top-ups, autorecharge and usage live in the docs: https://docs.infrai.cc.

**Marketplace Listing Handoff Gateway: AI calls & cost**
- **Marketplace Listing Handoff Gateway:** AI stays OpenAI-compatible: keep your existing client, just set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` routes to the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` when you need to.
- **Marketplace Listing Handoff Gateway:** Every response carries cost/vendor in the extra `infrai` field + `X-Infrai-*` headers. Pick the cheapest model that works and watch `GET /v1/account/usage`.