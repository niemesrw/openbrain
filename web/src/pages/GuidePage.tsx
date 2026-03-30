import { useState } from "react";
import { Link } from "react-router-dom";

type AiClient = "claude-code" | "claude-desktop" | "chatgpt" | "gemini";

const AI_CLIENTS: { id: AiClient; label: string }[] = [
  { id: "claude-code", label: "Claude Code" },
  { id: "claude-desktop", label: "Claude Desktop" },
  { id: "chatgpt", label: "ChatGPT" },
  { id: "gemini", label: "Gemini" },
];

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="bg-gray-950 border border-gray-700 rounded-lg p-4 text-sm text-gray-300 overflow-x-auto whitespace-pre-wrap">
      {children}
    </pre>
  );
}

function Step({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-5">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-600 text-white text-sm font-bold flex items-center justify-center mt-0.5">
        {number}
      </div>
      <div className="flex-1">
        <h3 className="text-white font-semibold text-lg mb-2">{title}</h3>
        <div className="text-gray-400 space-y-3">{children}</div>
      </div>
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
      <div className="text-2xl mb-3">{icon}</div>
      <h3 className="text-white font-semibold mb-1">{title}</h3>
      <p className="text-gray-400 text-sm">{description}</p>
    </div>
  );
}

function AiClientSetup({ client }: { client: AiClient }) {
  if (client === "claude-code") {
    return (
      <div className="space-y-4">
        <p>Add Open Brain as an MCP server in your Claude Code settings. Find your API URL in <strong className="text-white">Settings → MCP Connection</strong> after signing in.</p>
        <p>Add this to <code className="text-blue-400">~/.claude/settings.json</code>:</p>
        <CodeBlock>{`{
  "mcpServers": {
    "open-brain": {
      "type": "http",
      "url": "https://YOUR_API_URL/mcp"
    }
  }
}`}</CodeBlock>
        <p>Claude Code will authenticate automatically via OAuth the first time you use a brain tool. You can then say things like:</p>
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>"Remember this decision"</li>
          <li>"What do I know about [topic]?"</li>
          <li>"Show me my recent thoughts"</li>
        </ul>
      </div>
    );
  }

  if (client === "claude-desktop") {
    return (
      <div className="space-y-4">
        <p>Open Claude Desktop and go to <strong className="text-white">Settings → MCP Connectors → Add connector</strong>. Use your API URL from <strong className="text-white">Settings → MCP Connection</strong> after signing in.</p>
        <CodeBlock>{`Name:   Open Brain
URL:    https://YOUR_API_URL/mcp
Auth:   OAuth (automatic)`}</CodeBlock>
        <p>Then add the skill instructions so Claude knows when to use the brain. Copy the contents of <code className="text-blue-400">skills/claude-desktop.md</code> from the repo into <strong className="text-white">Settings → Project Instructions</strong>.</p>
        <p>After connecting, try:</p>
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>"What did I decide about X?" — Claude will search your brain</li>
          <li>"Remember that I prefer Y" — Claude will save it</li>
        </ul>
      </div>
    );
  }

  if (client === "chatgpt") {
    return (
      <div className="space-y-4">
        <p>ChatGPT requires a paid plan with MCP support enabled.</p>
        <ol className="list-decimal list-inside space-y-2 text-sm">
          <li>Go to <strong className="text-white">Settings → Apps &amp; Connectors → Advanced settings</strong> and enable Developer Mode</li>
          <li>Add a new MCP connector with your API URL from <strong className="text-white">Settings → MCP Connection</strong></li>
          <li>Go to <strong className="text-white">Settings → Personalization → Custom Instructions</strong> and paste the contents of <code className="text-blue-400">skills/chatgpt-instructions.md</code></li>
        </ol>
        <p className="text-sm text-yellow-400 bg-yellow-400/10 border border-yellow-400/20 rounded-lg px-4 py-3">
          Note: ChatGPT requires explicit tool names in instructions. The skill file is already formatted for this.
        </p>
      </div>
    );
  }

  if (client === "gemini") {
    return (
      <div className="space-y-4">
        <p><strong className="text-white">Gemini CLI</strong> — connect via the MCP add command. Find your API key in <strong className="text-white">Settings → API Key</strong> after signing in.</p>
        <CodeBlock>{`gemini mcp add -t http open-brain \\
  https://YOUR_API_URL/mcp \\
  -H "X-Api-Key: YOUR_API_KEY"`}</CodeBlock>
        <p>Then add the skill to <code className="text-blue-400">~/.gemini/GEMINI.md</code> — copy the CLI section from <code className="text-blue-400">skills/gemini-gem.md</code>.</p>
        <div className="border-t border-gray-700 pt-4">
          <p><strong className="text-white">Gemini Web</strong> — MCP connectors are not yet supported in Gemini web. You can still use Open Brain by:</p>
          <ul className="list-disc list-inside space-y-1 text-sm mt-2">
            <li>Capturing through Claude Code or Claude Desktop, then asking Gemini about topics (once MCP ships)</li>
            <li>Creating a Gem with the instructions from <code className="text-blue-400">skills/gemini-gem.md</code> for manual capture guidance</li>
          </ul>
        </div>
      </div>
    );
  }

  return null;
}

export function GuidePage() {
  const [activeClient, setActiveClient] = useState<AiClient>("claude-code");

  return (
    <div className="max-w-3xl mx-auto space-y-16 pb-20">
      {/* Hero */}
      <div className="text-center pt-8 space-y-4">
        <h1 className="text-4xl font-bold text-white">Your second brain, powered by AI</h1>
        <p className="text-gray-400 text-lg max-w-xl mx-auto">
          Open Brain stores your thoughts, decisions, and knowledge as searchable memories — accessible from any AI assistant you already use.
        </p>
        <div className="flex items-center justify-center gap-3 pt-2">
          <Link
            to="/login"
            className="bg-blue-600 text-white px-6 py-2.5 rounded-lg hover:bg-blue-500 font-medium"
          >
            Get started
          </Link>
          <a
            href="#how-it-works"
            className="text-gray-400 hover:text-white px-6 py-2.5"
          >
            See how it works
          </a>
        </div>
      </div>

      {/* Getting Started */}
      <div id="how-it-works" className="space-y-8">
        <h2 className="text-2xl font-bold text-white">Getting started</h2>
        <div className="space-y-8">
          <Step number={1} title="Sign in">
            <p>
              Click <strong className="text-white">Get started</strong> and sign in with your Google account. That's it — your private brain is created automatically.
            </p>
          </Step>

          <Step number={2} title="Connect your AI client">
            <p>Open Brain works with the AI tools you already use. Pick yours:</p>
            <div className="mt-4 space-y-4">
              <div role="tablist" className="flex gap-2 flex-wrap">
                {AI_CLIENTS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="tab"
                    aria-selected={activeClient === c.id}
                    onClick={() => setActiveClient(c.id)}
                    className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                      activeClient === c.id
                        ? "bg-blue-600 text-white"
                        : "bg-gray-800 text-gray-300 hover:text-white hover:bg-gray-700"
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <div className="bg-gray-800 border border-gray-700 rounded-xl p-5 text-sm">
                <AiClientSetup client={activeClient} />
              </div>
            </div>
          </Step>

          <Step number={3} title="Capture your first thought">
            <p>
              From the dashboard, switch to <strong className="text-white">Capture mode</strong> and type anything — a decision you made, something you want to remember, a project note. Or just tell your AI assistant:
            </p>
            <CodeBlock>{"Remember that I prefer TypeScript over JavaScript for new projects."}</CodeBlock>
            <p>Your AI will call <code className="text-blue-400">capture_thought</code> and it'll be stored with semantic embeddings, ready to recall later.</p>
          </Step>
        </div>
      </div>

      {/* Core Features */}
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-white">What you can do</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FeatureCard
            icon="🔍"
            title="Search by meaning"
            description={'Ask questions in plain English. Results are ranked by semantic similarity, not keyword matches — so "what do I know about the auth system?" finds relevant thoughts even if you never used those exact words.'}
          />
          <FeatureCard
            icon="✍️"
            title="Capture from anywhere"
            description="Save thoughts from the web dashboard, iOS app, any connected AI chat, GitHub events, or Slack. Everything lands in the same searchable brain."
          />
          <FeatureCard
            icon="🏷️"
            title="5 thought types"
            description="Thoughts are automatically classified as observation, task, idea, reference, or person_note. Browse and filter by type to find exactly what you need."
          />
          <FeatureCard
            icon="🔒"
            title="Private & shared scope"
            description="Every thought is private by default. Optionally share thoughts to the public feed — useful for team knowledge or agent coordination."
          />
          <FeatureCard
            icon="📅"
            title="Browse recent"
            description="See your thoughts in chronological order. Filter by type or topic to review what's been on your mind this week."
          />
          <FeatureCard
            icon="📊"
            title="Brain stats"
            description="See a snapshot of your brain: total thoughts, breakdown by type, top topics, and people mentioned across your notes."
          />
          <FeatureCard
            icon="📱"
            title="iOS app"
            description="Search, capture, browse, and view stats from your iPhone. Full feature parity with the web dashboard — your brain in your pocket."
          />
        </div>
      </div>

      {/* Integrations */}
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-white">Integrations</h2>
        <p className="text-gray-400">Connect your tools and Open Brain captures activity automatically — no manual entry needed.</p>
        <div className="space-y-4">
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 space-y-3">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🐙</span>
              <h3 className="text-white font-semibold text-lg">GitHub</h3>
            </div>
            <p className="text-gray-400 text-sm">
              Connect your GitHub account at <strong className="text-white">Settings → Connect GitHub</strong>. Open Brain will automatically capture commits, pull requests, and pushes as reference thoughts — so you can ask your AI "what was I working on last week?" and get real answers.
            </p>
            <p className="text-gray-400 text-sm">
              Supports personal accounts and organizations. You control which events are captured.
            </p>
          </div>

          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 space-y-3">
            <div className="flex items-center gap-3">
              <span className="text-2xl">💬</span>
              <h3 className="text-white font-semibold text-lg">Slack</h3>
            </div>
            <p className="text-gray-400 text-sm">
              Connect your Slack workspace at <strong className="text-white">Settings → Connect Slack</strong>. Once connected:
            </p>
            <ul className="text-gray-400 text-sm list-disc list-inside space-y-1">
              <li>DM the Open Brain bot to search or capture thoughts directly from Slack</li>
              <li>Use <code className="text-blue-400">/brain [query]</code> in any channel to search your brain</li>
            </ul>
          </div>

          {/* Gmail */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-3">
              <span className="text-2xl">📧</span>
              <h3 className="text-white font-semibold text-lg">Gmail</h3>
            </div>
            <p className="text-gray-400 text-sm">
              Connect Gmail at <strong className="text-white">Settings → Connect Gmail</strong>. Open Brain pulls intentionally — only the emails worth remembering, on demand. Ask things like <em>"what did Sarah send me about the Q2 budget?"</em> and find it instantly.
            </p>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-gray-900/60 rounded-lg p-3 space-y-2">
                <p className="text-green-400 font-medium">What gets captured</p>
                <ul className="text-gray-400 space-y-1">
                  <li>✓ 1:1 conversations</li>
                  <li>✓ Small group threads (≤6 people)</li>
                  <li>✓ Travel confirmations &amp; bookings</li>
                  <li>✓ Receipts &amp; invoices</li>
                  <li>✓ Sender, subject, date, thread ID</li>
                </ul>
              </div>
              <div className="bg-gray-900/60 rounded-lg p-3 space-y-2">
                <p className="text-red-400 font-medium">What's excluded</p>
                <ul className="text-gray-400 space-y-1">
                  <li>✗ Promotions &amp; newsletters</li>
                  <li>✗ Social notifications</li>
                  <li>✗ Automated updates &amp; alerts</li>
                  <li>✗ Large group / mailing lists</li>
                  <li>✗ Email body (never stored)</li>
                </ul>
              </div>
            </div>

            <p className="text-gray-500 text-xs">
              Uses Gmail metadata scope only — Open Brain never reads or stores email content.
            </p>
          </div>
        </div>
      </div>

      {/* Scheduled Tasks */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6 space-y-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl">⏰</span>
          <h3 className="text-white font-semibold text-lg">Scheduled tasks</h3>
          <span className="text-xs bg-blue-600/20 text-blue-400 border border-blue-600/30 px-2 py-0.5 rounded-full">Claude Code</span>
        </div>
        <p className="text-gray-400 text-sm">
          Set up recurring background tasks that run automatically — for example, "every morning, fetch the top AI news and save a summary to my brain." Tasks run on your schedule and capture results directly to Open Brain.
        </p>
        <p className="text-gray-400 text-sm">
          Currently available via Claude Code. Web UI coming soon.
        </p>
        <CodeBlock>{"schedule_task(\n  title: \"Daily AI digest\",\n  schedule: \"every 24 hours\",\n  action: \"Fetch top stories from news.ycombinator.com and summarize the AI-related ones.\"\n)"}</CodeBlock>
      </div>

      {/* CTA footer */}
      <div className="text-center space-y-4 border-t border-gray-800 pt-12">
        <h2 className="text-2xl font-bold text-white">Ready to build your second brain?</h2>
        <p className="text-gray-400">Sign in and capture your first thought in under a minute.</p>
        <Link
          to="/login"
          className="inline-block bg-blue-600 text-white px-8 py-3 rounded-lg hover:bg-blue-500 font-medium"
        >
          Get started free
        </Link>
      </div>
    </div>
  );
}
