# Anote

A full-stack calendar application with event management, roles-based notes, and an admin panel.

## 🚀 Quick Start

### Prerequisites
- **Node.js** (v18 or higher)
- **npm** (comes with Node.js)

### Installation

```bash
# 1. Clone/copy the project
cd /path/to/anote

# 2. Install frontend dependencies
npm install

# 3. Install server dependencies
cd server && npm install && cd ..
```

### Running the App

**Option A: Run both in separate terminals**

```bash
# Terminal 1 - Start the backend server
cd server && PORT=3002 node index.js
# Development server runs at http://localhost:3002

# Terminal 2 - Start the frontend
npm run dev
# Frontend runs at http://localhost:5173
```

**Option B: Quick start script (run from project root)**

```bash
# Start server in background, then frontend
cd server && PORT=3002 node index.js & cd .. && npm run dev
```

---

## 🔄 Patch Production Copy (keep DB/uploads)

- Default production path is `/Users/digogonz/Desktop/Calendario/cal-ap`.
- One-shot deploy: run `bash scripts/deploy_to_prod.sh` from the dev root. It syncs code, installs deps in the prod copy (frontend + server), and leaves DB/uploads untouched.
- Dry run: `DRY_RUN=1 bash scripts/deploy_to_prod.sh` (only previews rsync).
- Skip installs: `SKIP_INSTALL=1 bash scripts/deploy_to_prod.sh` (sync only).
- Override prod path: `PROD_DIR=/custom/path bash scripts/deploy_to_prod.sh`.
- Under the hood it uses `scripts/patch_to_prod.sh`, which protects `server/calendar.db*`, `server/uploads/`, and root `uploads/`; stale code is cleaned with `--delete`.
- After a deploy, restart the production services if they are running.

---

## 🧰 Production User Ops

- Use the dev repo as the control point for production user changes.
- Promote admin: `npm run --silent prod:user:make-admin -- --username=USACO`
- Remove admin: `npm run --silent prod:user:remove-admin -- --username=USACO`
- Change username: `npm run --silent prod:user:change-username -- --username=oldname --new-username=newname`
- Explicit target dir: append `--dir=/path/to/prod`
- Save that dir as the new default: append `--dir-default`
- Show current resolved default: `node scripts/prod_user_ops.cjs show-default-dir`
- Inspect role history: `npm run --silent prod:user:history -- --username=USACO`
- Full notes: `scripts/PROD_USER_OPS.md`

---

## 🔗 URLs

| Service | URL | Description |
|---------|-----|-------------|
| Frontend | http://localhost:5173 | Main calendar app |
| Development API/Admin | http://localhost:3002 | Development database and administration |
| Production API/Admin | http://localhost:3001 | Production database and administration |

---

## 🔧 Fresh Start (Clean Database)

To start with a completely fresh database:

```bash
# Remove database files
rm -f server/calendar.db server/calendar.db-shm server/calendar.db-wal

# Optional: Clear uploaded files
rm -rf server/uploads/*

# Restart the server (creates fresh DB)
cd server && node index.js
```

---

## 👤 First Admin User

When starting fresh, create an admin user:

1. Register a new user via the frontend at http://localhost:5173
2. From the dev repo, promote that user with `npm run --silent prod:user:make-admin -- --username=<username>`
3. Restart the production server if needed so the latest backend code is active

Or use the seeded admin account (if available):
- **Username:** `admin`
- **Password:** `admin123`

---

## 📁 Project Structure

```
anote/
├── src/                    # Frontend React code
│   ├── components/         # UI components
│   ├── store/              # Zustand state management
│   └── utils/              # Utility functions
├── server/                 # Backend Node.js server
│   ├── index.js            # Main server file
│   ├── static_admin/       # Admin panel HTML
│   ├── uploads/            # Uploaded files
│   └── calendar.db         # SQLite database
├── package.json            # Frontend dependencies
└── README.md               # This file
```

---

## 🛠️ Tech Stack

- **Frontend:** React, Vite, Zustand, TailwindCSS
- **Backend:** Node.js (LTS), Express, SQLite (better-sqlite3)
- **Auth:** JWT (JSON Web Tokens)

---

## 📝 Features

- ✅ Calendar with event management
- ✅ Role-based notes system
- ✅ User authentication (login/register)
- ✅ Admin panel with full CRUD
- ✅ File uploads in notes
- ✅ Markdown support in notes
- ✅ Multi-user support
- ✅ Friend calendar sharing
