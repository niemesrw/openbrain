import { callTool } from "../lib/api";
import { printError } from "../lib/display";

export async function listAgents(): Promise<void> {
  try {
    const result = await callTool("list_agents");
    console.log(result);
  } catch (e: any) {
    printError(`Failed: ${e.message}`);
  }
}
