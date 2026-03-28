import { fetchOgImage } from "../og-image";

const mockFetch = jest.fn();
global.fetch = mockFetch;

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
});
