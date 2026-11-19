# Agent notes

The sponsor block in `2027/index.html`, from `<!-- sponsors:start -->` through `<!-- sponsors:end -->`, is generated output.

Change `scripts/sync-local.ts`, then run `bun run sponsors:sync:local`. That command rewrites the block. The task is done when the block matches the generator.
