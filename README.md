# tartanhacks-history

Per-year static archives of TartanHacks sites.

## Branches

Each year lives on a git branch named by year:

- `2015`
- `2020`
- `2021`
- `2022`
- `2023`
- `2024`
- `2025`
- `2026`

Check out a branch and deploy (for example Railway using the repo `Dockerfile`). The container copies `sites/<year>/` into nginx document root, so asset paths like `/2025/...` keep working.

**`main`** holds only shared Docker and nginx files and no site assets.
