import dns from 'node:dns/promises';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, 'data', 'archives');
const port = Number(process.env.PORT || 3001);
const maxRedirects = Number(process.env.MAX_REDIRECTS || 8);
const maxBodyBytes = 2_000_000;
const allowedOrigin = process.env.CORS_ORIGIN || '*';

await fs.mkdir(dataDir, { recursive: true });

const app = express();
app.use(cors({ origin: allowedOrigin }));
app.use(express.json({ limit: '32kb' }));

function isPrivateIp(address) {
  const normalized = address.toLowerCase();
  return normalized === '::1' || normalized === 'localhost' ||
    /^127\./.test(normalized) || /^10\./.test(normalized) ||
    /^192\.168\./.test(normalized) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized) ||
    /^169\.254\./.test(normalized) || normalized.startsWith('fc') || normalized.startsWith('fd') ||
    normalized.startsWith('fe80:');
}

async function assertSafeUrl(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { throw new Error('Некорректный URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Разрешены только публичные HTTP(S)-ссылки');
  }
  const records = await dns.lookup(url.hostname, { all: true });
  if (!records.length || records.some(({ address }) => isPrivateIp(address))) {
    throw new Error('Переход на локальные или внутренние адреса запрещён');
  }
  return url;
}

async function readLimitedBody(response) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBodyBytes) {
      await reader.cancel();
      throw new Error('Страница слишком большая для демо-архива');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function resolveUrl(sourceUrl) {
  let current = await assertSafeUrl(sourceUrl);
  const redirects = [];
  for (let i = 0; i <= maxRedirects; i += 1) {
    const response = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
      headers: { 'User-Agent': 'TikTok-Web-Archive/1.0 (public archive)' }
    });
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      const next = new URL(location, current);
      redirects.push({ from: current.toString(), to: next.toString(), status: response.status });
      current = await assertSafeUrl(next.toString());
      continue;
    }
    const html = response.ok && (response.headers.get('content-type') || '').includes('text/html')
      ? await readLimitedBody(response)
      : '';
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() || null;
    return { finalUrl: current.toString(), status: response.status, contentType: response.headers.get('content-type'), title, html, redirects };
  }
  throw new Error('Слишком много перенаправлений');
}

function id() { return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'tiktok-web-archive' }));

app.post('/api/archive', async (req, res) => {
  const sourceUrl = String(req.body?.url || '').trim();
  if (!sourceUrl) return res.status(400).json({ error: 'Передайте URL в поле url' });
  try {
    const result = await resolveUrl(sourceUrl);
    const record = { id: id(), sourceUrl, ...result, capturedAt: new Date().toISOString() };
    await fs.writeFile(path.join(dataDir, `${record.id}.json`), JSON.stringify(record, null, 2));
    res.status(201).json({ ...record, html: undefined, htmlSaved: Boolean(result.html) });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Не удалось сохранить страницу' });
  }
});

app.get('/api/archive', async (_req, res) => {
  const names = (await fs.readdir(dataDir)).filter((name) => name.endsWith('.json')).slice(-50).reverse();
  const records = await Promise.all(names.map(async (name) => {
    const record = JSON.parse(await fs.readFile(path.join(dataDir, name), 'utf8'));
    const { html, ...summary } = record;
    return { ...summary, htmlSaved: Boolean(html) };
  }));
  res.json(records);
});

app.listen(port, () => console.log(`Archive API listening on http://localhost:${port}`));
