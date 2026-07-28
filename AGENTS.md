# Repository Guidelines

## Project Structure & Module Organization
- `src/` contains the React + TypeScript app. UI components live under `components/` (calendar grids, auth views, inputs), shared state in `store/` (Zustand), helpers in `utils/`, and entry points in `main.tsx`/`App.tsx`. Global styles are split between `index.css` (base/tokens) and `App.css` (layout accents).
- `public/` holds static assets served by Vite; `index.html` wires the client bundle.
- `server/` is an Express + SQLite API. Development data lives beside the server; production data is mounted from the managed Anote production home.
- `docker/` and `compose.production.yaml` own the production gateway/API topology. The browser reaches one origin and uses `/api`; API port `3001` is internal only.
- Tooling/config: `vite.config.ts`, `tsconfig*.json`, `tailwind.config.js`, `eslint.config.js`, and `postcss.config.js` define build, type-check, styling, and lint settings.

## Build, Test, and Development Commands
- `npm install` (root) installs client deps. Run `cd server && npm install` once for the API.
- `npm run dev` starts both development services under Node 20: Vite at http://127.0.0.1:5174 and the API at http://127.0.0.1:3002. Vite proxies `/api` to the API.
- `npm run build` runs `tsc -b` then `vite build` to emit a production bundle.
- `npm run preview` serves the built client locally for verification.
- `npm run verify` selects Node 20, then runs lint, the production build, and all tests. Existing legacy lint debt remains visible as warnings; do not add new warnings.
- `npm run prod:deploy` builds immutable production images, creates a consistent data backup, and health-checks the replacement stack.
- `npm run prod:backup` and `npm run prod:rollback -- <backup-id>` own production recovery. Do not copy a live SQLite/WAL set manually.

## Coding Style & Naming Conventions
- TypeScript, React function components, and Zustand stores; prefer typed props/state and early returns for clarity.
- Use single quotes, trailing semicolons, and 4-space indentation to match existing files; keep imports ordered (external, then absolute/aliased, then relative).
- Components and files: `PascalCase` for React components, `camelCase` for utilities and store actions/selectors. Tailwind classes should stay concise and grouped by layout → spacing → color → effects.

## Testing Guidelines
- Vitest is available in devDependencies; add tests under `src/**/*.test.tsx?` and run via `npx vitest` (or add an `npm test` script). Aim to cover store behaviors (auth/events) and key UI interactions (range selection, navigation).
- Prefer deterministic data (fixed dates, seeded UUIDs) and avoid hitting the live SQLite DB in unit tests; mock fetch where possible.

## Commit & Pull Request Guidelines
- Commit messages should be short, imperative, and scoped (e.g., `Add month navigation guard`, `Fix auth token refresh`). Explain *what* and *why* in the body when non-trivial.
- PRs should include: a brief summary, before/after screenshots or gifs for UI changes, test notes (`npx vitest`, `npm run lint`, manual flows), and any API or DB considerations (e.g., schema changes, seed resets). Link issue IDs when applicable.

## Security & Configuration Tips
- Do not commit secrets or local databases; move `SECRET_KEY` and DB paths into environment variables before productionizing.
- Browser API requests must stay same-origin under `/api`. Internal ports belong to Vite/Nginx/Compose configuration, never browser hostname logic.
