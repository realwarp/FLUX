#!/usr/bin/env bun
import { main } from "./main.ts";
import { describeError } from "@flux/shared";

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`flux: ${describeError(error)}\n`);
  process.exitCode = 1;
});
