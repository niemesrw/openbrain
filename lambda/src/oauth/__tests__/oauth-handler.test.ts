import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";

// Mock AWS SDK clients before importing handler
jest.mock("@aws-sdk/client-cognito-identity-provider");
jest.mock("@aws-sdk/client-dynamodb");
jest.mock("@aws-sdk/lib-dynamodb", () => {
  const actual = jest.requireActual("@aws-sdk/lib-dynamodb");
  return {
    ...actual,
    DynamoDBDocumentClient: {
      from: jest.fn().mockReturnValue({
        send: jest.fn(),
      }),
    },
    PutCommand: actual.PutCommand,
  };
});

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch as any;

// Set required env vars before importing
process.env.USER_POOL_ID = "us-east-1_TestPool";
process.env.REGION = "us-east-1";
process.env.DCR_CLIENTS_TABLE = "openbrain-dcr-clients";
process.env.COGNITO_DOMAIN = "https://openbrain-test.auth.us-east-1.amazoncognito.com";
process.env.CUSTOM_DOMAIN = "openbrain.example.com";

import { handler } from "../../oauth";

function makeEvent(overrides: Partial<APIGatewayProxyEventV2> = {}): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: overrides.rawPath || "/",
    rawQueryString: "",
    headers: {},
    requestContext: {
      accountId: "123456789012",
      apiId: "test",
      domainName: "test.execute-api.us-east-1.amazonaws.com",
      domainPrefix: "test",
      http: {
        method: overrides.requestContext?.http?.method || "GET",
        path: overrides.rawPath || "/",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "test",
      },
      requestId: "test",
      routeKey: "$default",
      stage: "$default",
      time: "01/Jan/2026:00:00:00 +0000",
      timeEpoch: 0,
    },
    isBase64Encoded: false,
    ...overrides,
  } as APIGatewayProxyEventV2;
}

describe("OAuth handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /.well-known/oauth-protected-resource", () => {
    it("returns resource metadata with correct structure", async () => {
      const event = makeEvent({
        rawPath: "/.well-known/oauth-protected-resource",
        requestContext: { http: { method: "GET" } } as any,
      });

      const result = await handler(event) as APIGatewayProxyStructuredResultV2;
      const body = JSON.parse(result.body as string);

      expect(result.statusCode).toBe(200);
      expect(body.resource).toBe("https://openbrain.example.com/mcp");
      expect(body.authorization_servers).toEqual([
        "https://openbrain.example.com/.well-known/oauth-authorization-server",
      ]);
      expect(body.bearer_methods_supported).toEqual(["header"]);
      expect(body.scopes_supported).toContain("openid");
    });
  });

  describe("GET /.well-known/oauth-authorization-server", () => {
    it("proxies Cognito OIDC config and patches endpoints", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          issuer: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TestPool",
          authorization_endpoint: "https://openbrain-test.auth.us-east-1.amazoncognito.com/oauth2/authorize",
          token_endpoint: "https://openbrain-test.auth.us-east-1.amazoncognito.com/oauth2/token",
          jwks_uri: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TestPool/.well-known/jwks.json",
        }),
      });

      const event = makeEvent({
        rawPath: "/.well-known/oauth-authorization-server",
        requestContext: { http: { method: "GET" } } as any,
      });

      const result = await handler(event) as APIGatewayProxyStructuredResultV2;
      const body = JSON.parse(result.body as string);

      expect(result.statusCode).toBe(200);
      expect(body.registration_endpoint).toBe("https://openbrain.example.com/register");
      expect(body.authorization_endpoint).toBe("https://openbrain.example.com/oauth/authorize");
      expect(body.token_endpoint).toBe("https://openbrain.example.com/oauth/token");
      expect(body.code_challenge_methods_supported).toEqual(["S256"]);
      expect(body.client_id_metadata_document_supported).toBe(true);
      // Original Cognito fields preserved
      expect(body.issuer).toContain("cognito-idp");
      expect(body.jwks_uri).toContain("jwks.json");
    });

    it("returns 500 on Cognito fetch failure", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      const event = makeEvent({
        rawPath: "/.well-known/oauth-authorization-server",
        requestContext: { http: { method: "GET" } } as any,
      });

      const result = await handler(event) as APIGatewayProxyStructuredResultV2;
      expect(result.statusCode).toBe(500);
    });
  });

  describe("POST /register", () => {
    it("rejects missing redirect_uris with 400", async () => {
      const event = makeEvent({
        rawPath: "/register",
        requestContext: { http: { method: "POST" } } as any,
        body: JSON.stringify({ client_name: "test" }),
      });

      const result = await handler(event) as APIGatewayProxyStructuredResultV2;
      const body = JSON.parse(result.body as string);

      expect(result.statusCode).toBe(400);
      expect(body.error).toBe("invalid_client_metadata");
    });

    it("rejects invalid redirect_uris with 400", async () => {
      const event = makeEvent({
        rawPath: "/register",
        requestContext: { http: { method: "POST" } } as any,
        body: JSON.stringify({
          redirect_uris: ["not-a-url"],
          client_name: "test",
        }),
      });

      const result = await handler(event) as APIGatewayProxyStructuredResultV2;
      expect(result.statusCode).toBe(400);
    });

    it("rejects invalid JSON body", async () => {
      const event = makeEvent({
        rawPath: "/register",
        requestContext: { http: { method: "POST" } } as any,
        body: "not json",
      });

      const result = await handler(event) as APIGatewayProxyStructuredResultV2;
      expect(result.statusCode).toBe(400);
    });
  });

  describe("unknown routes", () => {
    it("returns 404 for unknown path", async () => {
      const event = makeEvent({
        rawPath: "/unknown",
        requestContext: { http: { method: "GET" } } as any,
      });

      const result = await handler(event) as APIGatewayProxyStructuredResultV2;
      expect(result.statusCode).toBe(404);
    });
  });
});
