import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import {
  CognitoIdentityProviderClient,
  CreateUserPoolClientCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import dns from "dns";

const DCR_CLIENTS_TABLE = process.env.DCR_CLIENTS_TABLE!;
const USER_POOL_ID = process.env.USER_POOL_ID!;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const cognito = new CognitoIdentityProviderClient({});

const MAX_URL_LENGTH = 2048;
const FETCH_TIMEOUT_MS = 5000;
const MAX_RESPONSE_SIZE = 65536;

// Sentinel error used to distinguish a blocked-host throw from DNS failures
class BlockedHostError extends Error {
  constructor() { super("Metadata URL host is not permitted"); }
}

// Resolve all IPv4 and IPv6 addresses for a hostname (SSRF protection)
function dnsLookupAll(hostname: string): Promise<Array<{ address: string; family: number }>> {
  return new Promise((resolve, reject) => {
    dns.lookup(hostname, { all: true }, (err, addresses) => {
      if (err) reject(err);
      else resolve(addresses as Array<{ address: string; family: number }>);
    });
  });
}

// Private/reserved IPv4 ranges to block (SSRF protection)
const BLOCKED_IPv4_RANGES = [
  /^127\./, /^10\./, /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^192\.168\./, /^169\.254\./, /^0\./,
];

// Private/reserved IPv6 ranges to block (SSRF protection)
const BLOCKED_IPv6_RANGES = [
  /^::1$/i,        // loopback
  /^fc/i,          // unique local (fc00::/7)
  /^fd/i,          // unique local (fd00::/8)
  /^fe[89ab]/i,    // link-local (fe80::/10)
  /^::ffff:/i,     // IPv4-mapped (::ffff:0:0/96)
  /^64:ff9b:/i,    // NAT64 (RFC 6052)
  /^2002:/i,       // 6to4 (can tunnel private IPv4)
  /^::$/,          // unspecified address
];

export interface ClientMapping {
  clientId: string;
  clientSecret: string;
  redirectUris: string[];
}

export function isUrlClientId(clientId: string | undefined): boolean {
  if (!clientId) return false;
  try {
    const parsed = new URL(clientId);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Validate a metadata URL for safety (SSRF protection).
 */
async function validateMetadataUrl(urlString: string): Promise<URL> {
  if (urlString.length > MAX_URL_LENGTH) {
    throw new Error("Metadata URL exceeds maximum length");
  }

  const parsed = new URL(urlString);

  if (!parsed.pathname || parsed.pathname === "/") {
    throw new Error("Metadata URL must contain a path component");
  }
  if (parsed.hash) throw new Error("Metadata URL must not contain fragments");
  if (parsed.username || parsed.password) throw new Error("Metadata URL must not contain credentials");
  if (/\/(\.\.?)(\/|$)/.test(parsed.pathname)) throw new Error("Metadata URL must not contain dot path segments");

  // WHATWG URL parser strips brackets from IPv6 addresses: hostname for
  // "http://[::1]" is "::1", not "[::1]"
  const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);
  const isLocalhost = LOOPBACK_HOSTNAMES.has(parsed.hostname);
  const allowInsecure = process.env.ALLOW_INSECURE_METADATA_URLS === "true";

  if (parsed.protocol === "http:") {
    if (!allowInsecure || !isLocalhost) {
      throw new Error("Metadata URL must use HTTPS");
    }
  } else if (parsed.protocol !== "https:") {
    throw new Error("Metadata URL must use HTTPS");
  }

  // SSRF: in production block all private/reserved IPs including loopback.
  // In insecure dev mode skip the check only for explicit loopback hostnames.
  if (!allowInsecure || !isLocalhost) {
    // WHATWG URL parser already strips brackets from IPv6 hostnames
    const hostname = parsed.hostname;
    try {
      const addresses = await dnsLookupAll(hostname);
      for (const { address, family } of addresses) {
        const blocked = family === 4
          ? BLOCKED_IPv4_RANGES.some((r) => r.test(address))
          : BLOCKED_IPv6_RANGES.some((r) => r.test(address));
        if (blocked) {
          throw new BlockedHostError();
        }
      }
    } catch (err) {
      if (err instanceof BlockedHostError) throw err;
      console.error("Error resolving metadata URL host:", err instanceof Error ? err.message : String(err));
      throw new Error("Failed to resolve metadata URL host");
    }
  }

  return parsed;
}

/**
 * Fetch and validate a Client ID Metadata Document.
 */
async function fetchAndValidateMetadata(metadataUrl: string): Promise<{
  client_id: string;
  client_name: string;
  redirect_uris: string[];
}> {
  await validateMetadataUrl(metadataUrl);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(metadataUrl, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    try {
      const u = new URL(metadataUrl);
      console.error(`Metadata fetch failed for ${u.origin}${u.pathname}: HTTP ${response.status}`);
    } catch {
      console.error(`Metadata fetch failed: HTTP ${response.status}`);
    }
    throw new Error("Metadata document could not be retrieved");
  }

  const text = await response.text();
  if (text.length > MAX_RESPONSE_SIZE) throw new Error("Metadata document too large");

  const metadata = JSON.parse(text);

  if (!metadata.client_id || metadata.client_id !== metadataUrl) {
    throw new Error(`Metadata client_id does not match document URL`);
  }
  if (!metadata.client_name || typeof metadata.client_name !== "string") {
    throw new Error("Metadata missing required field: client_name");
  }
  if (!Array.isArray(metadata.redirect_uris) || metadata.redirect_uris.length === 0) {
    throw new Error("Metadata missing required field: redirect_uris");
  }
  for (const uri of metadata.redirect_uris) {
    const parsed = new URL(uri);
    const isHttps = parsed.protocol === "https:";
    const isLocalhostHttp = parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1");
    if (!isHttps && !isLocalhostHttp) {
      throw new Error(`redirect_uri must use https (or http://localhost, http://127.0.0.1, or http://[::1] for testing): ${uri}`);
    }
  }

  return metadata;
}

/**
 * Register a new Cognito app client via DCR and store the mapping.
 */
async function registerCognitoClient(
  clientName: string,
  redirectUris: string[],
): Promise<ClientMapping> {
  const result = await cognito.send(
    new CreateUserPoolClientCommand({
      UserPoolId: USER_POOL_ID,
      ClientName: clientName,
      GenerateSecret: false,
      AllowedOAuthFlows: ["code"],
      AllowedOAuthFlowsUserPoolClient: true,
      AllowedOAuthScopes: ["openid", "profile", "email"],
      CallbackURLs: redirectUris,
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
  return {
    clientId: client.ClientId!,
    clientSecret: "",
    redirectUris,
  };
}

/**
 * Resolve a URL-based client_id to Cognito credentials.
 * Checks DynamoDB cache first, then fetches + validates CIMD and registers via DCR.
 */
export async function resolveClientId(clientIdUrl: string): Promise<ClientMapping> {
  // Check DynamoDB for existing mapping
  const existing = await ddb.send(
    new QueryCommand({
      TableName: DCR_CLIENTS_TABLE,
      IndexName: "cimd-url-index",
      KeyConditionExpression: "cimdUrl = :url",
      ExpressionAttributeValues: { ":url": clientIdUrl },
      Limit: 1,
    })
  );

  if (existing.Items?.[0]) {
    const item = existing.Items[0];
    return {
      clientId: item.clientId,
      clientSecret: item.clientSecret,
      redirectUris: JSON.parse(item.redirectUris),
    };
  }

  // Fetch and validate the metadata document
  const metadata = await fetchAndValidateMetadata(clientIdUrl);

  // Register a Cognito client
  const mapping = await registerCognitoClient(
    metadata.client_name,
    metadata.redirect_uris,
  );

  // Store the mapping with a conditional write to prevent races.
  // Use cimdUrl as a condition — if another request already stored a mapping
  // for this URL, re-read and return that one instead of leaking a duplicate.
  const expiresAt = Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60; // 90 days
  try {
    await ddb.send(
      new PutCommand({
        TableName: DCR_CLIENTS_TABLE,
        Item: {
          clientId: mapping.clientId,
          cimdUrl: clientIdUrl,
          clientSecret: mapping.clientSecret,
          clientName: metadata.client_name,
          redirectUris: JSON.stringify(mapping.redirectUris),
          createdAt: new Date().toISOString(),
          expiresAt,
        },
        ConditionExpression: "attribute_not_exists(clientId)",
      })
    );
  } catch (err: any) {
    if (err.name === "ConditionalCheckFailedException") {
      // Another request beat us — re-read from GSI
      const retry = await ddb.send(
        new QueryCommand({
          TableName: DCR_CLIENTS_TABLE,
          IndexName: "cimd-url-index",
          KeyConditionExpression: "cimdUrl = :url",
          ExpressionAttributeValues: { ":url": clientIdUrl },
          Limit: 1,
        })
      );
      if (retry.Items?.[0]) {
        const item = retry.Items[0];
        return {
          clientId: item.clientId,
          clientSecret: item.clientSecret,
          redirectUris: JSON.parse(item.redirectUris),
        };
      }
    }
    throw err;
  }

  return mapping;
}

// Exported for testing
export { validateMetadataUrl, fetchAndValidateMetadata, registerCognitoClient };
