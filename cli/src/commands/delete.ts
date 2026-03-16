import { callTool } from "../lib/api";
import { printError } from "../lib/display";
import * as readline from "readline";

interface DeleteOptions {
  scope?: string;
  yes?: boolean;
}

export async function deleteThought(
  id: string,
  options: DeleteOptions
): Promise<void> {
  try {
    if (!options.yes) {
      const confirmed = await confirm(`Delete thought ${id}? (y/N) `);
      if (!confirmed) {
        console.log("Aborted.");
        return;
      }
    }

    const args: Record<string, unknown> = { id };
    if (options.scope) args.scope = options.scope;

    const result = await callTool("delete_thought", args);
    console.log(result);
  } catch (e: any) {
    printError(`Failed: ${e.message}`);
  }
}

function confirm(prompt: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}
