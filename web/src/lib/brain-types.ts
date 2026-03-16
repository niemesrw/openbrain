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
  scope: "private" | "shared";
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
}
