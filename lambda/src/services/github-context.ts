export interface GitHubEventContext {
  repoFullName: string;
  actor: string;
  summary: string;
  url: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Payload = Record<string, any>;

function pullRequestContext(payload: Payload): GitHubEventContext {
  const pr = payload.pull_request;
  const repo = payload.repository?.full_name ?? "unknown/repo";
  const actor = payload.sender?.login ?? "unknown";
  const action = payload.action ?? "updated";
  const title = pr?.title ?? "(no title)";
  const body = pr?.body ? `\n\n${pr.body.slice(0, 500)}` : "";
  const number = pr?.number ?? "?";
  const base = pr?.base?.ref ?? "main";
  const head = pr?.head?.ref ?? "unknown";
  const additions = pr?.additions ?? 0;
  const deletions = pr?.deletions ?? 0;
  const changedFiles = pr?.changed_files ?? 0;
  const url = pr?.html_url ?? "";
  const merged = action === "closed" && pr?.merged;

  const actionLabel = merged
    ? "merged"
    : action === "closed"
    ? "closed without merging"
    : action;

  const summary =
    `GitHub PR #${number} ${actionLabel} by ${actor} in ${repo}\n` +
    `Title: ${title}\n` +
    `Branch: ${head} → ${base}\n` +
    (changedFiles > 0
      ? `Changes: ${changedFiles} files, +${additions}/-${deletions} lines\n`
      : "") +
    body;

  return { repoFullName: repo, actor, summary, url };
}

function pushContext(payload: Payload): GitHubEventContext {
  const repo = payload.repository?.full_name ?? "unknown/repo";
  const actor = payload.pusher?.name ?? payload.sender?.login ?? "unknown";
  const ref: string = payload.ref ?? "";
  const branch = ref.replace("refs/heads/", "");
  const commits: Payload[] = payload.commits ?? [];
  const compareUrl: string = payload.compare ?? "";

  const commitLines = commits
    .slice(0, 5)
    .map((c: Payload) => `  - ${c.message?.split("\n")[0]}`)
    .join("\n");
  const more = commits.length > 5 ? `\n  ...and ${commits.length - 5} more` : "";

  const summary =
    `GitHub push to ${branch} in ${repo} by ${actor}\n` +
    `${commits.length} commit${commits.length !== 1 ? "s" : ""}:\n` +
    commitLines +
    more;

  return { repoFullName: repo, actor, summary, url: compareUrl };
}

function releaseContext(payload: Payload): GitHubEventContext {
  const repo = payload.repository?.full_name ?? "unknown/repo";
  const actor = payload.sender?.login ?? "unknown";
  const release = payload.release ?? {};
  const name = release.name ?? release.tag_name ?? "unknown";
  const tag = release.tag_name ?? "";
  const body = release.body ? `\n\n${release.body.slice(0, 500)}` : "";
  const url = release.html_url ?? "";
  const prerelease = release.prerelease ? " (pre-release)" : "";

  const summary =
    `GitHub release ${name}${prerelease} published in ${repo} by ${actor}\n` +
    `Tag: ${tag}` +
    body;

  return { repoFullName: repo, actor, summary, url };
}

export function buildEventContext(
  eventType: string,
  payload: Payload
): GitHubEventContext | null {
  switch (eventType) {
    case "pull_request":
      return pullRequestContext(payload);
    case "push":
      // Skip branch deletions and tags
      if (!payload.ref?.startsWith("refs/heads/")) return null;
      if ((payload.commits ?? []).length === 0) return null;
      return pushContext(payload);
    case "release":
      if (payload.action !== "published") return null;
      return releaseContext(payload);
    default:
      return null;
  }
}
