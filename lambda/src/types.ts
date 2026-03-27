export interface ThoughtMetadata {
  type: "observation" | "task" | "idea" | "reference" | "person_note";
  topics: string[];
  people: string[];
  action_items: string[];
  dates_mentioned: string[];
}

export interface S3VectorMetadata {
  type: string;
  topics: string[];
  people: string[];
  user_id: string;
  created_at: number;
  content: string;
  action_items: string;
  dates_mentioned: string;
  /** Tenant identifier — set to userId on all shared captures for future multi-org filtering */
  tenant_id?: string;
}

export interface UserContext {
  userId: string;
  teamId?: string;
  agentName?: string;
  displayName?: string;
}

export interface SearchArgs {
  query: string;
  threshold?: number;
  limit?: number;
  type?: string;
  topic?: string;
  scope?: "private" | "shared" | "all";
  _format?: "json";
}

export interface BrowseArgs {
  limit?: number;
  type?: string;
  topic?: string;
  scope?: "private" | "shared" | "all";
  tenant_id?: string;
  _format?: "json";
}

export interface StatsArgs {
  _format?: "json";
}

export interface CaptureArgs {
  text: string;
  scope?: "private" | "shared";
}

export interface UpdateThoughtArgs {
  id: string;
  text: string;
  scope?: "private" | "shared";
}

export interface DeleteThoughtArgs {
  id: string;
  scope?: "private" | "shared";
}

export interface CreateAgentArgs {
  name: string;
}

export interface RevokeAgentArgs {
  name: string;
}

export interface AgentKeyItem {
  pk: string;
  sk: string;
  apiKey: string;
  userId: string;
  agentName: string;
  displayName?: string;
  createdAt: string;
}

export interface BusActivityArgs {
  hours?: number;
  agent?: string;
  limit?: number;
  tenant_id?: string;
  _format?: "json";
}

export interface ListAgentsArgs {
  _format?: "json";
}

export interface TelegramLinkArgs {
  /** Optional: pre-set display name for the linked account */
  displayName?: string;
}

export interface TelegramLinkResult {
  code: string;
  expiresAt: number; // epoch ms
}

export interface TelegramUserRecord {
  telegramUserId: string;
  userId: string;
  displayName?: string;
  linkedAt: number; // epoch seconds
}
