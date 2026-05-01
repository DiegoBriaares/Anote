# Repository Guidelines

## Project Structure & Module Organization
- `src/` contains the React + TypeScript app. UI components live under `components/` (calendar grids, auth views, inputs), shared state in `store/` (Zustand), helpers in `utils/`, and entry points in `main.tsx`/`App.tsx`. Global styles are split between `index.css` (base/tokens) and `App.css` (layout accents).
- `public/` holds static assets served by Vite; `index.html` wires the client bundle.
- `server/` is an Express + SQLite API (`index.js`, `calendar.db`). Install dependencies with `cd server && npm install`; start with `node index.js`.
- Tooling/config: `vite.config.ts`, `tsconfig*.json`, `tailwind.config.js`, `eslint.config.js`, and `postcss.config.js` define build, type-check, styling, and lint settings.

## Build, Test, and Development Commands
- `npm install` (root) installs client deps. Run `cd server && npm install` once for the API.
- `npm run dev` starts the Vite dev server (default http://localhost:5173). Pair with the development API at http://localhost:3002.
- `npm run build` runs `tsc -b` then `vite build` to emit a production bundle.
- `npm run preview` serves the built client locally for verification.
- `npm run lint` runs ESLint across the workspace; fix warnings before merging.
- `node server/index.js` runs the API (expects `calendar.db` beside it; update ports/paths in `server/index.js` if needed).

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
- Keep client/server URLs centralized (`API_URL` in `src/utils/api.ts` and port definitions in `server/index.js`) and update both sides together.
