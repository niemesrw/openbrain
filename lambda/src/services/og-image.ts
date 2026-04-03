import dns from "dns";
import { promisify } from "util";

const dnsResolve = promisify(dns.resolve4);

// Private/reserved IP ranges to block (SSRF protection)
const BLOCKED_IP_RANGES = [
  /^127\./, /^10\./, /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^192\.168\./, /^169\.254\./, /^0\./,
];

/**
 * Validate a URL for safety before fetching (SSRF protection).
 * Rejects non-http/https schemes, localhost, and private IP ranges.
 */
async function validateFetchUrl(urlString: string): Promise<void> {
  const parsed = new URL(urlString);

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("URL must use http or https");
  }

  const isLocalhost =
    parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (isLocalhost) {
    throw new Error("URL resolves to a blocked address");
  }

  const addresses = await dnsResolve(parsed.hostname);
  for (const ip of addresses) {
    if (BLOCKED_IP_RANGES.some((r) => r.test(ip))) {
      throw new Error("URL resolves to a blocked IP address");
    }
  }
}

/**
 * Fetches the og:image URL from an article URL by reading its HTML meta tags.
 * Returns undefined on any error (network failure, timeout, missing tag, etc.)
 * so callers can treat og:image as best-effort enrichment.
 */
export async function fetchOgImage(url: string): Promise<string | undefined> {
  try {
    await validateFetchUrl(url);

    const response = await fetch(url, {
      headers: { "User-Agent": "OpenBrain/1.0 (og:image extractor)" },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return undefined;
    // Read only the first 50 KB — og:image is always in <head>
    const reader = response.body?.getReader();
    if (!reader) return undefined;
    const decoder = new TextDecoder();
    let html = "";
    try {
      while (html.length < 50_000) {
        const { done, value } = await reader.read();
        if (done) break;
        html += decoder.decode(value, { stream: true });
        // Stop once we've passed </head> — no need to read the whole body
        if (/<\/head>/i.test(html)) break;
      }
    } finally {
      reader.cancel();
    }
    // Match <meta property="og:image" content="..." /> in either attribute order
    const match =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*\/?>/i) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*\/?>/i);
    if (!match?.[1]) return undefined;

    // Normalize relative URLs to absolute
    const resolved = new URL(match[1], url).toString();
    // Only return http/https image URLs
    const resolvedParsed = new URL(resolved);
    if (resolvedParsed.protocol !== "http:" && resolvedParsed.protocol !== "https:") {
      return undefined;
    }
    return resolved;
  } catch {
    return undefined;
  }
}
