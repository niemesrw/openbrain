export type Scope = "private" | "shared";
export type ReadScope = Scope | "all";

export interface Thought {
  id?: string;
  content: string;
  type: string;
  topics: string[];
  people: string[];
  action_items: string[];
  dates_mentioned: string[];
  created_at: number | null;
  similarity?: number;
  scope: Scope;
}

export interface Message {
  id: string;
  role: "user" | "brain";
  text: string;
  thoughts?: Thought[];
  timestamp: number;
}

export interface BrainStats {
  total: number;
  earliest: number | null;
  types: Record<string, number>;
  topics: Record<string, number>;
  people: Record<string, number>;
}

export interface BusActivity {
  summary: { total: number; hours: number };
  by_agent: Array<{ agent: string; count: number; last_active: string }>;
  recent: Array<{
    content: string;
    agent: string;
    type: string;
    topics: string[];
    created_at: string | null;
  }>;
}

export interface Agent {
  name: string;
  createdAt: string;
  lastSeen: string | null;
  status: "idle" | "working" | "error" | "stale" | "unknown";
  statusMessage: string | null;
}
