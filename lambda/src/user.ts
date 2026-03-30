import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { verifyAuth } from "./auth/verify";
import { handleDeleteAccount } from "./handlers/delete-account";

const JSON_HEADERS = { "Content-Type": "application/json" };

function unauthorized(): APIGatewayProxyResultV2 {
  return {
    statusCode: 401,
    headers: JSON_HEADERS,
    body: JSON.stringify({ error: "Unauthorized" }),
  };
}

export async function handler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  const method = event.requestContext.http.method;
  const path = event.rawPath;

  // DELETE /user — permanently delete the authenticated user's account and all data
  if (method === "DELETE" && path === "/user") {
    let user;
    try {
      user = await verifyAuth(event.headers ?? {});
    } catch {
      return unauthorized();
    }

    // Reject agent API key auth — only end-users may delete their own account
    if (user.agentName) {
      return unauthorized();
    }

    try {
      await handleDeleteAccount(user);
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({ ok: true }),
      };
    } catch (e) {
      console.error("Delete account error:", e instanceof Error ? e.message : String(e));
      return {
        statusCode: 500,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: "Failed to delete account" }),
      };
    }
  }

  return {
    statusCode: 404,
    headers: JSON_HEADERS,
    body: JSON.stringify({ error: "Not found" }),
  };
}
