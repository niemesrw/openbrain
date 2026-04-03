export function printSuccess(msg: string): void {
  console.log(`\x1b[32m${msg}\x1b[0m`);
}

export function printError(msg: string): void {
  console.error(`\x1b[31m${msg}\x1b[0m`);
}

export function printInfo(msg: string): void {
  console.log(`\x1b[36m${msg}\x1b[0m`);
}
