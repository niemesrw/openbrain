import { useEffect, useState } from "react";
import { getGitHubInstallations, type GitHubInstallation } from "../lib/api";

const GITHUB_APP_SLUG = import.meta.env.VITE_GITHUB_APP_SLUG as string | undefined;
const installUrl = GITHUB_APP_SLUG
  ? `https://github.com/apps/${GITHUB_APP_SLUG}/installations/new`
  : null;

function InstallationRow({ inst }: { inst: GitHubInstallation }) {
  const icon = inst.accountType === "Organization" ? "🏢" : "👤";
  const date = new Date(inst.installedAt).toLocaleDateString();
  return (
    <div className="flex items-center justify-between py-3 border-b border-gray-800 last:border-0">
      <div className="flex items-center gap-3">
        <span className="text-lg">{icon}</span>
        <div>
          <p className="text-white font-medium">{inst.accountLogin}</p>
          <p className="text-gray-500 text-xs">{inst.accountType} · connected {date}</p>
        </div>
      </div>
      <a
        href={`https://github.com/settings/installations/${inst.installationId}`}
        target="_blank"
        rel="noreferrer"
        className="text-gray-500 hover:text-gray-300 text-xs"
      >
        Manage on GitHub ↗
      </a>
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
              <InstallationRow key={inst.installationId} inst={inst} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
