# Anote Quick Start

## Development

Install dependencies once, then start the frontend and API together:

```bash
npm install
cd server && npm install && cd ..
npm run dev
```

- App: `http://127.0.0.1:5174`
- API readiness: `http://127.0.0.1:5174/api/health/ready`
- The direct development API listens only on `127.0.0.1:3002`.

## Verification

```bash
npm run verify
```

## Production

Production is built from the development repository; source files are not
copied into a second runnable tree.

```bash
git switch main
git pull --ff-only
npm run verify
npm run prod:deploy
```

Production access:

- `http://anote`
- `https://<anote-device>.<tailnet>.ts.net`
- `http://<host>.local:15173`

Operations:

```bash
npm run prod:backup
npm run prod:rollback -- <backup-id>
source scripts/production_paths.sh
docker compose --env-file "$ANOTE_ENV_FILE" -f compose.production.yaml ps
```

The production API is internal to Docker. Do not open or proxy host port `3001`.
