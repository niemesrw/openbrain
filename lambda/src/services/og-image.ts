import dns from "dns";

// Private/reserved IPv4 ranges to block (SSRF protection)
const BLOCKED_IPv4_RANGES = [
  /^127\./, /^10\./, /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^192\.168\./, /^169\.254\./, /^0\./,
];

// Private/reserved IPv6 ranges to block (SSRF protection)
const BLOCKED_IPv6_RANGES = [
  /^::1$/i,     // loopback
  /^f[cd]/i,    // unique local (fc00::/7 — covers fc::/8 and fd::/8)
  /^fe[89ab]/i, // link-local (fe80::/10)
  /^::ffff:/i,  // IPv4-mapped (::ffff:0:0/96)
  /^64:ff9b:/i, // NAT64 (RFC 6052)
  /^2002:/i,    // 6to4 (can tunnel private IPv4)
  /^::$/,       // unspecified address
];

// Resolve all IPv4 and IPv6 addresses (matches cimd.ts SSRF protection)
function dnsLookupAll(hostname: string): Promise<Array<{ address: string; family: number }>> {
  return new Promise((resolve, reject) => {
    dns.lookup(hostname, { all: true }, (err, addresses) => {
      if (err) reject(err);
      else resolve(addresses as Array<{ address: string; family: number }>);
    });
  });
}

// Loopback hostnames blocked before DNS resolution (constant — not per-call)
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * Validate a URL for safety before fetching (SSRF protection).
 * Rejects non-http/https schemes, loopback hostnames, and private IP ranges (IPv4 + IPv6).
 */

async function validateFetchUrl(urlString: string): Promise<void> {
  const parsed = new URL(urlString);

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("URL must use http or https");
  }

  if (LOOPBACK_HOSTNAMES.has(parsed.hostname)) {
    throw new Error("URL resolves to a blocked address");
  }

  const addresses = await dnsLookupAll(parsed.hostname);
  for (const { address, family } of addresses) {
    const blocked = family === 4
      ? BLOCKED_IPv4_RANGES.some((r) => r.test(address))
      : BLOCKED_IPv6_RANGES.some((r) => r.test(address));
    if (blocked) {
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
