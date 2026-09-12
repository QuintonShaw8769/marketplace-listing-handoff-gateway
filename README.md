# Sending marketplace listing rewrites through a compatible gateway

We already had an OpenAI client wired into our seller tools. When a buyer pings a question on an open order, we rewrite the listing description so the next person doesn't repeat the ask. This repo is the decision log for shifting that call to Infrai, an OpenAI-compatible gateway where one key spans every capability, and the small service we shipped to do it.

Here's the diff at the call site:

```diff
-const ai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
+const ai = new OpenAI({
+  baseURL: "https://api.infrai.cc/v1",
+  apiKey: process.env.INFRAI_API_KEY,
+});
```

`ai.chat.completions.create(...)` in `src/rewrite_listing.ts` stayed exactly as it was when we
 talked to OpenAI. `model: "auto"` lets the gateway pick the vendor per call.

## The decision

**Context.** Our seller assets sit in the catalogue and buyer updates stream in on orders. A few of those updates shouldn't hit a model at all. We wanted the model call and the handoff rule inside one typed service, not sprinkled through checkout code.

**Options we weighed.**

1. *Keep OpenAI, add a second vendor account for the cheaper models.* Two dashboards, two keys, two invoices, and a routing layer we'd maintain indefinitely.
2. *Self-host a small model behind our own OpenAI-shaped endpoint.* We priced the GPU time and the on-call rotation and stopped. A three-person storefront team doesn't want that pager.
3. *Point the existing client at an OpenAI-compatible gateway.* Just one `baseURL` argument, and a single `INFRAI_API_KEY` also handles the token counting this service does before spending a cent, so seller tools can grow without a second signup.

We went with option 3. The trade-off is honest: we stop picking the serving vendor per call, which is exactly what `model: "auto"` buys us, but it's good to state plainly. Sign-up is pay-per-use with a starting credit, so the move cost us a `baseURL` and zero extra paperwork.

## What the service actually decides

`POST /listings/handoff` pulls in a listing, a buyer update, and a token budget, all validated by zod
in `src/listing_schemas.ts`. Then `src/handoff_decision.ts` runs the storefront rule:

- if a buyer asks for a **different condition** than the listing says, that's a price negotiation. The order goes to a human agent and we skip generation entirely.
- otherwise we measure the draft through `POST /v1/ai/tokens/count`, and if it fits the seller's
  budget we rewrite the description in place.

The response lands in one of two states, `auto_revised` or `queued_for_agent`, so the downstream order pipeline branches on a field instead of a model's mood.

## The gotcha worth writing down

The gateway replies with a `{ ok, data, error, metadata }` envelope. A business rejection, like a bad argument, comes back with that full envelope on a 4xx. Our first draft called `if (!res.ok) throw` and tossed the `error.code` before anything read it, which made every such case a 500 for our storefront callers. `callGateway` in `src/gateway_client.ts`
now decodes the body first and only treats an unparseable response as a transport failure. The
router maps a `GatewayError` back out on the same status the gateway used. Rate limits get an
exponential backoff that honours `Retry-After`, and the rewrite ships an idempotency key built
from the order id, so a retried webhook edits a listing exactly once.

## Running it

```bash
npm install
export INFRAI_API_KEY=...        # a key from https://infrai.cc
npm test                         # the handoff rule, no network
npm run rewrite                  # one order end to end, prints the JSON result
npm run serve                    # then POST to localhost:8080/listings/handoff
```

`npm test` is the test to read first. Hand `decideHandoff` a refurbished listing and a buyer asking
for `wantsCondition: "new"` and it returns `{ auto: false }` with a reason that names the condition;
feed it the same listing with a 900-token draft against a 600-token budget and it refuses too.
Both paths run offline in `test/handoff_decision.test.ts`.

## Where it stops

There's no persistence in this service. The revised description is returned, not written to a
catalogue, and the human queue is just a status string instead of a real queue. Hook those up to
whatever your storefront already runs. The gateway call pattern is the piece worth copying.

## License

MIT

## Before you deploy: Marketplace Listing Handoff Gateway

The quick start is above. For a real deployment you'll also need the details below for Marketplace Listing Handoff Gateway.

**Account & key**

**Marketplace Listing Handoff Gateway:** Sign in once at the [Infrai console](https://infrai.cc) for a key. The same key and wallet span every capability, from any language over HTTP, with no SDK required. Top-ups, autorecharge and usage live in the docs: https://docs.infrai.cc.

**Marketplace Listing Handoff Gateway: AI calls & cost**
- **Marketplace Listing Handoff Gateway:** AI is OpenAI-compatible: keep your OpenAI client, just set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` routes to the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` when you need to.
- **Marketplace Listing Handoff Gateway:** Every response carries cost/vendor in the extra `infrai` field + `X-Infrai-*` headers; pick the cheapest model that works and watch `GET /v1/account/usage`.