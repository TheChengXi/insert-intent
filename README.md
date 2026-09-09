# module-map-context

A [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) host plugin that injects your workspace's **module map** — the YAML files under `.intentflow/_packages/` — into the model's context at the start of every new session. The model learns the project's module layout up front instead of scanning the whole directory tree, saving tokens and explanation time.

## What it does

At the first step of each new session, `module-map-context`:

1. locates the project root (walks up from the session cwd looking for `.git`),
2. reads every top-level `.intentflow/_packages/*.yml`,
3. concatenates the files verbatim (filename-sorted, no parsing, no added header),
4. appends the result as a `user`-role context snapshot at the **end** of the step's message batch (after the user message, the `AGENTS.md` baseline, and the runtime context).

It behaves like `AGENTS.md`: the decision is made **once per session**. If the folder has no YAML when the session starts, nothing is injected — and a module map created *later* (e.g. by a `report`) is **not** back-filled into an already-running session.

## Install

Copy the package into a DSH profile's `node_modules` (example: the `web` profile), then add an insert entry to that profile's `cordis.patch.yml`.

```powershell
$src  = 'D:\path\to\module-map-context'
$web  = "$env:USERPROFILE\.dsh\profiles\web"
New-Item -ItemType Directory -Force -Path "$web\node_modules\module-map-context" | Out-Null
Copy-Item "$src\index.js"        "$web\node_modules\module-map-context\" -Force
Copy-Item "$src\lib"             "$web\node_modules\module-map-context\" -Recurse -Force
Copy-Item "$src\package.json"    "$web\node_modules\module-map-context\" -Force
```

Append to `~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
- insert:
    - id: module-map-context
      name: 'module-map-context'
```

Restart `dsh web` (a page refresh is not enough — the composition is resolved at boot).

## Config

```yaml
- id: module-map-context
  name: 'module-map-context'
  config:
    projectRootMarkers: ['.git']   # optional; default ['.git']
```

## Package folder format

Each module is a single YAML file directly under `.intentflow/_packages/`:

```yaml
packageName: <module>
summary: |
  module responsibility, entry file, external dependencies.
groups:
  - name: group name
    summary: why these files belong together — what capability this grouping conveys
    files:
      - <existing file name>
```

## File layout

- `index.js` — plugin entry (`{ name, inject, Config, apply }`), `agent/pre-step` listener and snapshot append
- `lib/discover.js` — project-root discovery (`.git` marker walk) + `ctx.fs` reads
- `lib/render.js` — filename-sorted verbatim concatenation (pure)
- `lib/inject-decision.js` — once-per-session decision
- `test.mjs` — runtime verification against the installed plugin

## License

MIT