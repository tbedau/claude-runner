# Claude Runner

## Dev Workflows

- **Tests:** `bun test`
- **Build frontend:** `bun run build` (Vite, outputs to `dist/`)
- **Dev mode:** `bun run dev` (HMR frontend on :5173 + auto-restarting server on :7429)
- **Restart server:** `launchctl kickstart -k gui/$(id -u)/com.claude-runner.server`

After changing frontend code, you must `bun run build` and restart the server for production to pick up changes.

## Project Structure

- `runner.sh` — shell script that runs a single job end-to-end
- `setup.sh` — installs launchd plists from job YAML definitions
- `server/` — Hono API server (Bun)
- `web/` — React frontend (Vite + shadcn/ui)
- `jobs/` — job YAML definitions
- `tests/` — Bun test files
