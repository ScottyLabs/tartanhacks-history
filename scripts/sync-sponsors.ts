import { fail, syncLocal } from "./sync-local.ts";
import { syncRemote } from "./sync-remote.ts";

// Entry point for the 2027 sponsor sync. `--local` rebuilds the page from
// the image folders. The default run publishes logos from Drive.

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);
  if (args.length === 0) {
    await syncRemote();
    return;
  }
  if (args.length === 1 && args[0] === "--local") {
    await syncLocal();
    return;
  }
  fail(`Unknown arguments: ${args.join(" ")}`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Sponsor sync failed");
    process.exit(1);
  });
}
