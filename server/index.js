const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = Number(process.env.PORT || 4000);

app.use(cors());
app.use(express.json({ limit: '50mb' }));

async function callAnthropic(body) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured on the server.');
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error?.message || `Anthropic request failed (${response.status})`);
  }

  return data;
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, message: 'proxy is running' });
});

app.post('/api/compare', async (req, res) => {
  try {
    const data = await callAnthropic(req.body);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Proxy compare failed' });
  }
});

app.post('/api/page', async (req, res) => {
  try {
    const data = await callAnthropic(req.body);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Proxy page analysis failed' });
  }
});

app.post('/api/draft', async (req, res) => {
  try {
    const data = await callAnthropic(req.body);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Proxy draft failed' });
  }
});

app.listen(port, () => {
  console.log(`Tasking API proxy listening on http://localhost:${port}`);
});
