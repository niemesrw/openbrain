import { useEffect, useState } from "react";
import {
  getGitHubInstallations,
  disconnectGitHubInstallation,
  type GitHubInstallation,
  getSlackInstallUrl,
  getSlackInstallations,
  disconnectSlackInstallation,
  type SlackInstallation,
  getGoogleConnectUrl,
  getGoogleConnections,
  disconnectGoogleConnection,
  syncGmail,
  type GoogleConnection,
} from "../lib/api";

const GITHUB_APP_SLUG = import.meta.env.VITE_GITHUB_APP_SLUG as string | undefined;
const installUrl = GITHUB_APP_SLUG
  ? `https://github.com/apps/${GITHUB_APP_SLUG}/installations/new`
  : null;

function InstallationRow({
  inst,
  onDisconnect,
}: {
  inst: GitHubInstallation;
  onDisconnect: (id: string) => void;
}) {
  const icon = inst.accountType === "Organization" ? "🏢" : "👤";
  const date = new Date(inst.installedAt).toLocaleDateString();
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState("");

  async function handleDisconnect() {
    if (
      !window.confirm(
        `Disconnect ${inst.accountLogin} from Open Brain? This will stop capturing GitHub events for this account.`
      )
    ) {
      return;
    }
    setDisconnecting(true);
    setDisconnectError("");
    try {
      await disconnectGitHubInstallation(inst.installationId);
      onDisconnect(inst.installationId);
    } catch (e: unknown) {
      setDisconnectError(e instanceof Error ? e.message : "Failed to disconnect");
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="py-3 border-b border-gray-800 last:border-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-lg">{icon}</span>
          <div>
            <p className="text-white font-medium">{inst.accountLogin}</p>
            <p className="text-gray-500 text-xs">{inst.accountType} · connected {date}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <a
            href={`https://github.com/settings/installations/${inst.installationId}`}
            target="_blank"
            rel="noreferrer"
            className="text-gray-500 hover:text-gray-300 text-xs"
          >
            Manage on GitHub ↗
          </a>
          <button
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="text-red-500 hover:text-red-400 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {disconnecting ? "Disconnecting…" : "Disconnect"}
          </button>
        </div>
      </div>
      {disconnectError && (
        <p className="text-red-400 text-xs mt-1 pl-9">{disconnectError}</p>
      )}
    </div>
  );
}

function SlackWorkspaceRow({
  inst,
  onDisconnect,
}: {
  inst: SlackInstallation;
  onDisconnect: (teamId: string) => void;
}) {
  const date = new Date(inst.installedAt).toLocaleDateString();
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState("");

  async function handleDisconnect() {
    if (
      !window.confirm(
        `Disconnect ${inst.teamName} from Open Brain? Slack events will stop being captured.`
      )
    ) {
      return;
    }
    setDisconnecting(true);
    setDisconnectError("");
    try {
      await disconnectSlackInstallation(inst.teamId);
      onDisconnect(inst.teamId);
    } catch (e: unknown) {
      setDisconnectError(e instanceof Error ? e.message : "Failed to disconnect");
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="py-3 border-b border-gray-800 last:border-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-lg">#</span>
          <div>
            <p className="text-white font-medium">{inst.teamName}</p>
            <p className="text-gray-500 text-xs">connected {date}</p>
          </div>
        </div>
        <button
          onClick={handleDisconnect}
          disabled={disconnecting}
          className="text-red-500 hover:text-red-400 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {disconnecting ? "Disconnecting…" : "Disconnect"}
        </button>
      </div>
      {disconnectError && (
        <p className="text-red-400 text-xs mt-1 pl-9">{disconnectError}</p>
      )}
    </div>
  );
}

function GoogleConnectionRow({
  conn,
  onDisconnect,
}: {
  conn: GoogleConnection;
  onDisconnect: (email: string) => void;
}) {
  const date = new Date(conn.connectedAt).toLocaleDateString();
  const [disconnecting, setDisconnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string>("");
  const [error, setError] = useState("");

  async function handleSync() {
    setSyncing(true);
    setSyncResult("");
    setError("");
    try {
      const result = await syncGmail(conn.email);
      setSyncResult(`Synced — ${result.captured} captured, ${result.skipped} skipped`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function handleDisconnect() {
    if (
      !window.confirm(
        `Disconnect ${conn.email} from Open Brain? Gmail sync will stop for this account.`
      )
    ) {
      return;
    }
    setDisconnecting(true);
    setError("");
    try {
      await disconnectGoogleConnection(conn.email);
      onDisconnect(conn.email);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to disconnect");
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="py-3 border-b border-gray-800 last:border-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-lg">📧</span>
          <div>
            <p className="text-white font-medium">{conn.email}</p>
            <p className="text-gray-500 text-xs">connected {date}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={handleSync}
            disabled={syncing || disconnecting}
            className="text-gray-400 hover:text-gray-200 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {syncing ? "Syncing…" : "Sync now"}
          </button>
          <button
            onClick={handleDisconnect}
            disabled={disconnecting || syncing}
            className="text-red-500 hover:text-red-400 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {disconnecting ? "Disconnecting…" : "Disconnect"}
          </button>
        </div>
      </div>
      {syncResult && <p className="text-green-400 text-xs mt-1 pl-9">{syncResult}</p>}
      {error && <p className="text-red-400 text-xs mt-1 pl-9">{error}</p>}
    </div>
  );
}

export function SettingsPage() {
  const [installations, setInstallations] = useState<GitHubInstallation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [slackInstallations, setSlackInstallations] = useState<SlackInstallation[]>([]);
  const [slackLoading, setSlackLoading] = useState(true);
  const [slackError, setSlackError] = useState("");
  const [connectingSlack, setConnectingSlack] = useState(false);

  const [googleConnections, setGoogleConnections] = useState<GoogleConnection[]>([]);
  const [googleLoading, setGoogleLoading] = useState(true);
  const [googleError, setGoogleError] = useState("");
  const [connectingGoogle, setConnectingGoogle] = useState(false);

  useEffect(() => {
    getGitHubInstallations()
      .then(setInstallations)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));

    getSlackInstallations()
      .then(setSlackInstallations)
      .catch((e: unknown) => setSlackError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setSlackLoading(false));

    getGoogleConnections()
      .then(setGoogleConnections)
      .catch((e: unknown) => setGoogleError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setGoogleLoading(false));
  }, []);

  function handleDisconnect(installationId: string) {
    setInstallations((prev) => prev.filter((i) => i.installationId !== installationId));
  }

  function handleSlackDisconnect(teamId: string) {
    setSlackInstallations((prev) => prev.filter((i) => i.teamId !== teamId));
  }

  async function handleConnectGoogle() {
    setConnectingGoogle(true);
    setGoogleError("");
    try {
      const url = await getGoogleConnectUrl();
      window.location.href = url;
    } catch (e: unknown) {
      setGoogleError(e instanceof Error ? e.message : "Failed to start Gmail connection");
      setConnectingGoogle(false);
    }
  }

  async function handleConnectSlack() {
    setConnectingSlack(true);
    try {
      const url = await getSlackInstallUrl();
      window.location.href = url;
    } catch (e: unknown) {
      setSlackError(e instanceof Error ? e.message : "Failed to start Slack connection");
      setConnectingSlack(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-10">
      <h1 className="text-2xl font-bold text-white">Settings</h1>

      {/* GitHub section */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-white">GitHub</h2>
            <p className="text-gray-400 text-sm mt-1">
              Connect a GitHub account or organization to capture pull requests,
              pushes, and releases to your brain automatically.
            </p>
          </div>
          {installUrl && (
            <a
              href={installUrl}
              className="shrink-0 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded"
            >
              Connect GitHub
            </a>
          )}
        </div>

        {loading ? (
          <p className="text-gray-500 text-sm">Loading…</p>
        ) : error ? (
          <p className="text-red-400 text-sm">{error}</p>
        ) : installations.length === 0 ? (
          <div className="border border-dashed border-gray-700 rounded-lg p-6 text-center">
            <p className="text-gray-400 text-sm">No GitHub accounts connected yet.</p>
            {installUrl && (
              <a href={installUrl} className="text-blue-400 hover:text-blue-300 text-sm mt-2 block">
                Connect your first account →
              </a>
            )}
          </div>
        ) : (
          <div className="border border-gray-800 rounded-lg px-4">
            {installations.map((inst) => (
              <InstallationRow key={inst.installationId} inst={inst} onDisconnect={handleDisconnect} />
            ))}
          </div>
        )}
      </section>

      {/* Slack section */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Slack</h2>
            <p className="text-gray-400 text-sm mt-1">
              Connect a Slack workspace to capture messages and use slash commands
              to search your brain directly from Slack.
            </p>
          </div>
          <button
            onClick={handleConnectSlack}
            disabled={connectingSlack}
            className="shrink-0 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium px-4 py-2 rounded disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {connectingSlack ? "Redirecting…" : "Connect Slack"}
          </button>
        </div>

        {slackLoading ? (
          <p className="text-gray-500 text-sm">Loading…</p>
        ) : slackError ? (
          <p className="text-red-400 text-sm">{slackError}</p>
        ) : slackInstallations.length === 0 ? (
          <div className="border border-dashed border-gray-700 rounded-lg p-6 text-center">
            <p className="text-gray-400 text-sm">No Slack workspaces connected yet.</p>
            <button
              onClick={handleConnectSlack}
              disabled={connectingSlack}
              className="text-purple-400 hover:text-purple-300 text-sm mt-2 disabled:opacity-50"
            >
              Connect your first workspace →
            </button>
          </div>
        ) : (
          <div className="border border-gray-800 rounded-lg px-4">
            {slackInstallations.map((inst) => (
              <SlackWorkspaceRow key={inst.teamId} inst={inst} onDisconnect={handleSlackDisconnect} />
            ))}
          </div>
        )}
      </section>

      {/* Gmail section */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Gmail</h2>
            <p className="text-gray-400 text-sm mt-1">
              Pulls 1:1 conversations, small group threads, and travel/transactional emails
              as searchable thoughts. Promotions, newsletters, and large group emails are excluded automatically.
              Metadata only — email body is never stored.
            </p>
          </div>
          <button
            onClick={handleConnectGoogle}
            disabled={connectingGoogle}
            className="shrink-0 bg-red-600 hover:bg-red-500 text-white text-sm font-medium px-4 py-2 rounded disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {connectingGoogle ? "Redirecting…" : "Connect Gmail"}
          </button>
        </div>

        {googleLoading ? (
          <p className="text-gray-500 text-sm">Loading…</p>
        ) : googleError ? (
          <p className="text-red-400 text-sm">{googleError}</p>
        ) : googleConnections.length === 0 ? (
          <div className="border border-dashed border-gray-700 rounded-lg p-6 text-center">
            <p className="text-gray-400 text-sm">No Gmail accounts connected yet.</p>
            <button
              onClick={handleConnectGoogle}
              disabled={connectingGoogle}
              className="text-red-400 hover:text-red-300 text-sm mt-2 disabled:opacity-50"
            >
              Connect your first account →
            </button>
          </div>
        ) : (
          <div className="border border-gray-800 rounded-lg px-4">
            {googleConnections.map((conn) => (
              <GoogleConnectionRow
                key={conn.email}
                conn={conn}
                onDisconnect={(email) =>
                  setGoogleConnections((prev) => prev.filter((c) => c.email !== email))
                }
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
