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

## 3. WebSocket notes

- The client connects to `ws(s)://<host>/ws` (same origin — see
  `CONFIG.net.wsPath`).
- In dev, `vite.config.js` proxies `/ws` to `localhost:3000`.
- The server requires HTTP/WS on the **same** host/port so it can serve the
  static files **and** terminate the sockets. Don't put the client on a
  separate static CDN unless you also route `/ws` to the game server and set
  up CORS-ish allowances (the client uses same-origin-only URLs by default).

## Environment

| Var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP + WebSocket port |

Everything else is in `src/config.js` (match rules, teams, terrain seed,
tick rate, player caps…).