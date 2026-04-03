import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";

// Mock AWS SDK clients before importing handler
const mockCognitoSend = jest.fn();
jest.mock("@aws-sdk/client-cognito-identity-provider", () => ({
  CognitoIdentityProviderClient: jest.fn().mockImplementation(() => ({ send: mockCognitoSend })),
  CreateUserPoolClientCommand: jest.fn(),
  DescribeUserPoolClientCommand: jest.fn(),
  UpdateUserPoolClientCommand: jest.fn(),
}));
jest.mock("@aws-sdk/client-dynamodb");
const mockDdbSend = jest.fn();
jest.mock("@aws-sdk/lib-dynamodb", () => {
  const actual = jest.requireActual("@aws-sdk/lib-dynamodb");
  return {
    ...actual,
    DynamoDBDocumentClient: {
      from: jest.fn().mockReturnValue({ send: mockDdbSend }),
    },
    PutCommand: actual.PutCommand,
    GetCommand: actual.GetCommand,
    UpdateCommand: actual.UpdateCommand,
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
        "https://openbrain.example.com",
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
      // issuer overridden to baseUrl for RFC 8414 compliance
      expect(body.issuer).toBe("https://openbrain.example.com");
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

    it("returns 429 when rate limit is exceeded", async () => {
      const err = Object.assign(new Error("ConditionalCheckFailed"), {
        name: "ConditionalCheckFailedException",
      });
      mockDdbSend.mockRejectedValueOnce(err);

      const event = makeEvent({
        rawPath: "/register",
        requestContext: { http: { method: "POST", sourceIp: "1.2.3.4" } } as any,
        body: JSON.stringify({ redirect_uris: ["https://example.com/callback"] }),
      });

      const result = await handler(event) as APIGatewayProxyStructuredResultV2;
      expect(result.statusCode).toBe(429);
    });

    it("registers successfully when under rate limit", async () => {
      // UpdateCommand (rate limit) succeeds
      mockDdbSend.mockResolvedValueOnce({});
      // PutCommand (store DCR record) succeeds
      mockDdbSend.mockResolvedValueOnce({});
      mockCognitoSend.mockResolvedValueOnce({
        UserPoolClient: { ClientId: "new-client-abc", ClientName: "Test App" },
      });

      const event = makeEvent({
        rawPath: "/register",
        requestContext: { http: { method: "POST", sourceIp: "1.2.3.4" } } as any,
        body: JSON.stringify({
          redirect_uris: ["https://example.com/callback"],
          client_name: "Test App",
        }),
      });

      const result = await handler(event) as APIGatewayProxyStructuredResultV2;
      const body = JSON.parse(result.body as string);

      expect(result.statusCode).toBe(201);
      expect(body.client_id).toBe("new-client-abc");
      expect(body.redirect_uris).toEqual(["https://example.com/callback"]);
      expect(body.grant_types).toContain("authorization_code");
    });
  });

  describe("GET /.well-known/mcp.json", () => {
    it("returns MCP server card with required fields", async () => {
      const event = makeEvent({
        rawPath: "/.well-known/mcp.json",
        requestContext: { http: { method: "GET" } } as any,
      });

      const result = await handler(event) as APIGatewayProxyStructuredResultV2;
      const body = JSON.parse(result.body as string);

      expect(result.statusCode).toBe(200);
      expect(body.serverInfo.name).toBe("open-brain");
      expect(body.transport.type).toBe("streamable-http");
      expect(body.transport.endpoint).toBe("/mcp");
      expect(body.authentication.required).toBe(true);
      expect(body.authentication.schemes).toContain("oauth2");
      expect(body.tools).toEqual(["dynamic"]);
    });
  });

  describe("GET /llms.txt", () => {
    it("returns markdown with correct content type", async () => {
      const event = makeEvent({
        rawPath: "/llms.txt",
        requestContext: { http: { method: "GET" } } as any,
      });

      const result = await handler(event) as APIGatewayProxyStructuredResultV2;

      expect(result.statusCode).toBe(200);
      expect(result.headers?.["Content-Type"]).toContain("text/markdown");
      expect(result.body).toContain("# Open Brain");
      expect(result.body).toContain("search_thoughts");
      expect(result.body).toContain("/mcp");
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

  describe("GET /oauth/authorize — loopback redirect URI", () => {
    beforeEach(() => {
      // Pre-load Cognito metadata so authorize handler doesn't need to fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          issuer: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TestPool",
          authorization_endpoint: "https://openbrain-test.auth.us-east-1.amazoncognito.com/oauth2/authorize",
          token_endpoint: "https://openbrain-test.auth.us-east-1.amazoncognito.com/oauth2/token",
        }),
      });
    });

    it("updates Cognito CallbackURLs for loopback redirect with port when client is DCR-managed", async () => {
      // First call: auth server metadata fetch (triggers metadata load)
      // Then: DDB GetCommand returns DCR record
      mockDdbSend.mockResolvedValueOnce({ Item: { clientId: "test-client-123" } });
      // Then: Cognito DescribeUserPoolClient
      mockCognitoSend.mockResolvedValueOnce({
        UserPoolClient: {
          ClientName: "Test",
          CallbackURLs: ["http://127.0.0.1/callback", "http://localhost/callback"],
          AllowedOAuthFlows: ["code"],
          AllowedOAuthFlowsUserPoolClient: true,
          AllowedOAuthScopes: ["openid"],
          SupportedIdentityProviders: ["COGNITO", "Google"],
        },
      });
      // Then: Cognito UpdateUserPoolClient
      mockCognitoSend.mockResolvedValueOnce({});
      // Then: Cognito DescribeUserPoolClient poll — returns updated URLs so poll exits immediately
      mockCognitoSend.mockResolvedValueOnce({
        UserPoolClient: {
          CallbackURLs: ["http://127.0.0.1/callback", "http://localhost/callback", "http://127.0.0.1:54321/callback"],
        },
      });

      // First trigger metadata load
      const metaEvent = makeEvent({
        rawPath: "/.well-known/oauth-authorization-server",
        requestContext: { http: { method: "GET" } } as any,
      });
      await handler(metaEvent);

      // Now test authorize with loopback + port
      const event = makeEvent({
        rawPath: "/oauth/authorize",
        rawQueryString: "client_id=test-client-123&redirect_uri=http%3A%2F%2F127.0.0.1%3A54321%2Fcallback&response_type=code",
        queryStringParameters: {
          client_id: "test-client-123",
          redirect_uri: "http://127.0.0.1:54321/callback",
          response_type: "code",
        },
        requestContext: { http: { method: "GET" } } as any,
      });

      const result = await handler(event) as APIGatewayProxyStructuredResultV2;

      expect(result.statusCode).toBe(302);
      // Should have called DDB to check DCR ownership
      expect(mockDdbSend).toHaveBeenCalled();
      // Should have called Cognito to describe + update + at least one poll describe
      expect(mockCognitoSend).toHaveBeenCalledTimes(3);
    });

    it("skips update for non-DCR clients", async () => {
      // DDB GetCommand returns no item — not a DCR client
      mockDdbSend.mockResolvedValueOnce({ Item: undefined });

      // Trigger metadata load first
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          authorization_endpoint: "https://openbrain-test.auth.us-east-1.amazoncognito.com/oauth2/authorize",
          token_endpoint: "https://openbrain-test.auth.us-east-1.amazoncognito.com/oauth2/token",
        }),
      });
      const metaEvent = makeEvent({
        rawPath: "/.well-known/oauth-authorization-server",
        requestContext: { http: { method: "GET" } } as any,
      });
      await handler(metaEvent);

      const event = makeEvent({
        rawPath: "/oauth/authorize",
        rawQueryString: "client_id=static-client&redirect_uri=http%3A%2F%2F127.0.0.1%3A9999%2Fcallback",
        queryStringParameters: {
          client_id: "static-client",
          redirect_uri: "http://127.0.0.1:9999/callback",
        },
        requestContext: { http: { method: "GET" } } as any,
      });

      const result = await handler(event) as APIGatewayProxyStructuredResultV2;

      expect(result.statusCode).toBe(302);
      // Should NOT have called Cognito — not a DCR client
      expect(mockCognitoSend).not.toHaveBeenCalled();
    });

    it("skips update for non-loopback redirect URIs", async () => {
      const event = makeEvent({
        rawPath: "/oauth/authorize",
        rawQueryString: "client_id=test-client&redirect_uri=https%3A%2F%2Fexample.com%2Fcallback",
        queryStringParameters: {
          client_id: "test-client",
          redirect_uri: "https://example.com/callback",
        },
        requestContext: { http: { method: "GET" } } as any,
      });

      const result = await handler(event) as APIGatewayProxyStructuredResultV2;

      expect(result.statusCode).toBe(302);
      // Should not touch DDB or Cognito for non-loopback URIs
      expect(mockDdbSend).not.toHaveBeenCalled();
      expect(mockCognitoSend).not.toHaveBeenCalled();
    });
  });
});
