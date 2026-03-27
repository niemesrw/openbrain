import { handleTelegramLink } from "../telegram-link";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

jest.mock("@aws-sdk/client-dynamodb", () => {
  const actual = jest.requireActual("@aws-sdk/client-dynamodb");
  return {
    ...actual,
    DynamoDBClient: jest.fn().mockImplementation(() => ({
      send: jest.fn().mockResolvedValue({}),
    })),
  };
});

const USER = { userId: "user-abc", displayName: "Ryan" };

beforeEach(() => {
  process.env.TELEGRAM_TOKENS_TABLE = "openbrain-telegram-tokens";
  (DynamoDBClient as jest.MockedClass<typeof DynamoDBClient>).mockClear();
});

describe("handleTelegramLink", () => {
  it("returns a 6-character alphanumeric code", async () => {
    const result = await handleTelegramLink({}, USER);
    expect(result.code).toMatch(/^[A-Z0-9]{6}$/);
  });

  it("sets expiresAt to ~10 minutes from now (in ms)", async () => {
    const before = Date.now();
    const result = await handleTelegramLink({}, USER);
    const after = Date.now();
    const tenMin = 10 * 60 * 1000;
    expect(result.expiresAt).toBeGreaterThanOrEqual(before + tenMin - 1000);
    expect(result.expiresAt).toBeLessThanOrEqual(after + tenMin + 1000);
  });

  it("returns code and expiresAt in result", async () => {
    const result = await handleTelegramLink({}, USER);
    expect(result).toHaveProperty("code");
    expect(result).toHaveProperty("expiresAt");
    expect(typeof result.code).toBe("string");
    expect(typeof result.expiresAt).toBe("number");
  });

  it("succeeds even when user has no displayName", async () => {
    const result = await handleTelegramLink({}, { userId: "user-xyz" });
    expect(result.code).toMatch(/^[A-Z0-9]{6}$/);
  });

  it("can generate multiple codes with valid format", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => handleTelegramLink({}, USER))
    );
    results.forEach((r) => {
      expect(r.code).toMatch(/^[A-Z0-9]{6}$/);
    });
  });
});
