import { callTool } from "../lib/api";
import { printError } from "../lib/display";

interface EditOptions {
  scope?: string;
}

export async function editThought(
  id: string,
  text: string,
  options: EditOptions
): Promise<void> {
  try {
    const args: Record<string, unknown> = { id, text };
    if (options.scope) args.scope = options.scope;

    const result = await callTool("update_thought", args);
    console.log(result);
  } catch (e: any) {
    printError(`Failed: ${e.message}`);
  }
}
