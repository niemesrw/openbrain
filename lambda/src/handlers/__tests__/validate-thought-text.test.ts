import { validateThoughtText } from "../validate-thought-text";

describe("validateThoughtText", () => {
  it("returns null for valid text", () => {
    expect(validateThoughtText("hello world")).toBeNull();
  });

  it("returns error for empty string", () => {
    expect(validateThoughtText("")).toBe("Error: text is required");
  });

  it("returns error for missing text (undefined)", () => {
    expect(validateThoughtText(undefined)).toBe("Error: text is required");
  });

  it("returns error for null", () => {
    expect(validateThoughtText(null)).toBe("Error: text is required");
  });

  it("returns error for non-string type", () => {
    expect(validateThoughtText(42)).toBe("Error: text is required");
  });

  it("returns null for text exactly at the limit", () => {
    expect(validateThoughtText("a".repeat(50_000))).toBeNull();
  });

  it("returns error for text exceeding the limit", () => {
    expect(validateThoughtText("a".repeat(50_001))).toBe(
      "Error: text exceeds maximum length of 50,000 characters"
    );
  });
});
