# Deploying TANKFIELD

One Node process serves **both** the built client (static `dist/`) and the
game WebSocket (`/ws`) on the same origin, so it runs on almost any Node
hosting platform out of the box. No database, no environment variables, no
WebSocket proxy required.

## 1. Any Node host (Render / Railway / Fly.io / VPS)

```bash
# build the client, then run the combined HTTP+WS server
npm run build
npm start                 # listens on $PORT (default 3000)
```

Recommended build command (`package.json`): `npm run build && npm start`
so the deploy runs the built client.

Steps:

1. `npm install`
2. `npm run build`
3. `npm start` (set `PORT` via the platform env if different)

That's it — the game is live at `https://<your-app>/`.

## 2. Behind a proxy / TLS

The server already speaks WS on the same origin as HTTP, so any reverse proxy
that forwards both HTTP and `wss://` traffic works. No special path rewrite:

```
/wss  the browser connects to /ws
```

Node's built-in web server is single-threaded. For real traffic (or to use
more than one core) run it behind `pm2`/`cluster` on a VPS:

```bash
pm2 start server/index.js -i max
```

## 3. Two-host setup: static client (GitHub Pages) + game server

The client can point at a **different** game server than the one serving the
page. Use this when the client is published somewhere static, like GitHub
Pages (`Deploy TANKFIELD to Pages` workflow publishes `dist/`).

The game server must be a real Node host that answers `/ws`:

- **Render (one click):** the repo ships `render.yaml`. On Render use
  *New → Blueprint → this repo*. It builds the client and serves both the
  page and `/ws` at `https://tankfield.onrender.com`.
- **Railway / Fly.io / any Node VPS:** `npm run build && npm start`.

Then make the static Pages client connect to that server — two ways:

- **Settings → GAME SERVER** (persisted per browser): fill in
  `https://tankfield.onrender.com` (or any `http(s)://host[:port]`, or a bare
  `host:port`) and it reconnects immediately.
- **Shareable link** (no setup for friends):
  `https://<you>.github.io/T4NKGAME/?server=https://tankfield.onrender.com`

The override inserts the game's `/ws` path automatically, so the full
`wss://…/ws` endpoint is optional in the box.

## 4. WebSocket notes

- The client connects to `ws(s)://<host>/ws` (same origin by default — see
  `CONFIG.net.wsPath`); the Settings `server` override or a `?server=` query
  switches hosts.
- In dev, `vite.config.js` proxies `/ws` to `localhost:3000`.
- The server is origin-agnostic on `/ws`, so cross-host connections
  (Pages → Render) work out of the box.

## Environment

| Var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP + WebSocket port |

Everything else is in `src/config.js` (match rules, teams, terrain seed,
tick rate, player caps…).