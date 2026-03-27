import { useEffect, useState } from "react";
import { getGitHubInstallations, disconnectGitHubInstallation, type GitHubInstallation } from "../lib/api";

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

export function SettingsPage() {
  const [installations, setInstallations] = useState<GitHubInstallation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    getGitHubInstallations()
      .then(setInstallations)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  function handleDisconnect(installationId: string) {
    setInstallations((prev) => prev.filter((i) => i.installationId !== installationId));
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
    </div>
  );
}
