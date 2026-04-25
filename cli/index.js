#!/usr/bin/env node

import { getCommands, runCommand } from "./commands.js";
import { renderError } from "./render.js";

async function main() {
  const result = await runCommand(getRuntimeArgs());

  if (result.error) {
    console.error(renderError(result.error));
    if (!result.streamed || result.output) console.log(result.output);
  } else if (!result.streamed || result.output) {
    console.log(result.output);
  }

  if (result.keepAlive) return;
  setExitCode(result.exitCode ?? 0);
}

main().catch((err) => {
  console.error(renderError(err?.message ?? String(err)));
  setExitCode(1);
});

function getRuntimeArgs() {
  if (globalThis.process?.argv) return globalThis.process.argv.slice(2);

  const argv = globalThis.Bare?.argv ?? [];
  const commandNames = new Set([
    ...getCommands().map((command) => command.name),
    "help",
    "--help",
    "-h",
  ]);
  const commandIndex = argv.findIndex((arg) => commandNames.has(arg));

  return commandIndex === -1 ? argv : argv.slice(commandIndex);
}

function setExitCode(code) {
  if (globalThis.process) globalThis.process.exitCode = code;
  if (globalThis.Bare) globalThis.Bare.exitCode = code;
}
