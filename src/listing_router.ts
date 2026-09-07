import { createServer } from "node:http";
import { GatewayError } from "./gateway_client";
import { HandoffRequest } from "./listing_schemas";
import { applyBuyerUpdate } from "./rewrite_listing";

const port = Number(process.env.PORT ?? 8080);

function json(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(payload);
}

const server = createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/listings/handoff") {
    json(res, 404, { error: "POST /listings/handoff" });
    return;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);

  let parsed;
  try {
    parsed = HandoffRequest.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch (err) {
    json(res, 400, { error: "invalid handoff request", detail: String(err) });
    return;
  }

  try {
    json(res, 200, await applyBuyerUpdate(parsed));
  } catch (err) {
    // A rejection the gateway described stays a 4xx for our storefront caller.
    if (err instanceof GatewayError) {
      json(res, err.status, { error: err.code, message: err.message });
      return;
    }
    json(res, 502, { error: "upstream_unreachable" });
  }
});

server.listen(port, () => {
  console.log(`listing handoff service on http://localhost:${port}`);
});
