const form = document.querySelector('.search-form');
const input = document.querySelector('#search-input');
const empty = document.querySelector('#empty-state');
const examples = document.querySelectorAll('.example');
const archiveGrid = document.querySelector('#archive-grid');
const filterButton = document.querySelector('#filter-button');
const defaultCards = [...document.querySelectorAll('.archive-card')];

function ensureAbsoluteUrl(rawUrl) {
  const value = rawUrl.trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

function parseWaybackTimestamp(timestamp) {
  if (!timestamp || String(timestamp).length < 14) return null;
  const value = String(timestamp);
  const year = value.slice(0, 4);
  const month = value.slice(4, 6);
  const day = value.slice(6, 8);
  const hour = value.slice(8, 10);
  const minute = value.slice(10, 12);
  const second = value.slice(12, 14);
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

function renderArchiveResults(results, sourceUrl) {
  archiveGrid.innerHTML = '';
  if (!results.length) {
    empty.hidden = false;
    empty.textContent = 'Ничего не найдено. Попробуйте другой запрос.';
    return;
  }

  empty.hidden = true;

  results.forEach((snapshot) => {
    const card = document.createElement('article');
    card.className = 'archive-card';
    card.dataset.type = 'Архив';
    const type = snapshot.original?.includes('/video/') ? 'Видео' : 'Страница';
    const title = snapshot.original || sourceUrl;
    const date = snapshot.label || formatWaybackTimestamp(snapshot.timestamp);
    const preview = type === 'Видео' ? '▶' : '◉';

    card.innerHTML = `
      <div class="thumbnail thumb-one">
        <span>${preview}</span>
        <small>${date}</small>
      </div>
      <div class="archive-info">
        <div>
          <span class="tag ${type === 'Видео' ? 'vid' : 'profile'}">${type}</span>
          <h3>${title.replace(/^https?:\/\//i, '')}</h3>
        </div>
        <p>Снимок: ${date}</p>
        <a href="${snapshot.archiveUrl}" target="_blank" rel="noreferrer">Открыть в архиве ↗</a>
      </div>
    `;
    archiveGrid.appendChild(card);
  });
}

async function fetchWaybackSnapshots(url) {
  const target = ensureAbsoluteUrl(url);
  if (!target) return [];

  const cdxUrl = new URL('https://web.archive.org/cdx/search/cdx');
  cdxUrl.searchParams.set('url', target);
  cdxUrl.searchParams.set('output', 'json');
  cdxUrl.searchParams.set('fl', 'timestamp,original,statuscode,mimetype');
  cdxUrl.searchParams.set('filter', 'statuscode:200');
  cdxUrl.searchParams.set('limit', '10');

  const response = await fetch(cdxUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WebArchiveBot/1.0)' }
  });

  if (!response.ok) {
    throw new Error(`Wayback API вернул ${response.status}`);
  }

  const payload = await response.json();
  if (!Array.isArray(payload) || payload.length <= 1) {
    return [];
  }

  return payload.slice(1).filter((row) => Array.isArray(row) && row[0]).map((row) => {
    const [timestamp, original, statusCode, mimetype] = row;
    const safeOriginal = original || target;
    const label = formatWaybackTimestamp(timestamp);
    return {
      timestamp,
      original: safeOriginal,
      statusCode: Number(statusCode || 200),
      mimetype: mimetype || 'text/html',
      label,
      archiveUrl: `https://web.archive.org/web/${timestamp}/${safeOriginal}`
    };
  });
}

async function searchArchive(url) {
  const target = ensureAbsoluteUrl(url);
  if (!target) return [];

  try {
    const backendResponse = await fetch(`/api/search?url=${encodeURIComponent(target)}`);
    if (backendResponse.ok) {
      const data = await backendResponse.json();
      if (Array.isArray(data?.snapshots)) {
        return data.snapshots;
      }
      if (Array.isArray(data?.results)) {
        return data.results;
      }
    }
  } catch (error) {
    // Фоллбэк ниже: запускаем прямой поиск по Wayback.
  }

  return fetchWaybackSnapshots(target);
}

async function handleSearch(event) {
  event.preventDefault();
  const value = input.value.trim();
  if (!value) {
    empty.hidden = false;
    empty.textContent = 'Введите URL или домен для поиска в архивах.';
    return;
  }

  empty.hidden = false;
  empty.textContent = 'Ищем архивные копии…';

  try {
    const results = await searchArchive(value);
    renderArchiveResults(results, value);
    document.querySelector('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    empty.hidden = false;
    empty.textContent = 'Ничего не найдено. Попробуйте другой запрос.';
    renderArchiveResults([], value);
  }
}

function filterCards(query) {
  const value = query.trim().toLowerCase();
  let visible = 0;
  defaultCards.forEach((card) => {
    const matches = !value || card.textContent.toLowerCase().includes(value);
    card.hidden = !matches;
    if (matches) visible += 1;
  });
  empty.hidden = visible !== 0;
}

form.addEventListener('submit', handleSearch);
input.addEventListener('input', () => filterCards(input.value));
examples.forEach((example) => {
  example.addEventListener('click', () => {
    input.value = example.textContent;
    input.focus();
    filterCards(input.value);
  });
});

if (filterButton) {
  filterButton.addEventListener('click', () => {
    const showingProfiles = defaultCards.some((card) => !card.hidden && card.dataset.type === 'Профиль');
    defaultCards.forEach((card) => {
      card.hidden = showingProfiles ? card.dataset.type !== 'Видео' : false;
    });
    empty.hidden = true;
  });
}

renderArchiveResults([], '');
