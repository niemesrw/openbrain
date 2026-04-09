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
  /** Optional URL to associated media (image, video, audio, etc.) */
  media_url?: string;
  /** Source URL of the article or page this thought was captured from */
  source_url?: string;
  /** Origin of this thought — e.g. "github", "slack". Absent for user-captured thoughts. */
  source?: string;
}

export interface UserContext {
  userId: string;
  cognitoUsername?: string;
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
  /** When true, exclude thoughts captured by system agents (source field is set) */
  human_only?: boolean;
  _format?: "json";
}

export interface StatsArgs {
  _format?: "json";
}

export interface CaptureArgs {
  text: string;
  scope?: "private" | "shared";
  media_url?: string;
  /** Source URL of the article or page being captured — og:image is auto-extracted from this URL */
  source_url?: string;
  /** Optional explicit type override — overrides the AI-chosen type when provided */
  type?: "observation" | "task" | "idea" | "reference" | "person_note";
}

export interface UpdateThoughtArgs {
  id: string;
  text: string;
  scope?: "private" | "shared";
  media_url?: string;
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

export interface RotateAgentKeyArgs {
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

export interface AgentHeartbeatArgs {
  status: "idle" | "working" | "error";
  message?: string;
}

