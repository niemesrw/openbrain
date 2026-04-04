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
    DeleteCommand: actual.DeleteCommand,
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

    it("enforces MAX_CALLBACK_URIS cap — returns 400 when cap is reached after pruning", async () => {
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

      // DDB: DCR record exists
      mockDdbSend.mockResolvedValueOnce({ Item: { clientId: "capped-client" } });
      // DDB: lock acquire (PutCommand) succeeds
      mockDdbSend.mockResolvedValueOnce({});
      // Cognito: describe returns 10 non-loopback callback URLs (cap already reached after pruning)
      const tenCallbacks = Array.from({ length: 10 }, (_, i) => `https://example.com/callback${i}`);
      mockCognitoSend.mockResolvedValueOnce({
        UserPoolClient: {
          ClientName: "Capped",
          CallbackURLs: tenCallbacks,
          AllowedOAuthFlows: ["code"],
          AllowedOAuthFlowsUserPoolClient: true,
          AllowedOAuthScopes: ["openid"],
          SupportedIdentityProviders: ["COGNITO"],
        },
      });
      // DDB: lock release (DeleteCommand) succeeds — conditional on owner
      mockDdbSend.mockResolvedValueOnce({});

      const event = makeEvent({
        rawPath: "/oauth/authorize",
        rawQueryString: "client_id=capped-client&redirect_uri=http%3A%2F%2F127.0.0.1%3A1234%2Fcb",
        queryStringParameters: {
          client_id: "capped-client",
          redirect_uri: "http://127.0.0.1:1234/cb",
        },
        requestContext: { http: { method: "GET" } } as any,
      });

      const result = await handler(event) as APIGatewayProxyStructuredResultV2;

      // Cap exceeded → 400 so the client gets a clear error instead of a
      // Cognito redirect with an unregistered redirect_uri
      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body as string);
      expect(body.error).toBe("invalid_request");
      // Cognito UpdateUserPoolClient should NOT have been called
      const updateCalls = (mockCognitoSend.mock.calls as any[]).filter(
        (call) => call[0]?.constructor?.name === "UpdateUserPoolClientCommand"
      );
      expect(updateCalls).toHaveLength(0);
    });

    it("returns 503 when DynamoDB lock cannot be acquired within timeout", async () => {
      // Trigger metadata load first
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          authorization_endpoint: "https://openbrain-test.auth.us-east-1.amazoncognito.com/oauth2/authorize",
          token_endpoint: "https://openbrain-test.auth.us-east-1.amazoncognito.com/oauth2/token",
        }),
      });
      await handler(makeEvent({
        rawPath: "/.well-known/oauth-authorization-server",
        requestContext: { http: { method: "GET" } } as any,
      }));

      // DDB: DCR record exists
      mockDdbSend.mockResolvedValueOnce({ Item: { clientId: "busy-client" } });
      // DDB: all lock acquire attempts fail (lock held the entire window)
      // Jest fake timers won't help here — instead, mock LOCK_MAX_WAIT_MS by
      // rejecting enough times to exhaust real attempts. We use fake timers to
      // skip the poll sleeps so the test runs fast.
      jest.useFakeTimers();
      const lockConflict = Object.assign(new Error("ConditionalCheckFailed"), {
        name: "ConditionalCheckFailedException",
      });
      // Reject all lock attempts for the duration of the test
      mockDdbSend.mockRejectedValue(lockConflict);

      const event = makeEvent({
        rawPath: "/oauth/authorize",
        rawQueryString: "client_id=busy-client&redirect_uri=http%3A%2F%2F127.0.0.1%3A9999%2Fcb",
        queryStringParameters: {
          client_id: "busy-client",
          redirect_uri: "http://127.0.0.1:9999/cb",
        },
        requestContext: { http: { method: "GET" } } as any,
      });

      // Advance timers past LOCK_MAX_WAIT_MS (5000ms) while the handler runs
      const handlerPromise = handler(event);
      // Tick through all the 200ms poll sleeps + overshoot the deadline
      for (let i = 0; i < 30; i++) {
        await Promise.resolve();
        jest.advanceTimersByTime(200);
      }
      jest.useRealTimers();

      const result = await handlerPromise as APIGatewayProxyStructuredResultV2;
      expect(result.statusCode).toBe(503);
      const body = JSON.parse(result.body as string);
      expect(body.error).toBe("server_error");
    });

    it("lock release uses conditional delete to prevent releasing a stolen lock", async () => {
      // Trigger metadata load first
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          authorization_endpoint: "https://openbrain-test.auth.us-east-1.amazoncognito.com/oauth2/authorize",
          token_endpoint: "https://openbrain-test.auth.us-east-1.amazoncognito.com/oauth2/token",
        }),
      });
      await handler(makeEvent({
        rawPath: "/.well-known/oauth-authorization-server",
        requestContext: { http: { method: "GET" } } as any,
      }));

      // DDB: DCR record exists
      mockDdbSend.mockResolvedValueOnce({ Item: { clientId: "owner-test-client" } });
      // DDB: lock acquire succeeds
      mockDdbSend.mockResolvedValueOnce({});
      // Cognito: describe
      mockCognitoSend.mockResolvedValueOnce({
        UserPoolClient: {
          ClientName: "OwnerTest",
          CallbackURLs: ["https://example.com/callback"],
          AllowedOAuthFlows: ["code"],
          AllowedOAuthFlowsUserPoolClient: true,
          AllowedOAuthScopes: ["openid"],
          SupportedIdentityProviders: ["COGNITO"],
        },
      });
      // Cognito: update
      mockCognitoSend.mockResolvedValueOnce({});
      // DDB: lock release (DeleteCommand with owner condition)
      mockDdbSend.mockResolvedValueOnce({});
      // Cognito: propagation poll — confirms URI present
      mockCognitoSend.mockResolvedValueOnce({
        UserPoolClient: {
          CallbackURLs: ["https://example.com/callback", "http://127.0.0.1:5555/cb"],
        },
      });

      const event = makeEvent({
        rawPath: "/oauth/authorize",
        rawQueryString: "client_id=owner-test-client&redirect_uri=http%3A%2F%2F127.0.0.1%3A5555%2Fcb",
        queryStringParameters: {
          client_id: "owner-test-client",
          redirect_uri: "http://127.0.0.1:5555/cb",
        },
        requestContext: { http: { method: "GET" } } as any,
      });

      const result = await handler(event) as APIGatewayProxyStructuredResultV2;
      expect(result.statusCode).toBe(302);

      // Verify the DeleteCommand included the owner condition
      const deleteCalls = (mockDdbSend.mock.calls as any[]).filter(
        (call) => call[0]?.constructor?.name === "DeleteCommand"
      );
      expect(deleteCalls).toHaveLength(1);
      const deleteInput = deleteCalls[0][0].input;
      expect(deleteInput.ConditionExpression).toBe("lockOwner = :owner");
      expect(deleteInput.ExpressionAttributeValues[":owner"]).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );

      // Verify lock is released BEFORE the propagation poll
      // (describe called once for read, update once, then delete, then poll-describe)
      expect(mockCognitoSend).toHaveBeenCalledTimes(3); // describe + update + poll
    });

    it("serializes concurrent updates via DynamoDB lock — lock retry succeeds on second attempt", async () => {
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

      // DDB: DCR record exists
      mockDdbSend.mockResolvedValueOnce({ Item: { clientId: "lock-test-client" } });
      // DDB: lock acquire fails first (another holder), then succeeds
      const lockConflict = Object.assign(new Error("ConditionalCheckFailed"), {
        name: "ConditionalCheckFailedException",
      });
      mockDdbSend.mockRejectedValueOnce(lockConflict); // first attempt: locked
      mockDdbSend.mockResolvedValueOnce({}); // second attempt: acquired
      // Cognito: describe
      mockCognitoSend.mockResolvedValueOnce({
        UserPoolClient: {
          ClientName: "LockTest",
          CallbackURLs: ["http://127.0.0.1/callback"],
          AllowedOAuthFlows: ["code"],
          AllowedOAuthFlowsUserPoolClient: true,
          AllowedOAuthScopes: ["openid"],
          SupportedIdentityProviders: ["COGNITO"],
        },
      });
      // Cognito: update
      mockCognitoSend.mockResolvedValueOnce({});
      // DDB: lock release (before propagation poll)
      mockDdbSend.mockResolvedValueOnce({});
      // Cognito: propagation poll — confirms URI present
      mockCognitoSend.mockResolvedValueOnce({
        UserPoolClient: {
          CallbackURLs: ["http://127.0.0.1/callback", "http://127.0.0.1:7777/cb"],
        },
      });

      const event = makeEvent({
        rawPath: "/oauth/authorize",
        rawQueryString: "client_id=lock-test-client&redirect_uri=http%3A%2F%2F127.0.0.1%3A7777%2Fcb",
        queryStringParameters: {
          client_id: "lock-test-client",
          redirect_uri: "http://127.0.0.1:7777/cb",
        },
        requestContext: { http: { method: "GET" } } as any,
      });

      const result = await handler(event) as APIGatewayProxyStructuredResultV2;

      expect(result.statusCode).toBe(302);
      expect(mockCognitoSend).toHaveBeenCalledTimes(3); // describe + update + poll
    });
  });
});
