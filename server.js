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

function normalizeUrlForSearch(url) {
  const normalized = new URL(url);
  normalized.hash = '';
  if (!normalized.pathname || normalized.pathname === '/') {
    normalized.pathname = '/';
  }
  return normalized.toString();
}

function parseWaybackTimestamp(timestamp) {
  if (!timestamp || timestamp.length < 14) return null;

  const year = timestamp.slice(0, 4);
  const month = timestamp.slice(4, 6);
  const day = timestamp.slice(6, 8);
  const hour = timestamp.slice(8, 10);
  const minute = timestamp.slice(10, 12);
  const second = timestamp.slice(12, 14);

  const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatWaybackTimestamp(timestamp) {
  const date = parseWaybackTimestamp(timestamp);
  if (!date) return timestamp;
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC'
  }).format(date);
}

async function searchWayback(url) {
  const target = normalizeUrlForSearch(url);
  const cdxUrl = new URL('https://web.archive.org/cdx/search/cdx');
  cdxUrl.searchParams.set('url', target);
  cdxUrl.searchParams.set('output', 'json');
  cdxUrl.searchParams.set('fl', 'timestamp,original,statuscode,mimetype,sha1');
  cdxUrl.searchParams.set('filter', 'statuscode:200');
  cdxUrl.searchParams.set('limit', '10');

  const response = await fetch(cdxUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WebArchiveBot/1.0)' },
    signal: AbortSignal.timeout(20_000)
  });

  if (!response.ok) {
    throw new Error(`Wayback API вернул статус ${response.status}`);
  }

  const payload = await response.json();
  if (!Array.isArray(payload) || payload.length <= 1) {
    return [];
  }

  const rows = payload.slice(1);
  return rows
    .filter((row) => Array.isArray(row) && row[0])
    .map((row) => {
      const [timestamp, original, statuscode, mimetype, sha1] = row;
      const date = parseWaybackTimestamp(timestamp);
      return {
        timestamp,
        original: original || target,
        statusCode: Number(statuscode || 200),
        mimetype: mimetype || 'text/html',
        sha1: sha1 || null,
        date: date ? date.toISOString() : null,
        label: date ? formatWaybackTimestamp(timestamp) : timestamp,
        archiveUrl: `https://web.archive.org/web/${timestamp}/${original}`,
      };
    })
    .slice(0, 10);
}

function buildArchiveLinks(url) {
  const full = normalizeUrlForSearch(url);
  return {
    wayback: `https://web.archive.org/web/*/${full}`,
    memento: `https://memgator.appspot.com/timemap/json/${full}`,
    archiveToday: `https://archive.today/submit/?url=${encodeURIComponent(full)}`,
    googleCache: `https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(full)}`,
  };
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

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'web-archive-page' }));

app.get('/api/search', async (req, res) => {
  const rawUrl = String(req.query.url || '').trim();
  if (!rawUrl) {
    return res.status(400).json({ error: 'Передайте URL в параметре url' });
  }

  try {
    const url = await assertSafeUrl(rawUrl);
    const snapshots = await searchWayback(url);
    res.json({
      url: url.toString(),
      total: snapshots.length,
      snapshots,
      archiveLinks: buildArchiveLinks(url),
      source: 'wayback'
    });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Не удалось найти архивные копии' });
  }
});

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
