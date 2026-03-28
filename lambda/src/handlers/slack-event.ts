import type { APIGatewayProxyResultV2 } from "aws-lambda";

export async function handleSlackEvent(
  _payload: Record<string, unknown>
): Promise<APIGatewayProxyResultV2> {
  // Stub — full implementation in #85
  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
}
