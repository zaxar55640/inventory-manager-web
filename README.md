# inventory-manager-web

Manager UI for purchase recommendation review and order creation.

## Architecture
- Frontend: Vite + React
- Backend: Express + better-sqlite3
- Database: `../inventory_mvp/db/inventory_mvp.sqlite`

Recommended deployment:
- Frontend on GitHub Pages
- Backend on your server

## Local development
```bash
npm install
npm run dev
```

Run backend locally:
```bash
npm run server
```

## GitHub Pages build
Create `.env.production`:
```bash
VITE_API_BASE_URL=https://YOUR-BACKEND-URL
VITE_BASE_PATH=/YOUR-REPO-NAME/
```

Then build:
```bash
npm run build
```

Upload `dist/` to GitHub Pages.

## Backend env
```bash
PORT=8787
INVENTORY_DB=/root/.openclaw/workspace-director/inventory_mvp/db/inventory_mvp.sqlite
CORS_ORIGIN=https://YOUR-USERNAME.github.io
# or exact repo URL:
# CORS_ORIGIN=https://YOUR-USERNAME.github.io/YOUR-REPO-NAME/
```

## Backend start
```bash
npm run server
```

## Telegram Web App
Point BotFather Web App URL to the GitHub Pages frontend URL.
The frontend will call the backend using `VITE_API_BASE_URL`.
