// api/summary-gemini.js
// Minimal Express API that returns a 3–5 sentence, spoiler-safe summary via Gemini 1.5 Flash.
// Requires: GEMINI_API_KEY in .env

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAI } from '@google/generative-ai';

const PORT = process.env.PORT || 8787;
const API_KEY = process.env.GEMINI_API_KEY;

// ---- Guard ----
if (!API_KEY || API_KEY.trim() === '') {
  console.error('❌ Missing GEMINI_API_KEY in .env');
  process.exit(1);
}

// ---- App ----
const app = express();

// CORS: allow your frontend to POST JSON
app.use(
  cors({
    origin: true,               // allow same-origin + dev tools
    methods: ['POST', 'GET', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  })
);

app.use(express.json({ limit: '1mb' }));

// Simple in-memory cache to save tokens
const cache = new Map();
const keyFor = (title, authors) =>
  `${(title || '').toLowerCase().trim()}||${(authors?.[0] || '').toLowerCase().trim()}`;

// Health page + instructions
app.get('/', (_req, res) => {
  res
    .type('html')
    .send(`<!doctype html>
<html><head><meta charset="utf-8"><title>Gemini Summary API</title></head>
<body style="font-family:system-ui,sans-serif">
  <h1>Gemini Summary API</h1>
  <p>POST <code>/summary</code> with JSON: { "title": "...", "authors": ["..."], "descriptionHint": "..." }</p>
  <pre>curl -X POST 'http://localhost:${PORT}/summary' \\
  -H 'Content-Type: application/json' \\
  -d '{"title":"The Sparrow","authors":["Mary Doria Russell"],"descriptionHint":""}'</pre>
</body></html>`);
});

// 405 for GET /summary so browsers don’t confuse it
app.get('/summary', (_req, res) => {
  res.status(405).json({ error: 'Use POST /summary' });
});

// CORS preflight for POST
app.options('/summary', (_req, res) => {
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(204);
});

// ---- The route you’re calling ----
app.post('/summary', async (req, res) => {
  try {
    const { title, authors = [], descriptionHint = '' } = req.body || {};
    if (!title || typeof title !== 'string') {
      return res.status(400).json({ error: 'Missing title' });
    }

    // Cache check
    const ck = keyFor(title, authors);
    if (cache.has(ck)) {
      console.log(`↩︎ cache hit: ${ck}`);
      return res.json({ summary: cache.get(ck), cached: true });
    }

    const genAI = new GoogleGenerativeAI(API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const authorLine = authors.length > 0 ? ` by ${authors.join(', ')}` : '';
    const hint =
      descriptionHint
        ? `\nContext (may be messy/long, trim as needed): ${String(descriptionHint).slice(0, 600)}`
        : '';

    const prompt =
`Summarize the book "${title}"${authorLine} in 3–5 sentences.
Constraints:
- Neutral tone, spoiler-safe.
- Focus on premise, stakes, and setting; avoid major twists.
- Keep it concise (max ~120 words).${hint}`;

    console.log(`→ generating: ${ck}`);
    const result = await model.generateContent([{ text: prompt }]);
    let summary = result?.response?.text?.();
    summary = typeof summary === 'function' ? result.response.text() : summary;
    summary = (summary || '').trim();

    if (!summary) {
      return res.status(502).json({ error: 'Model returned no summary' });
    }

    cache.set(ck, summary);
    res.json({ summary, cached: false });
  } catch (err) {
    console.error('✖︎ /summary error:', err?.message || err);
    res.status(500).json({ error: 'Failed to generate summary' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Gemini summary API listening on http://localhost:${PORT}`);
});