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
  // Dynamic import: libsodium-wrappers overwrites module.exports during WASM
  // init, which clobbers esbuild's bundle exports when imported at top level.
  const sodium = (await import("libsodium-wrappers")).default;
  await sodium.ready;
  const keyBytes = sodium.from_base64(publicKey, sodium.base64_variants.ORIGINAL);
  const messageBytes = sodium.from_string(value);
  const encrypted = sodium.crypto_box_seal(messageBytes, keyBytes);
  return sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL);
}

// --- Prompt file helper ------------------------------------------------------

const BRAIN_SYSTEM_PROMPT = `You are an autonomous agent with access to a personal knowledge base called Open Brain.

On every run you MUST:
1. Search the brain for relevant prior context (avoid duplicates, build on previous work)
2. Do your assigned task
3. Capture a concise summary of your results back to the brain

Be concise and actionable. Always cite sources when capturing new information.`;

interface AgentConfig {
  systemPrompt?: string;
  userPrompt?: string;
  model?: string;
  schedule?: string;
}

function buildPromptYaml(config: AgentConfig): string {
  const model = config.model || "openai/gpt-4.1";
  const userPrompt = config.userPrompt || config.systemPrompt || "";
  // Indent multiline content for YAML block scalar
  const indentedSystem = BRAIN_SYSTEM_PROMPT.split("\n").join("\n      ");
  const indentedUser = userPrompt.split("\n").join("\n      ");
  return [
    `model: ${model}`,
    `messages:`,
    `  - role: system`,
    `    content: |`,
    `      ${indentedSystem}`,
    `  - role: user`,
    `    content: |`,
    `      ${indentedUser}`,
    ``,
  ].join("\n");
}

async function writePromptFile(
  repoFullName: string,
  token: string,
  config: AgentConfig
) {
  const promptUrl = `${GH_API}/repos/${repoFullName}/contents/agent.prompt.yml`;
  const content = buildPromptYaml(config);
  const maxAttempts = 5;
  let lastStatus: number | undefined;

  // Read existing file to get SHA (needed for updates)
  let sha: string | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await ghFetch(promptUrl, token);
    if (res.ok) {
      const data = (await res.json()) as { sha: string };
      sha = data.sha;
      break;
    }
    if (res.status === 404) {
      // File doesn't exist yet — will create
      break;
    }
    lastStatus = res.status;
    if (attempt < maxAttempts) {
      await sleep(250 * 2 ** (attempt - 1));
    }
  }

  const body: Record<string, string> = {
    message: "Update agent prompt",
    content: Buffer.from(content).toString("base64"),
  };
  if (sha) body.sha = sha;

  const commitRes = await ghFetch(promptUrl, token, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (!commitRes.ok) {
    const errText = await commitRes.text();
    throw new Error(`Failed to write agent.prompt.yml: ${commitRes.status} ${errText}`);
  }

  // Update workflow cron schedule if provided
  if (config.schedule) {
    await updateWorkflowSchedule(repoFullName, token, config.schedule);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function updateWorkflowSchedule(
  repoFullName: string,
  token: string,
  schedule: string
) {
  const workflowUrl = `${GH_API}/repos/${repoFullName}/contents/.github/workflows/agent.yml`;
  const maxAttempts = 5;
  let lastStatus: number | undefined;

  let wfData: { content: string; sha: string } | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const wfRes = await ghFetch(workflowUrl, token);
    if (wfRes.ok) {
      wfData = (await wfRes.json()) as { content: string; sha: string };
      break;
    }
    lastStatus = wfRes.status;
    if (attempt < maxAttempts) {
      await sleep(250 * 2 ** (attempt - 1));
    }
  }

  if (!wfData) {
    throw new Error(`Failed to read workflow file after ${maxAttempts} attempts: ${lastStatus ?? "unknown"}`);
  }

  let wfContent = Buffer.from(wfData.content, "base64").toString("utf-8");
  const sanitized = schedule.replace(/"/g, "");
  wfContent = wfContent.replace(/cron: ".*?"/, `cron: "${sanitized}"`);
  const commitRes = await ghFetch(workflowUrl, token, {
    method: "PUT",
    body: JSON.stringify({
      message: `Set schedule: ${sanitized}`,
      content: Buffer.from(wfContent).toString("base64"),
      sha: wfData.sha,
    }),
  });
  if (!commitRes.ok) {
    throw new Error(`Failed to update workflow schedule: ${commitRes.status}`);
  }
}

// --- Handler -----------------------------------------------------------------

export interface UpdateAgentArgs {
  name: string;
  systemPrompt?: string;
  userPrompt?: string;
  model?: string;
  schedule?: string;
}

export async function handleUpdateAgent(
  args: UpdateAgentArgs,
  user: UserContext
): Promise<{ ok: boolean }> {
  if (user.agentName) {
    throw new Error("Agents cannot update agents. Use a human session.");
  }

  const { name, schedule, systemPrompt, userPrompt, model } = args;
  if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error("Agent name must be alphanumeric (hyphens and underscores allowed).");
  }
  if (schedule && !/^[\d*\/,\-]+(\s+[\d*\/,\-]+){4}$/.test(schedule.trim())) {
    throw new Error("Invalid cron schedule. Expected 5 fields (e.g. '30 11 * * *').");
  }

  // Look up the agent to find the repo
  const agentResult = await ddb.send(
    new QueryCommand({
      TableName: AGENT_KEYS_TABLE,
      KeyConditionExpression: "pk = :pk AND sk = :sk",
      ExpressionAttributeValues: {
        ":pk": `USER#${user.userId}`,
        ":sk": `AGENT#${name}`,
      },
    })
  );
  const agent = agentResult.Items?.[0];
  if (!agent) {
    throw new Error(`Agent "${name}" not found.`);
  }
  const repoFullName = agent.repoFullName as string;
  if (!repoFullName) {
    throw new Error(`Agent "${name}" has no linked repo.`);
  }

  // Get installation token
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
    throw new Error("No GitHub connection found.");
  }
  const installationId = installations[0].installationId as string;
  const token = await getInstallationToken(installationId);

  await writePromptFile(repoFullName, token, {
    systemPrompt,
    userPrompt,
    model,
    schedule,
  });

  return { ok: true };
}

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

  // 6. Set repo variables for agent config (no file patching needed —
  //    the template reads these from process.env at runtime)
  await writePromptFile(repo.full_name, token, {
    systemPrompt,
    userPrompt,
    model,
    schedule,
  });

  return {
    ok: true,
    repoUrl: repo.html_url,
    agentName: name,
    workflowUrl: `${repo.html_url}/actions`,
  };
}
