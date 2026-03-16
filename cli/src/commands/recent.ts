import { callTool } from "../lib/api";
import { printError } from "../lib/display";

interface RecentOptions {
  scope?: string;
  type?: string;
  topic?: string;
  limit?: string;
}

export async function recent(options: RecentOptions): Promise<void> {
  try {
    const args: Record<string, unknown> = {};
    if (options.scope) args.scope = options.scope;
    if (options.type) args.type = options.type;
    if (options.topic) args.topic = options.topic;
    if (options.limit) args.limit = parseInt(options.limit, 10);

    const result = await callTool("browse_recent", args);
    console.log(result);
  } catch (e: any) {
    printError(`Failed: ${e.message}`);
  }
}
