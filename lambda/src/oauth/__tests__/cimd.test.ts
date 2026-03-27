import { isUrlClientId } from "../cimd";

// Only test the pure functions here — resolveClientId requires AWS mocks
// and is better tested via the oauth handler integration tests.

describe("isUrlClientId", () => {
  it("returns true for https URLs", () => {
    expect(isUrlClientId("https://example.com/client-metadata.json")).toBe(true);
  });

  it("returns true for http URLs", () => {
    expect(isUrlClientId("http://localhost:3000/metadata")).toBe(true);
  });

  it("returns false for plain strings", () => {
    expect(isUrlClientId("abc123def456")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isUrlClientId("")).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isUrlClientId(undefined)).toBe(false);
  });

  it("returns false for non-URL strings that look like IDs", () => {
    expect(isUrlClientId("7abc123def456789")).toBe(false);
  });

  it("returns true for URL with path component", () => {
    expect(isUrlClientId("https://my-app.example.com/.well-known/client-metadata.json")).toBe(true);
  });
});
