import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import {
  CognitoIdentityProviderClient,
  CreateUserPoolClientCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
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
    authorization_servers: [`${baseUrl}/.well-known/oauth-authorization-server`],
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

    // Patch for MCP spec compliance
    metadata.registration_endpoint = `${baseUrl}/register`;
    metadata.code_challenge_methods_supported = ["S256"];
    metadata.client_id_metadata_document_supported = true;

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

  if (isUrlClientId(clientId)) {
    try {
      const mapping = await resolveClientId(clientId!);
      authUrl.searchParams.set("client_id", mapping.clientId);
      // redirect_uri validation is handled by Cognito itself
    } catch (error: any) {
      return json(400, {
        error: "invalid_client_metadata",
        error_description: error.message,
      });
    }
  } else if (clientId) {
    authUrl.searchParams.set("client_id", clientId);
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
      // Replace with Cognito credentials
      params.set("client_id", mapping.clientId);
      params.set("client_secret", mapping.clientSecret);
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
        error_description: `Invalid redirect_uri: ${uri}`,
      });
    }
    const isHttps = parsed.protocol === "https:";
    const isLocalhostHttp = parsed.protocol === "http:" && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
    if (!isHttps && !isLocalhostHttp) {
      return json(400, {
        error: "invalid_client_metadata",
        error_description: `redirect_uri must use https (or http://localhost for testing): ${uri}`,
      });
    }
  }

  const clientName = body.client_name || `DCR Client ${Date.now()}`;

  try {
    const result = await cognito.send(
      new CreateUserPoolClientCommand({
        UserPoolId: USER_POOL_ID,
        ClientName: clientName,
        GenerateSecret: true,
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

    const registration = {
      client_id: client.ClientId,
      client_secret: client.ClientSecret,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_secret_expires_at: 0,
      redirect_uris: body.redirect_uris,
      grant_types: ["authorization_code", "refresh_token"],
      token_endpoint_auth_method: "client_secret_post",
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
          clientSecret: client.ClientSecret!,
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

  return json(404, { error: "not_found" });
}
