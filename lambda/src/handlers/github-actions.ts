import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getInstallationToken } from "../services/github-app";
import type { UserContext } from "../types";
import type { GitHubInstallation } from "./github-connect";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export interface GitHubLabelArgs {
  owner: string;
  repo: string;
  issue_number: number;
  labels: string[];
  action?: "add" | "set" | "remove";
}

export interface GitHubCommentArgs {
  owner: string;
  repo: string;
  issue_number: number;
  body: string;
}

export interface GitHubCloseArgs {
  owner: string;
  repo: string;
  issue_number: number;
  state_reason?: "completed" | "not_planned";
}

async function getInstallationForOwner(
  userId: string,
  owner: string
): Promise<GitHubInstallation | null> {
  const tableName = process.env.GITHUB_INSTALLATIONS_TABLE!;
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: "user-id-index",
      KeyConditionExpression: "userId = :uid",
      ExpressionAttributeValues: { ":uid": userId },
    })
  );

  const normalizedOwner = owner.toLowerCase();
  const matches = ((result.Items ?? []) as GitHubInstallation[])
    .filter(
      (item) => item.accountLogin?.toLowerCase() === normalizedOwner
    )
    .sort((a, b) => {
      const aTime = Date.parse(a.installedAt ?? "");
      const bTime = Date.parse(b.installedAt ?? "");
      return bTime - aTime;
    });

  return matches[0] ?? null;
}

const GITHUB_HEADERS = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type": "application/json",
});

export async function handleGitHubLabel(
  args: GitHubLabelArgs,
  user: UserContext
): Promise<string> {
  const { owner, repo, issue_number, labels, action = "add" } = args;

  const installation = await getInstallationForOwner(user.userId, owner);
  if (!installation) {
    return `No GitHub installation found for owner "${owner}". Connect GitHub first.`;
  }

  const token = await getInstallationToken(installation.installationId);
  const baseUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${issue_number}/labels`;
  const headers = GITHUB_HEADERS(token);

  if (action === "remove") {
    const results = await Promise.all(
      labels.map(async (label) => {
        const response = await fetch(`${baseUrl}/${encodeURIComponent(label)}`, {
          method: "DELETE",
          headers,
        });
        const body = response.ok ? "" : await response.text();
        return { label, response, body };
      })
    );
    const failed = results.filter(({ response }) => !response.ok);
    if (failed.length > 0) {
      const details = failed
        .map(({ label, response, body }) =>
          `"${label}" (${response.status}${body ? `: ${body}` : ""})`
        )
        .join(", ");
      return `Failed to remove label(s) from ${owner}/${repo}#${issue_number}: ${details}`;
    }
    return `Removed labels from ${owner}/${repo}#${issue_number}: ${labels.join(", ")}`;
  }

  const method = action === "set" ? "PUT" : "POST";
  const res = await fetch(baseUrl, {
    method,
    headers,
    body: JSON.stringify({ labels }),
  });

  if (!res.ok) {
    return `GitHub API error ${res.status}: ${await res.text()}`;
  }

  const verb = action === "set" ? "Set" : "Added";
  return `${verb} labels on ${owner}/${repo}#${issue_number}: ${labels.join(", ")}`;
}

export async function handleGitHubComment(
  args: GitHubCommentArgs,
  user: UserContext
): Promise<string> {
  const { owner, repo, issue_number, body } = args;

  const installation = await getInstallationForOwner(user.userId, owner);
  if (!installation) {
    return `No GitHub installation found for owner "${owner}". Connect GitHub first.`;
  }

  const token = await getInstallationToken(installation.installationId);
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issue_number}/comments`,
    {
      method: "POST",
      headers: GITHUB_HEADERS(token),
      body: JSON.stringify({ body }),
    }
  );

  if (!res.ok) {
    return `GitHub API error ${res.status}: ${await res.text()}`;
  }

  const data = (await res.json()) as { html_url: string };
  return `Comment posted on ${owner}/${repo}#${issue_number}: ${data.html_url}`;
}

export async function handleGitHubClose(
  args: GitHubCloseArgs,
  user: UserContext
): Promise<string> {
  const { owner, repo, issue_number, state_reason = "completed" } = args;

  const installation = await getInstallationForOwner(user.userId, owner);
  if (!installation) {
    return `No GitHub installation found for owner "${owner}". Connect GitHub first.`;
  }

  const token = await getInstallationToken(installation.installationId);
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issue_number}`,
    {
      method: "PATCH",
      headers: GITHUB_HEADERS(token),
      body: JSON.stringify({ state: "closed", state_reason }),
    }
  );

  if (!res.ok) {
    return `GitHub API error ${res.status}: ${await res.text()}`;
  }

  return `Closed ${owner}/${repo}#${issue_number} (${state_reason})`;
}
