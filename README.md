# Chris-GPT

A personal ChatGPT-style web app powered by a local [Ollama](https://ollama.com) instance, served publicly via Cloudflare Tunnel.

- Model: `qwen3.5:9b` running locally on the Mac Mini
- Live at: https://chris-gpt.com

---

## Requirements

- Node.js 18+
- [Ollama](https://ollama.com) running locally with `qwen3.5:9b` pulled
- [cloudflared](https://github.com/cloudflare/cloudflared) installed

```bash
brew install ollama
brew install cloudflare/cloudflare/cloudflared
ollama pull qwen3.5:9b
```

---

## Daily startup

Open two terminal tabs.

**Tab 1 — start the app**
```bash
npm start
```

**Tab 2 — open the tunnel**
```bash
cloudflared --config cloudflared/config.yml tunnel run chris-gpt
```

Then visit **https://chris-gpt.com** (or http://localhost:3000 locally).

---

## Development

```bash
npm run dev
```

Uses `--watch` so the server restarts automatically on file changes. The tunnel command stays the same.

---

## Run automatically on startup (optional)

If you want everything to start when the Mac Mini boots without opening terminals:

**Node server — via PM2**
```bash
npm install -g pm2
pm2 start server.js --name chris-gpt
pm2 startup   # run the command it prints
pm2 save
```

**Tunnel — via launchd service**
```bash
sudo cloudflared service install
sudo launchctl start com.cloudflare.cloudflared
```

> Note: the launchd service uses `~/.cloudflared/config.yml` by default.
> Copy the config there if you want it picked up automatically:
> ```bash
> cp cloudflared/config.yml ~/.cloudflared/config.yml
> ```

---

## Project structure

```
chris-gpt/
├── server.js               # Express server + Ollama streaming proxy
├── package.json
├── public/
│   ├── index.html          # Chat UI
│   ├── style.css           # Dark theme
│   └── app.js              # Streaming, history, markdown rendering
└── cloudflared/
    └── config.yml          # Cloudflare Tunnel config
```

**The system prompt lives in `server.js` only** and is never sent to the browser.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `Cannot reach Ollama` error in chat | Run `ollama serve` or check it's running on port 11434 |
| Tunnel won't connect | Make sure `npm start` is running first on port 3000 |
| Site unreachable externally | Check both terminals are running; verify DNS at dash.cloudflare.com |
| `flag provided but not defined: -config` | Use `--config` before `tunnel run`: `cloudflared --config ... tunnel run ...` |
