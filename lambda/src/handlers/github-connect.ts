import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import type { UserContext } from "../types";

const GITHUB_INSTALLATIONS_TABLE = process.env.GITHUB_INSTALLATIONS_TABLE!;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export interface ConnectArgs {
  installationId: string;
  accountLogin: string;
  accountType: "User" | "Organization";
}

export interface GitHubInstallation {
  installationId: string;
  userId: string;
  accountLogin: string;
  accountType: "User" | "Organization";
  installedAt: string;
}

export async function handleGitHubConnect(
  args: ConnectArgs,
  user: UserContext
): Promise<{ ok: boolean }> {
  const { installationId, accountLogin, accountType } = args;

  try {
    await ddb.send(
      new PutCommand({
        TableName: GITHUB_INSTALLATIONS_TABLE,
        Item: {
          installationId,
          userId: user.userId,
          accountLogin,
          accountType,
          installedAt: new Date().toISOString(),
        },
        // Allow create-if-new OR update by the same owner.
        // Prevents a different user from hijacking an existing installation mapping.
        // TODO (Phase 2): also verify ownership via GitHub API (App JWT + installation token)
        ConditionExpression:
          "attribute_not_exists(installationId) OR userId = :uid",
        ExpressionAttributeValues: { ":uid": user.userId },
      })
    );
  } catch (e: unknown) {
    if (e instanceof Error && e.name === "ConditionalCheckFailedException") {
      const conflict = new Error("Installation already claimed by another user") as Error & { statusCode: number };
      conflict.statusCode = 409;
      throw conflict;
    }
    throw e;
  }

  return { ok: true };
}

export async function handleGitHubInstallations(
  user: UserContext
): Promise<{ installations: GitHubInstallation[] }> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: GITHUB_INSTALLATIONS_TABLE,
      IndexName: "user-id-index",
      KeyConditionExpression: "userId = :uid",
      ExpressionAttributeValues: { ":uid": user.userId },
    })
  );

  return { installations: (result.Items ?? []) as GitHubInstallation[] };
}
