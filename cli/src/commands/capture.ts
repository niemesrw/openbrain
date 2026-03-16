import { callTool } from "../lib/api";
import { printError } from "../lib/display";

interface CaptureOptions {
  scope?: string;
}

export async function capture(
  text: string,
  options: CaptureOptions
): Promise<void> {
  try {
    const args: Record<string, unknown> = { text };
    if (options.scope) args.scope = options.scope;

    const result = await callTool("capture_thought", args);
    console.log(result);
  } catch (e: any) {
    printError(`Failed: ${e.message}`);
  }
}
