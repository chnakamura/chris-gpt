# Chris-GPT

A personal ChatGPT-style web app powered by a local [Ollama](https://ollama.com) instance, served publicly via Cloudflare Tunnel.

- Model: `qwen3.5:9b` running locally on the Mac Mini
- Live at: https://chris-gpt.com

---

## Requirements

- Node.js 18+
- [Ollama](https://ollama.com) running locally with `qwen3.5:9b` pulled
- [cloudflared](https://github.com/cloudflare/cloudflared) installed
- [PM2](https://pm2.keymetrics.io) for process management

```bash
brew install ollama
brew install cloudflare/cloudflare/cloudflared
ollama pull qwen3.5:9b
npm install -g pm2
```

---

## First-time setup

Run these once to register both services to start automatically on boot.

**Node server via PM2**
```bash
npm install
pm2 start server.js --name chris-gpt
pm2 startup   # run the command it prints
pm2 save
```

**Tunnel via launchd**
```bash
cp cloudflared/config.yml ~/.cloudflared/config.yml
sudo cloudflared service install
sudo launchctl start com.cloudflare.cloudflared
```

After this, both services run in the background permanently. No terminals needed. They restart automatically on crash or reboot.

---

## Useful commands

```bash
# Check if everything is running
pm2 status

# View app logs
pm2 logs chris-gpt

# Restart the app (e.g. after code changes)
pm2 restart chris-gpt

# Stop everything
pm2 stop chris-gpt
sudo launchctl stop com.cloudflare.cloudflared
```

---

## Development

```bash
npm run dev
```

Uses `--watch` so the server restarts automatically on file changes. The tunnel can stay running as a service while you develop.

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
| Site unreachable externally | Run `pm2 status` and check the tunnel: `sudo launchctl list \| grep cloudflare` |
| Changes not showing | Run `pm2 restart chris-gpt` after editing server files |
| `flag provided but not defined: -config` | Use `--config` before `tunnel run`: `cloudflared --config ... tunnel run ...` |
