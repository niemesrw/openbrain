import { callTool } from "../lib/api";
import { printError } from "../lib/display";

interface ActivityOptions {
  hours?: string;
  limit?: string;
  agent?: string;
}

export async function activity(options: ActivityOptions): Promise<void> {
  try {
    const args: Record<string, unknown> = {};
    if (options.hours) args.hours = parseInt(options.hours, 10);
    if (options.limit) args.limit = parseInt(options.limit, 10);
    if (options.agent) args.agent = options.agent;

    const result = await callTool("bus_activity", args);
    console.log(result);
  } catch (e: any) {
    printError(`Failed: ${e.message}`);
  }
}
