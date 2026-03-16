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
}

export interface McpRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
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
}

export interface BrowseArgs {
  limit?: number;
  type?: string;
  topic?: string;
  scope?: "private" | "shared" | "all";
}

export interface CaptureArgs {
  text: string;
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
}
