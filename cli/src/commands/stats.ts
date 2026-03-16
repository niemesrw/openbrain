import { callTool } from "../lib/api";
import { printError } from "../lib/display";

export async function stats(): Promise<void> {
  try {
    const result = await callTool("stats");
    console.log(result);
  } catch (e: any) {
    printError(`Failed: ${e.message}`);
  }
}
