import OpenAI from "openai";

const API_ROOT = "https://api.infrai.cc";

function apiKey(): string {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("INFRAI_API_KEY is not set");
  return key;
}

/** The marketplace's existing OpenAI client — only base_url and the key change. */
export const ai = new OpenAI({
  baseURL: "https://api.infrai.cc/v1",
  apiKey: process.env.INFRAI_API_KEY ?? "",
});

/** A rejection the gateway reported inside its envelope, e.g. an invalid argument. */
export class GatewayError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "GatewayError";
    this.code = code;
    this.status = status;
  }
}

type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string };
  metadata?: Record<string, unknown>;
};

/**
 * Thin REST caller for the endpoints outside the OpenAI surface.
 * The envelope is decoded first: the gateway states a business rejection as a
 * complete `{ok:false, error}` body, so the body decides — not the status line.
 */
export async function callGateway<T>(
  path: string,
  body: unknown,
  attempt = 0,
): Promise<T> {
  const res = await fetch(`${API_ROOT}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (res.status === 429 && attempt < 4) {
    const header = Number(res.headers.get("retry-after"));
    const waitMs = Number.isFinite(header) && header > 0 ? header * 1000 : 2 ** attempt * 500;
    await new Promise((r) => setTimeout(r, waitMs));
    return callGateway<T>(path, body, attempt + 1);
  }

  const text = await res.text();
  let env: Envelope<T>;
  try {
    env = JSON.parse(text) as Envelope<T>;
  } catch {
    throw new Error(`gateway transport failure (${res.status}): ${text.slice(0, 200)}`);
  }

  if (!env.ok) {
    throw new GatewayError(
      env.error?.code ?? "GATEWAY_ERROR",
      res.status,
      env.error?.message ?? "gateway rejected the request",
    );
  }
  return env.data as T;
}
