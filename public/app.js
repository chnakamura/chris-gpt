/* ── State ───────────────────────────────────────────── */
let messages = [];           // [{role, content}] — user/assistant only
let isGenerating = false;
let abortController = null;

/* ── DOM refs ─────────────────────────────────────────── */
const messagesEl   = document.getElementById('messages');
const welcomeEl    = document.getElementById('welcome');
const inputEl      = document.getElementById('input');
const sendBtn      = document.getElementById('send-btn');
const stopBtn      = document.getElementById('stop-btn');
const newChatBtn   = document.getElementById('new-chat-btn');
const convoList    = document.getElementById('conversation-list');

/* ── Marked config ────────────────────────────────────── */
window.addEventListener('load', () => {
  if (window.marked) {
    marked.setOptions({
      gfm: true,
      breaks: true,
      highlight: (code, lang) => {
        if (window.hljs) {
          if (lang && hljs.getLanguage(lang)) {
            return hljs.highlight(code, { language: lang }).value;
          }
          return hljs.highlightAuto(code).value;
        }
        return code;
      },
    });
  }
});

/* ── Helpers ──────────────────────────────────────────── */
function scrollToBottom(force = false) {
  const threshold = 80;
  const nearBottom =
    messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < threshold;
  if (force || nearBottom) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

function renderMarkdown(text) {
  if (!window.marked) return escapeHtml(text).replace(/\n/g, '<br>');
  return marked.parse(text);
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function addCopyButtons(container) {
  container.querySelectorAll('pre').forEach(pre => {
    if (pre.querySelector('.code-header')) return; // already processed

    const codeEl = pre.querySelector('code');
    const lang = [...(codeEl?.classList ?? [])]
      .find(c => c.startsWith('language-'))
      ?.replace('language-', '') ?? '';

    const header = document.createElement('div');
    header.className = 'code-header';

    const langSpan = document.createElement('span');
    langSpan.className = 'code-lang';
    langSpan.textContent = lang || 'code';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-btn';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', () => {
      const text = codeEl?.innerText ?? pre.innerText;
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.textContent = 'Copied!';
        copyBtn.classList.add('copied');
        setTimeout(() => {
          copyBtn.textContent = 'Copy';
          copyBtn.classList.remove('copied');
        }, 1800);
      });
    });

    header.appendChild(langSpan);
    header.appendChild(copyBtn);
    pre.insertBefore(header, pre.firstChild);
  });
}

/* ── Message rendering ────────────────────────────────── */
function appendUserMessage(text) {
  welcomeEl?.remove();

  const row = document.createElement('div');
  row.className = 'message user';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;

  row.appendChild(bubble);
  messagesEl.appendChild(row);
  scrollToBottom(true);
}

const LOADING_QUIPS = [
  'please be patient, this is running on a mac mini',
  'asking a computer under a desk, one moment...',
  'the mac mini is doing its best',
  'warming up the hamster wheel...',
  'yes, this is actually running locally. no, the fan is fine',
  'mac mini: "i got this." (it does not got this)',
  'converting electricity into words, please hold',
  'the mac mini appreciates your patience',
];

function appendAssistantPlaceholder() {
  welcomeEl?.remove();

  const row = document.createElement('div');
  row.className = 'message assistant';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  const cursor = document.createElement('span');
  cursor.className = 'cursor';

  const quip = LOADING_QUIPS[Math.floor(Math.random() * LOADING_QUIPS.length)];
  const loading = document.createElement('span');
  loading.className = 'loading-quip';
  loading.textContent = quip;

  row.appendChild(bubble);
  row.appendChild(cursor);
  row.appendChild(loading);
  messagesEl.appendChild(row);
  scrollToBottom(true);

  return { bubble, cursor, row, loading };
}

/* ── Core send logic ──────────────────────────────────── */
async function sendMessage() {
  const text = inputEl.value.trim();
  if (!text || isGenerating) return;

  // update UI
  inputEl.value = '';
  autoResize(inputEl);
  setGenerating(true);

  // add to history + DOM
  messages.push({ role: 'user', content: text });
  appendUserMessage(text);

  const { bubble, cursor, row, loading } = appendAssistantPlaceholder();
  let accumulated = '';

  try {
    abortController = new AbortController();

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
      signal: abortController.signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();

        if (payload === '[DONE]') break;

        try {
          const data = JSON.parse(payload);
          if (data.error) throw new Error(data.error);
          if (data.content) {
            loading.remove();
            accumulated += data.content;
            bubble.innerHTML = renderMarkdown(accumulated);
            (bubble.lastElementChild || bubble).appendChild(cursor); // inline at end of last element
            scrollToBottom();
          }
        } catch (parseErr) {
          if (parseErr.message !== 'Unexpected end of JSON input') {
            throw parseErr;
          }
        }
      }
    }

    cursor.remove();
    addCopyButtons(bubble);
    scrollToBottom();

    if (accumulated) {
      messages.push({ role: 'assistant', content: accumulated });
      saveConvoPreview(text);
    }

  } catch (err) {
    cursor.remove();
    if (err.name === 'AbortError') {
      // user stopped — keep whatever was accumulated
      if (accumulated) {
        bubble.innerHTML = renderMarkdown(accumulated);
        addCopyButtons(bubble);
        messages.push({ role: 'assistant', content: accumulated });
        saveConvoPreview(text);
      } else {
        row.remove();
        // also remove the user message from history since there's no response
        messages.pop();
      }
    } else {
      bubble.innerHTML = `<span class="error-msg">Error: ${escapeHtml(err.message)}</span>`;
      messages.pop(); // remove the user msg from history so it can be retried
    }
  } finally {
    setGenerating(false);
    abortController = null;
    inputEl.focus();
  }
}

/* ── UI state helpers ─────────────────────────────────── */
function setGenerating(value) {
  isGenerating = value;
  sendBtn.style.display = value ? 'none' : 'flex';
  stopBtn.style.display = value ? 'flex' : 'none';
  inputEl.disabled = value;
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 200) + 'px';
}

function updateSendBtn() {
  sendBtn.disabled = inputEl.value.trim().length === 0 || isGenerating;
}

/* ── New chat ─────────────────────────────────────────── */
function newChat() {
  if (isGenerating) {
    abortController?.abort();
  }
  messages = [];
  messagesEl.innerHTML = '';

  // restore welcome screen
  const welcome = document.createElement('div');
  welcome.id = 'welcome';
  welcome.className = 'welcome';
  welcome.innerHTML = `
    <h1 class="welcome-title">Chris-GPT</h1>
    <p class="welcome-subtitle">How can I help you today?</p>
  `;
  messagesEl.appendChild(welcome);
  inputEl.focus();
}

/* ── Conversation list (in-memory, this session only) ─── */
const previews = [];

function saveConvoPreview(firstUserMsg) {
  if (previews.length === 0 || previews[0].messages !== messages) {
    const item = { label: firstUserMsg.slice(0, 40), messages };
    previews.unshift(item);
    renderConvoList();
  }
}

function renderConvoList() {
  convoList.innerHTML = '';
  previews.forEach((item, i) => {
    const btn = document.createElement('button');
    btn.className = 'convo-item' + (i === 0 ? ' active' : '');
    btn.textContent = item.label || 'Conversation';
    btn.title = item.label;
    convoList.appendChild(btn);
  });
}

/* ── Event listeners ──────────────────────────────────── */
inputEl.addEventListener('input', () => {
  autoResize(inputEl);
  updateSendBtn();
});

inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

sendBtn.addEventListener('click', sendMessage);

stopBtn.addEventListener('click', () => {
  abortController?.abort();
});

newChatBtn.addEventListener('click', newChat);

// initial state
updateSendBtn();
