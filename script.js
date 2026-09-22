const form = document.querySelector('.search-form');
const input = document.querySelector('#search-input');
const cards = [...document.querySelectorAll('.archive-card')];
const empty = document.querySelector('#empty-state');
const examples = document.querySelectorAll('.example');
const filterButton = document.querySelector('#filter-button');

let activeType = null;

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/^@/, '')
    .replace(/\/+$/, '');
}

function cardSearchText(card) {
  return [
    card.textContent,
    card.dataset.username,
    card.dataset.url,
    card.dataset.title,
    card.dataset.type,
    card.getAttribute('data-search')
  ]
    .filter(Boolean)
    .map(normalize)
    .join(' ');
}

function filterCards(query = input.value) {
  const value = normalize(query);
  let visible = 0;

  cards.forEach((card) => {
    const matchesQuery = !value || cardSearchText(card).includes(value);
    const matchesType = !activeType || card.dataset.type === activeType;
    const isVisible = matchesQuery && matchesType;

    card.hidden = !isVisible;
    if (isVisible) visible += 1;
  });

  empty.hidden = visible !== 0;
}

function looksLikeTiktokUrl(raw) {
  const value = raw.trim();
  return /^(https?:\/\/)?(www\.)?(tiktok\.com|tiktok\.ru)\//i.test(value) ||
    /^(https?:\/\/)?(www\.)?(vm\.|m\.)?tiktok\.com\//i.test(value);
}

function buildWaybackUrl(value) {
  const encoded = encodeURIComponent(value.trim());
  return `https://web.archive.org/web/*/${encoded}`;
}

function searchArchive(query) {
  const value = query.trim();

  if (!value) {
    activeType = null;
    filterCards('');
    return;
  }

  const normalized = normalize(value);
  const localMatch = cards.some((card) => cardSearchText(card).includes(normalized));

  if (localMatch) {
    activeType = null;
    filterCards(value);
    document.querySelector('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  if (/^@?[a-z0-9._-]+$/i.test(value) || looksLikeTiktokUrl(value)) {
    const target = looksLikeTiktokUrl(value) ? value : `https://www.tiktok.com/@${value.replace(/^@/, '')}`;
    window.location.href = buildWaybackUrl(target);
    return;
  }

  window.location.href = buildWaybackUrl(value);
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  searchArchive(input.value);
});

input.addEventListener('input', () => {
  activeType = null;
  filterCards(input.value);
});

examples.forEach((example) => {
  example.addEventListener('click', () => {
    input.value = example.textContent.trim();
    input.focus();
    searchArchive(input.value);
  });
});

filterButton.addEventListener('click', () => {
  activeType = activeType === 'Видео' ? null : 'Видео';
  filterCards();
});

filterCards('');
