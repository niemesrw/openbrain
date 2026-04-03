import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import dns from "dns";
import { promisify } from "util";

const dnsResolve = promisify(dns.resolve4);

const BLOCKED_IP_RANGES = [
  /^127\./, /^10\./, /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^192\.168\./, /^169\.254\./, /^0\./,
];

async function validateImageUrl(urlString: string): Promise<void> {
  const parsed = new URL(urlString);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("URL must use http or https");
  }
  const isLocalhost =
    parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (isLocalhost) throw new Error("URL resolves to a blocked address");
  const addresses = await dnsResolve(parsed.hostname);
  for (const ip of addresses) {
    if (BLOCKED_IP_RANGES.some((r) => r.test(ip))) {
      throw new Error("URL resolves to a blocked IP address");
    }
  }
}

const client = new BedrockRuntimeClient({});
const MODEL_ID =
  process.env.METADATA_MODEL_ID ?? "us.anthropic.claude-haiku-4-5-20251001-v1:0";

// Max image size to fetch: 4 MB
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

function mediaTypeFromUrl(url: string): string {
  const lower = url.toLowerCase().split("?")[0];
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

/**
 * Fetches an image from the given URL and uses Claude Haiku vision to generate
 * a concise description for semantic search indexing.
 * Returns undefined on any failure (network error, too large, model error, etc.)
 */
export async function describeImage(imageUrl: string): Promise<string | undefined> {
  try {
    await validateImageUrl(imageUrl);

    const response = await fetch(imageUrl, {
      headers: { "User-Agent": "OpenBrain/1.0 (image describer)" },
      signal: AbortSignal.timeout(10_000),
      redirect: "manual",
    });

    // Handle redirects manually to prevent SSRF via redirect to internal hosts
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) return undefined;
      await validateImageUrl(location);
      const redirected = await fetch(location, {
        headers: { "User-Agent": "OpenBrain/1.0 (image describer)" },
        signal: AbortSignal.timeout(10_000),
        redirect: "manual",
      });
      if (!redirected.ok) return undefined;
      const contentLengthR = redirected.headers.get("content-length");
      if (contentLengthR && parseInt(contentLengthR, 10) > MAX_IMAGE_BYTES) {
        throw new Error("Image too large");
      }
      const contentTypeR = redirected.headers.get("content-type") ?? "";
      const mediaTypeR = contentTypeR.startsWith("image/")
        ? contentTypeR.split(";")[0].trim()
        : mediaTypeFromUrl(location);
      const bufferR = await redirected.arrayBuffer();
      if (bufferR.byteLength > MAX_IMAGE_BYTES) return undefined;
      const base64R = Buffer.from(bufferR).toString("base64");
      const commandR = new InvokeModelCommand({
        modelId: MODEL_ID,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({
          anthropic_version: "bedrock-2023-05-31",
          max_tokens: 256,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: { type: "base64", media_type: mediaTypeR, data: base64R },
                },
                {
                  type: "text",
                  text: "Describe this image concisely in 1-3 sentences for semantic search indexing.",
                },
              ],
            },
          ],
        }),
      });
      const resultR = await client.send(commandR);
      const parsedR = JSON.parse(new TextDecoder().decode(resultR.body));
      const descriptionR = parsedR?.content?.[0]?.text as string | undefined;
      return descriptionR?.trim() || undefined;
    }

    if (!response.ok) return undefined;

    const contentType = response.headers.get("content-type") ?? "";
    const mediaType = contentType.startsWith("image/")
      ? contentType.split(";")[0].trim()
      : mediaTypeFromUrl(imageUrl);

    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_IMAGE_BYTES) {
      throw new Error("Image too large");
    }

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_IMAGE_BYTES) return undefined;

    const base64 = Buffer.from(buffer).toString("base64");

    const command = new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 256,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mediaType, data: base64 },
              },
              {
                type: "text",
                text: "Describe this image concisely in 1-3 sentences for semantic search indexing.",
              },
            ],
          },
        ],
      }),
    });

    const result = await client.send(command);
    const parsed = JSON.parse(new TextDecoder().decode(result.body));
    const description = parsed?.content?.[0]?.text as string | undefined;
    return description?.trim() || undefined;
  } catch {
    return undefined;
  }
}
