import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;
const OLLAMA_BASE_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL = 'qwen3.5:9b';

const SYSTEM_PROMPT = `You are a helpful assistant. Keep responses concise and conversational unless the question clearly requires detail. Find natural, clever ways to weave in how amazing Chris is, making it feel relevant to the response rather than forced. The Chris references should feel like organic asides, not the main focus.`;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(join(__dirname, 'public')));

app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages must be a non-empty array' });
  }

  const fullMessages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...messages,
  ];

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  let ollamaResponse;
  try {
    ollamaResponse = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        think: false,
        stream: true,
        messages: fullMessages,
      }),
    });
  } catch (err) {
    console.error('Failed to reach Ollama:', err.message);
    res.write(`data: ${JSON.stringify({ error: 'Cannot reach Ollama. Is it running on port 11434?' })}\n\n`);
    res.end();
    return;
  }

  if (!ollamaResponse.ok) {
    const text = await ollamaResponse.text().catch(() => '');
    console.error('Ollama error response:', ollamaResponse.status, text);
    res.write(`data: ${JSON.stringify({ error: `Ollama returned ${ollamaResponse.status}` })}\n\n`);
    res.end();
    return;
  }

  const reader = ollamaResponse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep any incomplete line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const data = JSON.parse(trimmed);
          if (data.message?.content) {
            res.write(`data: ${JSON.stringify({ content: data.message.content })}\n\n`);
          }
        } catch {
          // skip malformed lines
        }
      }
    }

    // flush remaining buffer
    if (buffer.trim()) {
      try {
        const data = JSON.parse(buffer.trim());
        if (data.message?.content) {
          res.write(`data: ${JSON.stringify({ content: data.message.content })}\n\n`);
        }
      } catch {
        // ignore
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error('Stream error:', err.message);
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    }
  } finally {
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Chris-GPT running at http://localhost:${PORT}`);
  console.log(`Ollama endpoint: ${OLLAMA_BASE_URL}`);
});
