import dns from "dns";
import { fetchOgImage } from "../og-image";

const mockFetch = jest.fn();
global.fetch = mockFetch;

jest.mock("dns");
const mockDnsLookup = dns.lookup as unknown as jest.Mock;

/** Simulate dns.lookup returning a specific set of addresses */
function stubDns(addresses: Array<{ address: string; family: number }>) {
  mockDnsLookup.mockImplementation(
    (_host: string, _opts: unknown, cb: (err: null, addrs: typeof addresses) => void) => {
      cb(null, addresses);
    }
  );
}

function makeStream(html: string) {
  const encoder = new TextEncoder();
  const chunks = [encoder.encode(html)];
  let index = 0;
  const reader = {
    read: jest.fn(async () => {
      if (index < chunks.length) return { done: false, value: chunks[index++] };
      return { done: true, value: undefined };
    }),
    cancel: jest.fn(),
  };
  return { getReader: () => reader };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default: DNS resolves to a benign public IP so non-SSRF tests can proceed
  stubDns([{ address: "93.184.216.34", family: 4 }]); // example.com
});

describe("fetchOgImage", () => {
  it("returns og:image URL when property comes before content", async () => {
    const html = `<html><head><meta property="og:image" content="https://example.com/img.jpg" /></head></html>`;
    mockFetch.mockResolvedValue({ ok: true, body: makeStream(html) });

    const result = await fetchOgImage("https://example.com/article");

    expect(result).toBe("https://example.com/img.jpg");
  });

  it("returns og:image URL when content comes before property", async () => {
    const html = `<html><head><meta content="https://example.com/img2.jpg" property="og:image" /></head></html>`;
    mockFetch.mockResolvedValue({ ok: true, body: makeStream(html) });

    const result = await fetchOgImage("https://example.com/article");

    expect(result).toBe("https://example.com/img2.jpg");
  });

  it("returns undefined when og:image tag is absent", async () => {
    const html = `<html><head><title>No OG</title></head></html>`;
    mockFetch.mockResolvedValue({ ok: true, body: makeStream(html) });

    const result = await fetchOgImage("https://example.com/article");

    expect(result).toBeUndefined();
  });

  it("returns undefined when response is not ok", async () => {
    mockFetch.mockResolvedValue({ ok: false, body: makeStream("") });

    const result = await fetchOgImage("https://example.com/404");

    expect(result).toBeUndefined();
  });

  it("returns undefined when fetch throws", async () => {
    mockFetch.mockRejectedValue(new Error("network error"));

    const result = await fetchOgImage("https://example.com/article");

    expect(result).toBeUndefined();
  });

  it("returns undefined when body is null", async () => {
    mockFetch.mockResolvedValue({ ok: true, body: null });

    const result = await fetchOgImage("https://example.com/article");

    expect(result).toBeUndefined();
  });

  // SSRF protection — validateFetchUrl
  describe("SSRF protection", () => {
    it("blocks private IPv4 (10.x.x.x)", async () => {
      stubDns([{ address: "10.0.0.1", family: 4 }]);
      const result = await fetchOgImage("https://internal.example.com/page");
      expect(result).toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("blocks link-local IPv4 (169.254.x.x — AWS IMDS)", async () => {
      stubDns([{ address: "169.254.169.254", family: 4 }]);
      const result = await fetchOgImage("https://imds.example.com/page");
      expect(result).toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("blocks private IPv4 (192.168.x.x)", async () => {
      stubDns([{ address: "192.168.1.1", family: 4 }]);
      const result = await fetchOgImage("https://lan.example.com/page");
      expect(result).toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("blocks IPv6 loopback (::1)", async () => {
      stubDns([{ address: "::1", family: 6 }]);
      const result = await fetchOgImage("https://v6loop.example.com/page");
      expect(result).toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("blocks IPv6 unique-local (fd00::/8)", async () => {
      stubDns([{ address: "fd12:3456:789a::1", family: 6 }]);
      const result = await fetchOgImage("https://v6ula.example.com/page");
      expect(result).toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("blocks IPv6 link-local (fe80::/10)", async () => {
      stubDns([{ address: "fe80::1", family: 6 }]);
      const result = await fetchOgImage("https://v6ll.example.com/page");
      expect(result).toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("blocks localhost hostname without DNS lookup", async () => {
      const result = await fetchOgImage("https://localhost/page");
      expect(result).toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("blocks 127.0.0.1 hostname without DNS lookup", async () => {
      const result = await fetchOgImage("https://127.0.0.1/page");
      expect(result).toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("permits a public IP and proceeds to fetch", async () => {
      stubDns([{ address: "93.184.216.34", family: 4 }]); // example.com
      mockFetch.mockResolvedValue({ ok: false }); // fetch fails but was called
      await fetchOgImage("https://public.example.com/page");
      expect(mockFetch).toHaveBeenCalled();
    });
  });
});
