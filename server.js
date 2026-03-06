import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;
const OLLAMA_BASE_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL = 'qwen3.5:9b';
const BRAVE_API_KEY = process.env.BRAVE_API_KEY;

const SYSTEM_PROMPT = `You are a helpful assistant. Keep responses concise and conversational unless the question clearly requires detail. Find natural, clever ways to weave in how amazing Chris is, making it feel relevant to the response rather than forced. The Chris references should feel like organic asides, not the main focus.`;

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for current information, recent news, prices, weather, sports scores, release dates, local places, businesses, or anything requiring up-to-date or location-specific data.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' },
        },
        required: ['query'],
      },
    },
  },
];

/* ── Brave Search ─────────────────────────────────────── */
async function braveSearch(query) {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`;
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'X-Subscription-Token': BRAVE_API_KEY,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[brave] ${res.status} ${res.statusText} — ${body}`);
    throw new Error(`Brave Search failed: ${res.status}`);
  }
  const data = await res.json();
  const results = data.web?.results ?? [];
  if (results.length === 0) return { text: 'No results found.', sources: [] };
  return {
    text: results
      .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.description ?? ''}`)
      .join('\n\n'),
    sources: results.map(r => ({ title: r.title, url: r.url })),
  };
}

/* ── Stream Ollama response to SSE ───────────────────── */
async function streamResponse(messages, res) {
  let ollamaRes;
  try {
    ollamaRes = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, think: false, stream: true, messages }),
    });
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: 'Cannot reach Ollama.' })}\n\n`);
    return;
  }

  if (!ollamaRes.ok) {
    res.write(`data: ${JSON.stringify({ error: `Ollama returned ${ollamaRes.status}` })}\n\n`);
    return;
  }

  const reader = ollamaRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const data = JSON.parse(trimmed);
        if (data.message?.content) {
          res.write(`data: ${JSON.stringify({ content: data.message.content })}\n\n`);
        }
      } catch { /* skip malformed */ }
    }
  }

  if (buffer.trim()) {
    try {
      const data = JSON.parse(buffer.trim());
      if (data.message?.content) {
        res.write(`data: ${JSON.stringify({ content: data.message.content })}\n\n`);
      }
    } catch { /* ignore */ }
  }
}

/* ── Express setup ────────────────────────────────────── */
app.use(express.json({ limit: '10mb' }));
app.use(express.static(join(__dirname, 'public')));

app.post('/api/chat', async (req, res) => {
  const { messages, context } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages must be a non-empty array' });
  }

  let contextStr = '';
  if (context?.time || context?.location) {
    const parts = [];
    if (context.time)     parts.push(`The current date and time is ${context.time}.`);
    if (context.location) parts.push(`The user is located in ${context.location}.`);
    contextStr = '\n\n[Context: ' + parts.join(' ') + ']';
  }

  const fullMessages = [
    { role: 'system', content: SYSTEM_PROMPT + contextStr },
    ...messages,
  ];

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    // Stream with tools enabled. Tool-call responses have no content so we
    // can safely buffer them without the user seeing a delay.
    let ollamaRes;
    try {
      ollamaRes = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          think: false,
          stream: true,
          tools: BRAVE_API_KEY ? TOOLS : undefined,
          messages: fullMessages,
        }),
      });
    } catch (err) {
      console.error('Failed to reach Ollama:', err.message);
      res.write(`data: ${JSON.stringify({ error: 'Cannot reach Ollama. Is it running on port 11434?' })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    if (!ollamaRes.ok) {
      res.write(`data: ${JSON.stringify({ error: `Ollama returned ${ollamaRes.status}` })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    // Read the stream — forward content chunks, collect any tool calls
    const reader = ollamaRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let toolCalls = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const data = JSON.parse(trimmed);
          if (data.message?.content) {
            // Regular content — stream straight to client
            res.write(`data: ${JSON.stringify({ content: data.message.content })}\n\n`);
          }
          if (data.message?.tool_calls?.length) {
            toolCalls = data.message.tool_calls;
            console.log('[tool] model requested:', JSON.stringify(toolCalls));
          }
        } catch { /* skip */ }
      }
    }

    const toolName = toolCalls[0]?.function?.name;
    console.log(`[chat] tool: ${toolName ?? 'none'}, msg: "${messages.at(-1)?.content?.slice(0, 60)}"`);

    if (toolName === 'web_search') {
      const toolCall = toolCalls[0];
      let args = toolCall.function.arguments;
      if (typeof args === 'string') args = JSON.parse(args);
      const query = args.query;

      res.write(`data: ${JSON.stringify({ status: 'searching', query })}\n\n`);

      console.log(`[brave] searching: "${query}"`);
      let searchText = '';
      let sources = [];
      try {
        ({ text: searchText, sources } = await braveSearch(query));
        console.log(`[brave] got ${sources.length} results`);
      } catch (err) {
        console.error(`[brave] error: ${err.message}`);
        searchText = `Search failed: ${err.message}`;
      }

      res.write(`data: ${JSON.stringify({ status: 'search_done', query, sources })}\n\n`);

      const messagesWithTool = [
        ...fullMessages,
        { role: 'assistant', content: '', tool_calls: toolCalls },
        { role: 'tool', content: searchText },
      ];

      await streamResponse(messagesWithTool, res);
    }

  } catch (err) {
    console.error('Error:', err.message);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
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
  console.log(`Brave Search: ${BRAVE_API_KEY ? 'enabled' : 'disabled (set BRAVE_API_KEY to enable)'}`);
});
