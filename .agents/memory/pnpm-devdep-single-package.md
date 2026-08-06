---
name: pnpm add devDependency into one workspace package
description: How to add a devDependency (e.g. a test runner) to a single package in this pnpm monorepo without hitting ERR_PNPM_ADDING_TO_ROOT.
---

`pnpm add -D <pkg>` run from the monorepo root fails with
`ERR_PNPM_ADDING_TO_ROOT` — pnpm workspaces require targeting a specific
package. Run the command from inside the target package directory instead
(e.g. `cd server && pnpm add -D vitest`), or use `pnpm add -D <pkg> --filter
<package-name>` from the root.

**Why:** the root package.json is the workspace manager, not a normal
package — adding deps there is blocked by default to avoid accidental
monorepo-wide dependency bloat.

**How to apply:** any time a package-management tool call errors with
`ERR_PNPM_ADDING_TO_ROOT`, retry `cd` into the specific package first.
