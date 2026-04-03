import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import {
  CognitoIdentityProviderClient,
  CreateUserPoolClientCommand,
  DescribeUserPoolClientCommand,
  UpdateUserPoolClientCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { isUrlClientId, resolveClientId } from "./oauth/cimd";

const USER_POOL_ID = process.env.USER_POOL_ID!;
const REGION = process.env.REGION || "us-east-1";
const CUSTOM_DOMAIN = process.env.CUSTOM_DOMAIN;
const DCR_CLIENTS_TABLE = process.env.DCR_CLIENTS_TABLE!;

const cognito = new CognitoIdentityProviderClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Cached original Cognito endpoints (populated on first metadata fetch)
let cognitoAuthEndpoint: string | null = null;
let cognitoTokenEndpoint: string | null = null;

function getBaseUrl(event: APIGatewayProxyEventV2): string {
  return CUSTOM_DOMAIN
    ? `https://${CUSTOM_DOMAIN}`
    : `https://${event.requestContext.domainName}`;
}

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(body),
  };
}

// --- Route handlers ---

function handleProtectedResourceMetadata(event: APIGatewayProxyEventV2): APIGatewayProxyResultV2 {
  const baseUrl = getBaseUrl(event);
  return json(200, {
    resource: `${baseUrl}/mcp`,
    authorization_servers: [baseUrl],
    bearer_methods_supported: ["header"],
    scopes_supported: ["openid", "profile", "email"],
  });
}

async function handleAuthServerMetadata(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const baseUrl = getBaseUrl(event);
  const cognitoOidcUrl = `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}/.well-known/openid-configuration`;

  try {
    const response = await fetch(cognitoOidcUrl);
    if (!response.ok) throw new Error(`Cognito OIDC fetch failed: ${response.status}`);
    const metadata = await response.json() as Record<string, any>;

    // Save original endpoints for proxying
    cognitoAuthEndpoint = metadata.authorization_endpoint;
    cognitoTokenEndpoint = metadata.token_endpoint;

    // Patch for MCP spec compliance and interoperability with all MCP clients
    // Override issuer to match baseUrl so it aligns with what's advertised in
    // authorization_servers per RFC 9728 — RFC 8414 clients reject a mismatch
    metadata.issuer = baseUrl;
    metadata.registration_endpoint = `${baseUrl}/register`;
    metadata.code_challenge_methods_supported = ["S256"];
    metadata.client_id_metadata_document_supported = true;
    // Override scopes to match what DCR clients are granted (Cognito
    // advertises "phone" but our DCR clients don't include it, causing
    // invalid_scope errors when clients request all advertised scopes)
    metadata.scopes_supported = ["openid", "profile", "email"];
    // MCP requires authorization_code + PKCE; implicit ("token") is
    // deprecated in OAuth 2.1 and should not be advertised
    metadata.grant_types_supported = ["authorization_code", "refresh_token"];
    metadata.response_types_supported = ["code"];
    // DCR creates public clients (no secret) per RFC 8252
    metadata.token_endpoint_auth_methods_supported = ["none", "client_secret_post"];

    // Override endpoints to our proxy
    metadata.authorization_endpoint = `${baseUrl}/oauth/authorize`;
    metadata.token_endpoint = `${baseUrl}/oauth/token`;

    return json(200, metadata);
  } catch (error: any) {
    console.error("Error proxying auth server metadata:", error.message);
    return json(500, {
      error: "server_error",
      error_description: "Unable to retrieve authorization server metadata",
    });
  }
}

const DCR_RATE_LIMIT = 10; // max registrations per IP per hour

/**
 * Atomically increment a per-IP registration counter with a 1-hour window.
 * Returns false if the rate limit is exceeded.
 */
async function checkDcrRateLimit(sourceIp: string): Promise<boolean> {
  // Bucket by hour so the counter resets naturally without relying on DynamoDB TTL latency
  const hourBucket = new Date().toISOString().slice(0, 13); // e.g. "2026-03-30T13"
  const windowExpiry = Math.floor(Date.now() / 1000) + 7200; // 2h TTL keeps the record for one extra hour after the window closes
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: DCR_CLIENTS_TABLE,
        Key: { clientId: `ratelimit#${sourceIp}#${hourBucket}` },
        UpdateExpression: "ADD #cnt :one SET #type = if_not_exists(#type, :ratelimit), expiresAt = if_not_exists(expiresAt, :exp)",
        ExpressionAttributeNames: { "#cnt": "count", "#type": "type" },
        ExpressionAttributeValues: {
          ":one": 1,
          ":exp": windowExpiry,
          ":limit": DCR_RATE_LIMIT,
          ":ratelimit": "ratelimit",
        },
        ConditionExpression: "attribute_not_exists(#cnt) OR #cnt < :limit",
      })
    );
    return true;
  } catch (err: any) {
    if (err.name === "ConditionalCheckFailedException") return false;
    // Fail closed: if DynamoDB is unavailable, deny registration rather than
    // silently disabling rate limiting during an outage
    console.error("DCR rate limit check error:", err instanceof Error ? err.message : String(err));
    return false;
  }
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isLoopbackUri(uri: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(uri).hostname);
  } catch {
    return false;
  }
}

/**
 * Per RFC 8252 §7.3, authorization servers MUST allow any port for loopback
 * redirect URIs. Cognito requires exact URL matches, so we bridge the gap by
 * updating the Cognito client's CallbackURLs to include the requested URI.
 *
 * Security: only updates clients managed by our DCR (checked via DynamoDB).
 * Pruning: replaces old ephemeral-port loopback URLs with the current one,
 * keeping only the canonical (port-less) entries + the active port.
 * Concurrency: retries on conflict up to 3 times.
 */
async function ensureLoopbackRedirectUri(cognitoClientId: string, redirectUri: string): Promise<void> {
  try {
    const parsed = new URL(redirectUri);
    if (!LOOPBACK_HOSTS.has(parsed.hostname) || !parsed.port) return;

    // Only update DCR-managed clients — reject arbitrary client IDs
    const dcrRecord = await ddb.send(
      new GetCommand({
        TableName: DCR_CLIENTS_TABLE,
        Key: { clientId: cognitoClientId },
      })
    );
    if (!dcrRecord.Item) return; // not a DCR client, skip

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const describeResult = await cognito.send(
          new DescribeUserPoolClientCommand({
            UserPoolId: USER_POOL_ID,
            ClientId: cognitoClientId,
          })
        );

        const client = describeResult.UserPoolClient!;
        const existingCallbacks = client.CallbackURLs ?? [];

        if (existingCallbacks.includes(redirectUri)) return;

        // Prune old ephemeral-port loopback URLs, keep canonical (no port) ones
        const prunedCallbacks = existingCallbacks.filter((url) => {
          try {
            const u = new URL(url);
            return !LOOPBACK_HOSTS.has(u.hostname) || !u.port;
          } catch {
            return true;
          }
        });

        // Cognito UpdateUserPoolClient replaces the full client config —
        // all fields not included are reset to defaults. We must re-send
        // the fields we want to preserve.
        await cognito.send(
          new UpdateUserPoolClientCommand({
            UserPoolId: USER_POOL_ID,
            ClientId: cognitoClientId,
            ClientName: client.ClientName,
            CallbackURLs: [...prunedCallbacks, redirectUri],
            LogoutURLs: client.LogoutURLs,
            AllowedOAuthFlows: client.AllowedOAuthFlows,
            AllowedOAuthFlowsUserPoolClient: client.AllowedOAuthFlowsUserPoolClient,
            AllowedOAuthScopes: client.AllowedOAuthScopes,
            SupportedIdentityProviders: client.SupportedIdentityProviders,
            ExplicitAuthFlows: client.ExplicitAuthFlows,
            PreventUserExistenceErrors: client.PreventUserExistenceErrors,
            TokenValidityUnits: client.TokenValidityUnits,
            AccessTokenValidity: client.AccessTokenValidity,
            IdTokenValidity: client.IdTokenValidity,
            RefreshTokenValidity: client.RefreshTokenValidity,
          })
        );
        // Poll until Cognito propagates the new callback URL (eventual consistency).
        // Times out after 5s and falls through — same behaviour as a fixed sleep but
        // much faster on the happy path (usually 1-3 polls).
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 300));
          const check = await cognito.send(
            new DescribeUserPoolClientCommand({
              UserPoolId: USER_POOL_ID,
              ClientId: cognitoClientId,
            })
          );
          if (check.UserPoolClient?.CallbackURLs?.includes(redirectUri)) return;
        }
        return;
      } catch (error: any) {
        if (attempt < 2 && error?.$metadata?.httpStatusCode === 409) continue;
        throw error;
      }
    }
  } catch (error: any) {
    console.error("Failed to update Cognito client callback URLs:", error.message);
  }
}

async function handleAuthorize(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const params = event.queryStringParameters ?? {};
  const clientId = params.client_id;

  if (!cognitoAuthEndpoint) {
    // Try to load metadata first
    await loadCognitoMetadata();
    if (!cognitoAuthEndpoint) {
      return json(503, {
        error: "server_error",
        error_description: "Authorization server metadata not yet loaded",
      });
    }
  }

  const authUrl = new URL(cognitoAuthEndpoint);

  // Copy all query params except client_id (we may remap it)
  for (const [key, value] of Object.entries(params)) {
    if (key !== "client_id" && value) {
      authUrl.searchParams.set(key, value);
    }
  }

  let resolvedClientId: string | undefined;

  if (isUrlClientId(clientId)) {
    try {
      const mapping = await resolveClientId(clientId!);
      resolvedClientId = mapping.clientId;
      authUrl.searchParams.set("client_id", resolvedClientId);
    } catch (error: any) {
      return json(400, {
        error: "invalid_client_metadata",
        error_description: error.message,
      });
    }
  } else if (clientId) {
    resolvedClientId = clientId;
    authUrl.searchParams.set("client_id", clientId);
  }

  // RFC 8252 §7.3: allow any port for loopback redirect URIs.
  // Cognito requires exact match, so add the specific port to the client's callback URLs.
  if (resolvedClientId && params.redirect_uri) {
    await ensureLoopbackRedirectUri(resolvedClientId, params.redirect_uri);
  }

  return {
    statusCode: 302,
    headers: { Location: authUrl.toString() },
    body: "",
  };
}

async function handleToken(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  if (!cognitoTokenEndpoint) {
    await loadCognitoMetadata();
    if (!cognitoTokenEndpoint) {
      return json(503, {
        error: "server_error",
        error_description: "Authorization server metadata not yet loaded",
      });
    }
  }

  // Parse URL-encoded body
  const bodyStr = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64").toString()
    : event.body || "";
  const params = new URLSearchParams(bodyStr);

  const clientId = params.get("client_id");

  if (isUrlClientId(clientId ?? undefined)) {
    try {
      const mapping = await resolveClientId(clientId!);
      // Replace URL-based client_id with the mapped Cognito client_id
      params.set("client_id", mapping.clientId);
    } catch (error: any) {
      return json(400, {
        error: "invalid_client_metadata",
        error_description: error.message,
      });
    }
  }

  // Forward to Cognito token endpoint, preserving client auth headers
  try {
    const forwardHeaders: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
    };
    const incomingAuth = event.headers?.authorization || event.headers?.Authorization;
    if (incomingAuth) {
      forwardHeaders.Authorization = incomingAuth;
    }

    const tokenResponse = await fetch(cognitoTokenEndpoint, {
      method: "POST",
      headers: forwardHeaders,
      body: params.toString(),
    });

    const tokenBody = await tokenResponse.json();

    return json(tokenResponse.status, tokenBody);
  } catch (error: any) {
    console.error("Token proxy error:", error.message);
    return json(500, {
      error: "server_error",
      error_description: "Token exchange failed",
    });
  }
}

async function handleRegister(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const sourceIp = event.requestContext.http.sourceIp;
  if (!(await checkDcrRateLimit(sourceIp))) {
    return json(429, {
      error: "server_error",
      error_description: "Too many registration requests. Please try again later.",
    });
  }

  let body: any;
  try {
    const bodyStr = event.isBase64Encoded
      ? Buffer.from(event.body || "", "base64").toString()
      : event.body || "";
    body = JSON.parse(bodyStr);
  } catch {
    return json(400, {
      error: "invalid_client_metadata",
      error_description: "Invalid JSON body",
    });
  }

  if (!Array.isArray(body.redirect_uris) || body.redirect_uris.length === 0) {
    return json(400, {
      error: "invalid_client_metadata",
      error_description: "redirect_uris is required and must be a non-empty array",
    });
  }

  // Validate each redirect_uri — must be https or http://localhost
  for (const uri of body.redirect_uris) {
    let parsed: URL;
    try {
      parsed = new URL(uri);
    } catch {
      return json(400, {
        error: "invalid_client_metadata",
        error_description: "One or more redirect_uris are invalid",
      });
    }
    const isHttps = parsed.protocol === "https:";
    const isLocalhostHttp = parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1");
    if (!isHttps && !isLocalhostHttp) {
      return json(400, {
        error: "invalid_client_metadata",
        error_description: "redirect_uris must use https (or http://localhost, http://127.0.0.1, or http://[::1] for native clients)",
      });
    }
  }

  const clientName = body.client_name || `DCR Client ${Date.now()}`;

  try {
    const result = await cognito.send(
      new CreateUserPoolClientCommand({
        UserPoolId: USER_POOL_ID,
        ClientName: clientName,
        GenerateSecret: false,
        AllowedOAuthFlows: ["code"],
        AllowedOAuthFlowsUserPoolClient: true,
        AllowedOAuthScopes: ["openid", "profile", "email"],
        CallbackURLs: body.redirect_uris,
        SupportedIdentityProviders: ["COGNITO", "Google"],
        PreventUserExistenceErrors: "ENABLED",
        TokenValidityUnits: {
          AccessToken: "hours",
          IdToken: "hours",
          RefreshToken: "days",
        },
        AccessTokenValidity: 1,
        IdTokenValidity: 1,
        RefreshTokenValidity: 30,
      })
    );

    const client = result.UserPoolClient!;

    const registration: Record<string, any> = {
      client_id: client.ClientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: body.redirect_uris,
      grant_types: ["authorization_code", "refresh_token"],
      token_endpoint_auth_method: "none",
      response_types: ["code"],
      client_name: clientName,
      scope: "openid profile email",
    };

    // Store in DynamoDB with TTL for automatic cleanup
    const expiresAt = Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60; // 90 days
    await ddb.send(
      new PutCommand({
        TableName: DCR_CLIENTS_TABLE,
        Item: {
          clientId: client.ClientId!,
          clientName,
          redirectUris: JSON.stringify(body.redirect_uris),
          scope: "openid profile email",
          createdAt: new Date().toISOString(),
          expiresAt,
        },
      })
    );

    return json(201, registration);
  } catch (error: any) {
    console.error("DCR error:", error.message);
    return json(500, {
      error: "server_error",
      error_description: "An error occurred during client registration",
    });
  }
}

// --- MCP Server Card (SEP-1649) ---

function handleMcpServerCard(_event: APIGatewayProxyEventV2): APIGatewayProxyResultV2 {
  return json(200, {
    $schema: "https://static.modelcontextprotocol.io/schemas/mcp-server-card/v1.json",
    version: "1.0",
    protocolVersion: "2025-06-18",
    serverInfo: {
      name: "open-brain",
      title: "Open Brain",
      version: "2.0.0",
    },
    description: "Personal AI knowledge base with semantic search. One brain shared across all your AI clients.",
    documentationUrl: "https://github.com/niemesrw/openbrain",
    transport: {
      type: "streamable-http",
      endpoint: "/mcp",
    },
    authentication: {
      required: true,
      schemes: ["oauth2", "apiKey"],
    },
    tools: ["dynamic"],
    capabilities: {},
  });
}

// --- llms.txt ---

function handleLlmsTxt(event: APIGatewayProxyEventV2): APIGatewayProxyResultV2 {
  const baseUrl = getBaseUrl(event);
  const body = `# Open Brain

> Personal AI knowledge base with semantic search. One brain shared across Claude, ChatGPT, Gemini, Cursor — all your AI clients.

Open Brain is an MCP server that stores thoughts, decisions, notes, and memories as vector embeddings with semantic search. Connect any MCP-compatible AI client and authenticate via Google OAuth automatically.

## MCP Server

- [MCP Endpoint](${baseUrl}/mcp): Streamable HTTP transport, OAuth 2.1 auth
- [Server Card](${baseUrl}/.well-known/mcp.json): MCP server discovery metadata
- [OAuth Discovery](${baseUrl}/.well-known/oauth-protected-resource): OAuth protected resource metadata
- [GitHub Repository](https://github.com/niemesrw/openbrain): Source code and setup guide

## Tools

- search_thoughts: Semantic search — finds thoughts by meaning
- browse_recent: Browse chronologically, filter by type or topic
- stats: Overview — total thoughts, types, topics, people
- capture_thought: Save a thought from any connected AI
- update_thought: Edit an existing thought (re-embeds + re-extracts metadata)
- delete_thought: Remove a thought by ID (ownership verified)
- create_agent: Register a new agent and generate an API key
- list_agents: Show all agents for the authenticated user
- revoke_agent: Disable an agent's API key
- bus_activity: Monitor shared feed — activity grouped by agent

## Optional

- [Skills for Claude Desktop](https://github.com/niemesrw/openbrain/blob/main/skills/claude-desktop.md): Project instructions
- [Skills for ChatGPT](https://github.com/niemesrw/openbrain/blob/main/skills/chatgpt-instructions.md): Custom GPT instructions
`;

  return {
    statusCode: 200,
    headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=86400" },
    body,
  };
}

// Helper to pre-load Cognito metadata for proxy endpoints
async function loadCognitoMetadata(): Promise<void> {
  if (cognitoAuthEndpoint && cognitoTokenEndpoint) return;

  const cognitoOidcUrl = `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}/.well-known/openid-configuration`;
  try {
    const response = await fetch(cognitoOidcUrl);
    if (response.ok) {
      const metadata = await response.json() as Record<string, any>;
      cognitoAuthEndpoint = metadata.authorization_endpoint;
      cognitoTokenEndpoint = metadata.token_endpoint;
    }
  } catch {
    // Will return 503 to caller
  }
}

// --- Lambda handler ---

export async function handler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  const path = event.rawPath;
  const method = event.requestContext.http.method;

  if (method === "GET" && path === "/.well-known/oauth-protected-resource") {
    return handleProtectedResourceMetadata(event);
  }
  if (method === "GET" && path === "/.well-known/oauth-authorization-server") {
    return handleAuthServerMetadata(event);
  }
  if (method === "GET" && path === "/oauth/authorize") {
    return handleAuthorize(event);
  }
  if (method === "POST" && path === "/oauth/token") {
    return handleToken(event);
  }
  if (method === "POST" && path === "/register") {
    return handleRegister(event);
  }
  if (method === "GET" && path === "/.well-known/mcp.json") {
    return handleMcpServerCard(event);
  }
  if (method === "GET" && path === "/llms.txt") {
    return handleLlmsTxt(event);
  }

  return json(404, { error: "not_found" });
}
