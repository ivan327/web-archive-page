const form = document.querySelector('.search-form');
const input = document.querySelector('#search-input');
const cards = [...document.querySelectorAll('.archive-card')];
const empty = document.querySelector('#empty-state');
const examples = document.querySelectorAll('.example');

function filterCards(query) {
  const value = query.trim().toLowerCase();
  let visible = 0;
  cards.forEach((card) => {
    const matches = !value || card.textContent.toLowerCase().includes(value);
    card.hidden = !matches;
    if (matches) visible += 1;
  });
  empty.hidden = visible !== 0;
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  filterCards(input.value);
  document.querySelector('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

input.addEventListener('input', () => filterCards(input.value));
examples.forEach((example) => {
  example.addEventListener('click', () => {
    input.value = example.textContent;
    input.focus();
    filterCards(input.value);
  });
});

document.querySelector('#filter-button').addEventListener('click', () => {
  const showingProfiles = cards.some((card) => !card.hidden && card.dataset.type === 'Профиль');
  cards.forEach((card) => {
    card.hidden = showingProfiles ? card.dataset.type !== 'Видео' : false;
  });
  empty.hidden = true;
});
