import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// --- Auth ---

async function authenticate(key: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("agent_keys")
    .select("agent_name")
    .eq("api_key", key)
    .single();
  if (error || !data) return null;
  return data.agent_name;
}

// --- HTML escaping for server-rendered content ---

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// --- CORS headers ---

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// --- Dashboard HTML ---

function renderDashboard(key: string): string {
  const safeKey = escapeHtml(key);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Open Brain — Agent Bus</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
      background: #0d1117;
      color: #c9d1d9;
      min-height: 100vh;
      padding: 2rem;
    }
    header {
      border-bottom: 1px solid #21262d;
      padding-bottom: 1rem;
      margin-bottom: 2rem;
    }
    h1 { color: #58a6ff; font-size: 1.5rem; }
    #summary-line {
      color: #8b949e;
      margin-top: 0.5rem;
      font-size: 0.9rem;
    }
    h2 {
      color: #58a6ff;
      font-size: 1.1rem;
      margin-bottom: 1rem;
    }
    .section { margin-bottom: 2rem; }
    .agent-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 1rem;
    }
    .agent-card {
      background: #161b22;
      border: 1px solid #21262d;
      border-radius: 8px;
      padding: 1rem;
    }
    .agent-card .agent-name {
      color: #58a6ff;
      font-weight: 600;
      font-size: 1rem;
      margin-bottom: 0.5rem;
    }
    .agent-card .agent-stat {
      color: #8b949e;
      font-size: 0.85rem;
      margin-bottom: 0.25rem;
    }
    .timeline { list-style: none; }
    .timeline li {
      background: #161b22;
      border: 1px solid #21262d;
      border-radius: 8px;
      padding: 1rem;
      margin-bottom: 0.75rem;
    }
    .timeline .meta {
      display: flex;
      gap: 0.75rem;
      flex-wrap: wrap;
      margin-bottom: 0.5rem;
      font-size: 0.8rem;
    }
    .timeline .meta .agent { color: #58a6ff; font-weight: 600; }
    .timeline .meta .type {
      background: #21262d;
      color: #8b949e;
      padding: 0.1rem 0.5rem;
      border-radius: 4px;
    }
    .timeline .meta .time { color: #484f58; }
    .timeline .content-preview {
      color: #c9d1d9;
      font-size: 0.9rem;
      line-height: 1.4;
    }
    footer {
      border-top: 1px solid #21262d;
      padding-top: 1rem;
      color: #484f58;
      font-size: 0.8rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .refresh-indicator {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #238636;
    }
    .dot.loading {
      background: #d29922;
      animation: pulse 0.6s infinite alternate;
    }
    @keyframes pulse { to { opacity: 0.4; } }
    .empty-state {
      color: #484f58;
      font-style: italic;
      padding: 2rem;
      text-align: center;
    }
    #error-banner {
      display: none;
      background: #3d1a1a;
      border: 1px solid #6e3630;
      color: #f85149;
      padding: 0.75rem 1rem;
      border-radius: 8px;
      margin-bottom: 1rem;
      font-size: 0.9rem;
    }
  </style>
</head>
<body>
  <header>
    <h1>Open Brain — Agent Bus</h1>
    <div id="summary-line">Loading...</div>
  </header>

  <div id="error-banner"></div>

  <div class="section">
    <h2>Agents</h2>
    <div id="agent-grid" class="agent-grid">
      <div class="empty-state">Loading agents...</div>
    </div>
  </div>

  <div class="section">
    <h2>Recent Thoughts</h2>
    <ul id="timeline" class="timeline">
      <li class="empty-state">Loading timeline...</li>
    </ul>
  </div>

  <footer>
    <div class="refresh-indicator">
      <div id="status-dot" class="dot"></div>
      <span id="refresh-text">Auto-refresh in 30s</span>
    </div>
    <span>Open Brain Dashboard</span>
  </footer>

  <script>
    const API_KEY = "${safeKey}";
    const REFRESH_INTERVAL = 30;
    let countdown = REFRESH_INTERVAL;
    let timer = null;

    function formatTime(iso) {
      if (!iso) return "unknown";
      const d = new Date(iso);
      return d.toLocaleString();
    }

    function truncate(str, len) {
      if (!str) return "";
      return str.length > len ? str.slice(0, len) + "..." : str;
    }

    function clearChildren(el) {
      while (el.firstChild) {
        el.removeChild(el.firstChild);
      }
    }

    function renderAgents(agents) {
      const grid = document.getElementById("agent-grid");
      clearChildren(grid);
      if (!agents || agents.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = "No agent activity in this period.";
        grid.appendChild(empty);
        return;
      }
      for (const a of agents) {
        const card = document.createElement("div");
        card.className = "agent-card";

        const name = document.createElement("div");
        name.className = "agent-name";
        name.textContent = a.agent || "unknown";
        card.appendChild(name);

        const count = document.createElement("div");
        count.className = "agent-stat";
        count.textContent = a.thought_count + " thought" + (a.thought_count !== 1 ? "s" : "");
        card.appendChild(count);

        const last = document.createElement("div");
        last.className = "agent-stat";
        last.textContent = "Last active: " + formatTime(a.last_active);
        card.appendChild(last);

        grid.appendChild(card);
      }
    }

    function renderTimeline(recent) {
      const list = document.getElementById("timeline");
      clearChildren(list);
      if (!recent || recent.length === 0) {
        const empty = document.createElement("li");
        empty.className = "empty-state";
        empty.textContent = "No recent thoughts.";
        list.appendChild(empty);
        return;
      }
      for (const t of recent) {
        const li = document.createElement("li");

        const meta = document.createElement("div");
        meta.className = "meta";

        const agent = document.createElement("span");
        agent.className = "agent";
        agent.textContent = t.agent || "unknown";
        meta.appendChild(agent);

        const type = document.createElement("span");
        type.className = "type";
        type.textContent = t.type || "unknown";
        meta.appendChild(type);

        const time = document.createElement("span");
        time.className = "time";
        time.textContent = formatTime(t.created_at);
        meta.appendChild(time);

        li.appendChild(meta);

        const preview = document.createElement("div");
        preview.className = "content-preview";
        preview.textContent = truncate(t.content, 150);
        li.appendChild(preview);

        list.appendChild(li);
      }
    }

    async function fetchData() {
      const dot = document.getElementById("status-dot");
      const refreshText = document.getElementById("refresh-text");
      const errorBanner = document.getElementById("error-banner");

      dot.classList.add("loading");
      refreshText.textContent = "Refreshing...";

      try {
        const base = window.location.pathname.replace(/\\/$/, "");
        const res = await fetch(base + "/api?key=" + encodeURIComponent(API_KEY));
        if (!res.ok) {
          throw new Error("HTTP " + res.status);
        }
        const data = await res.json();

        errorBanner.style.display = "none";

        const summary = data.summary || {};
        document.getElementById("summary-line").textContent =
          summary.total_thoughts + " thoughts from " +
          summary.active_agents + " agent" + (summary.active_agents !== 1 ? "s" : "") +
          " in the last " + summary.hours + "h";

        renderAgents(data.by_agent || []);
        renderTimeline(data.recent || []);
      } catch (e) {
        errorBanner.style.display = "block";
        errorBanner.textContent = "Failed to load data: " + e.message;
      } finally {
        dot.classList.remove("loading");
        countdown = REFRESH_INTERVAL;
      }
    }

    function tick() {
      countdown--;
      const refreshText = document.getElementById("refresh-text");
      if (countdown <= 0) {
        fetchData();
      } else {
        refreshText.textContent = "Auto-refresh in " + countdown + "s";
      }
    }

    fetchData();
    timer = setInterval(tick, 1000);
  </script>
</body>
</html>`;
}

// --- Request handler ---

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  const key = url.searchParams.get("key");

  if (!key) {
    return new Response("Missing key parameter", { status: 401, headers: CORS_HEADERS });
  }

  const agentName = await authenticate(key);
  if (!agentName) {
    return new Response("Unauthorized", { status: 401, headers: CORS_HEADERS });
  }

  // Determine route — strip function base path to get the local path
  const path = url.pathname.replace(/^\/open-brain-dashboard/, "").replace(/\/$/, "") || "/";

  // JSON API endpoint
  if (path === "/api") {
    const hours = parseInt(url.searchParams.get("hours") || "24", 10);
    const agent = url.searchParams.get("agent") || null;
    const limit = parseInt(url.searchParams.get("limit") || "20", 10);

    const { data, error } = await supabase.rpc("bus_activity", {
      hours_back: hours,
      agent_filter: agent,
      result_limit: limit,
    });

    if (error) {
      return Response.json(
        { error: error.message },
        { status: 500, headers: CORS_HEADERS },
      );
    }

    return Response.json(data, {
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
      },
    });
  }

  // HTML dashboard
  const html = renderDashboard(key);
  return new Response(html, {
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
});
