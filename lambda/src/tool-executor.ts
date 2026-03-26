import { handleSearchThoughts } from "./handlers/search-thoughts";
import { handleBrowseRecent } from "./handlers/browse-recent";
import { handleStats } from "./handlers/stats";
import { handleCaptureThought } from "./handlers/capture-thought";
import { handleUpdateThought } from "./handlers/update-thought";
import { handleDeleteThought } from "./handlers/delete-thought";
import { handleCreateAgent, handleListAgents, handleRevokeAgent } from "./handlers/agent-keys";
import { handleBusActivity } from "./handlers/bus-activity";
import { handleScheduleTask, handleListTasks, handleCancelTask } from "./handlers/agent-tasks";
import type { UserContext } from "./types";

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  user: UserContext,
): Promise<string> {
  switch (name) {
    case "search_thoughts":
      return handleSearchThoughts(args as any, user);
    case "browse_recent":
      return handleBrowseRecent(args as any, user);
    case "stats":
      return handleStats(args as any, user);
    case "capture_thought":
      return handleCaptureThought(args as any, user);
    case "update_thought":
      return handleUpdateThought(args as any, user);
    case "delete_thought":
      return handleDeleteThought(args as any, user);
    case "create_agent":
      return handleCreateAgent(args as any, user);
    case "list_agents":
      return handleListAgents(args as any, user);
    case "revoke_agent":
      return handleRevokeAgent(args as any, user);
    case "bus_activity":
      return handleBusActivity(args as any, user);
    case "schedule_task":
      return handleScheduleTask(args as any, user);
    case "list_tasks":
      return handleListTasks(args as any, user);
    case "cancel_task":
      return handleCancelTask(args as any, user);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
