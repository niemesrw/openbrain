import { randomBytes } from "crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { getInstallationToken } from "../services/github-app";
import { hashApiKey } from "../services/api-key-hmac";
import type { UserContext } from "../types";
import sodium from "libsodium-wrappers";

const AGENT_KEYS_TABLE = process.env.AGENT_KEYS_TABLE!;
const GITHUB_INSTALLATIONS_TABLE = process.env.GITHUB_INSTALLATIONS_TABLE!;
const TEMPLATE_REPO = "BLANXLAIT/agent-template";
const GH_API = "https://api.github.com";
const GH_HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// --- Types -------------------------------------------------------------------

export interface WizardArgs {
  name: string;
  schedule?: string; // cron expression, e.g. "30 11 * * *"
  systemPrompt?: string;
  userPrompt?: string;
  model?: string;
}

interface WizardResult {
  ok: boolean;
  repoUrl: string;
  agentName: string;
  workflowUrl: string;
}

// --- GitHub helpers -----------------------------------------------------------

function ghFetch(url: string, token: string, init?: RequestInit) {
  const headers: Record<string, string> = {
    ...GH_HEADERS,
    Authorization: `Bearer ${token}`,
  };
  if (init?.body != null) {
    headers["Content-Type"] = "application/json";
  }
  return fetch(url, {
    ...init,
    headers: {
      ...headers,
      ...(init?.headers ?? {}),
    },
  });
}

/** Encrypt a secret value for the GitHub Actions secrets API (libsodium sealed box). */
async function encryptSecret(value: string, publicKey: string): Promise<string> {
  await sodium.ready;
  const keyBytes = sodium.from_base64(publicKey, sodium.base64_variants.ORIGINAL);
  const messageBytes = sodium.from_string(value);
  const encrypted = sodium.crypto_box_seal(messageBytes, keyBytes);
  return sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL);
}

// --- Handler -----------------------------------------------------------------

export async function handleAgentWizard(
  args: WizardArgs,
  user: UserContext
): Promise<WizardResult> {
  if (user.agentName) {
    throw new Error("Agents cannot create new agents. Use a human session.");
  }

  const { name, schedule, systemPrompt, userPrompt, model } = args;
  if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error("Agent name must be alphanumeric (hyphens and underscores allowed).");
  }
  // Validate cron: 5 fields, each containing only digits, *, /, -, and commas
  if (schedule && !/^[\d*\/,\-]+(\s+[\d*\/,\-]+){4}$/.test(schedule.trim())) {
    throw new Error("Invalid cron schedule. Expected 5 fields (e.g. '30 11 * * *').");
  }

  // 1. Find the user's GitHub installation
  const instResult = await ddb.send(
    new QueryCommand({
      TableName: GITHUB_INSTALLATIONS_TABLE,
      IndexName: "user-id-index",
      KeyConditionExpression: "userId = :uid",
      ExpressionAttributeValues: { ":uid": user.userId },
    })
  );
  const installations = instResult.Items ?? [];
  if (installations.length === 0) {
    throw new Error("No GitHub connection found. Connect GitHub in Settings first.");
  }
  const installation = installations[0];
  const installationId = installation.installationId as string;
  const owner = installation.accountLogin as string;

  // 2. Get an installation token
  const token = await getInstallationToken(installationId);

  // 3. Create repo from template
  const repoName = `brain-agent-${name}`;
  const createRes = await ghFetch(
    `${GH_API}/repos/${TEMPLATE_REPO}/generate`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        owner,
        name: repoName,
        description: `Open Brain agent: ${name}`,
        private: true,
      }),
    }
  );

  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Failed to create repo: ${createRes.status} ${err}`);
  }
  const repo = (await createRes.json()) as { full_name: string; html_url: string };

  // 4. Create agent API key — write DDB first so a failure doesn't orphan the repo
  const apiKey = `ob_${randomBytes(32).toString("hex")}`;
  const keyHash = await hashApiKey(apiKey);
  const apiUrl = process.env.API_URL || "https://brain.blanxlait.ai";

  try {
    await ddb.send(
      new PutCommand({
        TableName: AGENT_KEYS_TABLE,
        Item: {
          pk: `USER#${user.userId}`,
          sk: `AGENT#${name}`,
          keyHash,
          userId: user.userId,
          agentName: name,
          displayName: user.displayName,
          createdAt: new Date().toISOString(),
          repoFullName: repo.full_name,
        },
        ConditionExpression: "attribute_not_exists(pk)",
      })
    );
  } catch (err) {
    // Clean up the repo we just created to avoid orphans
    const deleteRes = await ghFetch(`${GH_API}/repos/${repo.full_name}`, token, { method: "DELETE" });
    if (!deleteRes.ok && deleteRes.status !== 404) {
      console.error(`Failed to delete orphaned repo ${repo.full_name}: ${deleteRes.status}`);
    }
    throw err;
  }

  // 5. Set repo secrets (OPEN_BRAIN_URL + OPEN_BRAIN_KEY)
  // Get the repo's public key for secret encryption
  const pkRes = await ghFetch(
    `${GH_API}/repos/${repo.full_name}/actions/secrets/public-key`,
    token
  );
  if (!pkRes.ok) {
    throw new Error(`Failed to get repo public key: ${pkRes.status}`);
  }
  const { key: publicKey, key_id: keyId } = (await pkRes.json()) as {
    key: string;
    key_id: string;
  };

  // Set OPEN_BRAIN_URL
  const urlSecretRes = await ghFetch(
    `${GH_API}/repos/${repo.full_name}/actions/secrets/OPEN_BRAIN_URL`,
    token,
    {
      method: "PUT",
      body: JSON.stringify({
        encrypted_value: await encryptSecret(`${apiUrl}/mcp`, publicKey),
        key_id: keyId,
      }),
    }
  );
  if (!urlSecretRes.ok) {
    throw new Error(`Failed to set OPEN_BRAIN_URL secret: ${urlSecretRes.status} ${await urlSecretRes.text()}`);
  }

  // Set OPEN_BRAIN_KEY
  const keySecretRes = await ghFetch(
    `${GH_API}/repos/${repo.full_name}/actions/secrets/OPEN_BRAIN_KEY`,
    token,
    {
      method: "PUT",
      body: JSON.stringify({
        encrypted_value: await encryptSecret(apiKey, publicKey),
        key_id: keyId,
      }),
    }
  );
  if (!keySecretRes.ok) {
    throw new Error(`Failed to set OPEN_BRAIN_KEY secret: ${keySecretRes.status} ${await keySecretRes.text()}`);
  }

  // 6. Optionally patch agent.ts with custom prompt/schedule/model
  if (systemPrompt || userPrompt || model || schedule) {
    // Read current agent.ts
    const fileRes = await ghFetch(
      `${GH_API}/repos/${repo.full_name}/contents/src/agent.ts`,
      token
    );
    if (fileRes.ok) {
      const fileData = (await fileRes.json()) as { content: string; sha: string };
      let content = Buffer.from(fileData.content, "base64").toString("utf-8");

      if (model) {
        content = content.replace(
          /const MODEL = ".*?";/,
          `const MODEL = ${JSON.stringify(model)};`
        );
      }
      if (systemPrompt) {
        content = content.replace(
          /const SYSTEM_PROMPT = `[\s\S]*?`;/,
          `const SYSTEM_PROMPT = ${JSON.stringify(systemPrompt)};`
        );
      }
      if (userPrompt) {
        content = content.replace(
          /const USER_PROMPT = `[\s\S]*?`;/,
          `const USER_PROMPT = ${JSON.stringify(userPrompt)};`
        );
      }

      await ghFetch(
        `${GH_API}/repos/${repo.full_name}/contents/src/agent.ts`,
        token,
        {
          method: "PUT",
          body: JSON.stringify({
            message: `Configure agent: ${name}`,
            content: Buffer.from(content).toString("base64"),
            sha: fileData.sha,
          }),
        }
      );
    }

    // Patch workflow cron if schedule provided
    if (schedule) {
      const wfRes = await ghFetch(
        `${GH_API}/repos/${repo.full_name}/contents/.github/workflows/agent.yml`,
        token
      );
      if (wfRes.ok) {
        const wfData = (await wfRes.json()) as { content: string; sha: string };
        let wfContent = Buffer.from(wfData.content, "base64").toString("utf-8");
        wfContent = wfContent.replace(
          /cron: ".*?"/,
          `cron: "${schedule.replace(/"/g, "")}"`
        );
        await ghFetch(
          `${GH_API}/repos/${repo.full_name}/contents/.github/workflows/agent.yml`,
          token,
          {
            method: "PUT",
            body: JSON.stringify({
              message: `Set schedule: ${schedule}`,
              content: Buffer.from(wfContent).toString("base64"),
              sha: wfData.sha,
            }),
          }
        );
      }
    }
  }

  return {
    ok: true,
    repoUrl: repo.html_url,
    agentName: name,
    workflowUrl: `${repo.html_url}/actions`,
  };
}
