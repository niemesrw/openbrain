import { callTool } from "../lib/api";
import { printError } from "../lib/display";

export async function createAgent(name: string): Promise<void> {
  try {
    const result = await callTool("create_agent", { name });
    console.log(result);
  } catch (e: any) {
    printError(`Failed: ${e.message}`);
  }
}
