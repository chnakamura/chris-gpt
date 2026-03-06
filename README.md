# Chris-GPT

A personal ChatGPT-style web app powered by a local [Ollama](https://ollama.com) instance, served publicly via Cloudflare Tunnel.

- Model: `qwen3.5:9b` running locally on the Mac Mini
- Web search via [Brave Search API](https://brave.com/search/api/) (optional, set `BRAVE_API_KEY`)
- Live at: https://chris-gpt.com

---

## Requirements

- Node.js 18+
- [Ollama](https://ollama.com) running locally with `qwen3.5:9b` pulled
- [cloudflared](https://github.com/cloudflare/cloudflared) installed
- [PM2](https://pm2.keymetrics.io) for process management
- (Optional) Brave Search API key for web search

```bash
brew install ollama
brew install cloudflare/cloudflare/cloudflared
ollama pull qwen3.5:9b
npm install -g pm2
```

---

## First-time setup

Run these once. After this, everything starts automatically on boot — no terminals needed.

**1. Install dependencies**
```bash
npm install
```

**2. Register PM2 to start on boot**
```bash
pm2 startup   # run the command it prints, then come back
```

**3. Start the Node server**
```bash
pm2 start server.js --name chris-gpt
```

**4. Start the Cloudflare tunnel**
```bash
pm2 start /opt/homebrew/bin/cloudflared --name tunnel -- --config cloudflared/config.yml tunnel run chris-gpt
```

**5. Save the process list**
```bash
pm2 save
```

**6. Start Ollama on boot**
```bash
brew services start ollama
```

All three services (Node server, Cloudflare tunnel, Ollama) will now start automatically on reboot and restart on crash.

---

## Useful commands

```bash
# Check if everything is running
pm2 status

# View app logs
pm2 logs chris-gpt

# View tunnel logs
pm2 logs tunnel

# Restart the app (e.g. after code changes to server.js)
pm2 restart chris-gpt

# Restart the tunnel
pm2 restart tunnel

# Stop everything
pm2 stop all
```

---

## Development

```bash
npm run dev
```

Uses `--watch` so the server restarts automatically on file changes. The tunnel can stay running via PM2 while you develop.

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

### Environment variables

Create a `.env` file in the project root (gitignored):

```
BRAVE_API_KEY=your_key_here   # enables web search tool
OLLAMA_URL=http://localhost:11434  # optional, this is the default
PORT=3000                          # optional, this is the default
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `Cannot reach Ollama` error in chat | Run `brew services start ollama` |
| Site unreachable externally | Run `pm2 status` — check both `chris-gpt` and `tunnel` are online |
| Changes not showing | Run `pm2 restart chris-gpt` after editing `server.js` |
| Tunnel keeps restarting | Run `pm2 logs tunnel` to see the error |
| Web search not working | Check `BRAVE_API_KEY` is set in `.env` and usage limit isn't exceeded |
