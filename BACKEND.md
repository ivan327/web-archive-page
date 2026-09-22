# Backend TikTok Web Archive

Backend на Node.js для демонстрационного архива публичных страниц.

## Запуск локально

Требуется Node.js 20 или новее.

```bash
npm install
cp .env.example .env
npm start
```

API будет доступен на `http://localhost:3001`.

## API

### Проверка состояния

`GET /api/health`

### Сохранить страницу

```bash
curl -X POST http://localhost:3001/api/archive \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}'
```

Сервис вручную проходит HTTP-перенаправления, в том числе ссылки-посредники Google, проверяет адрес каждого перехода и сохраняет JSON-снимок в `data/archives/`.

### Получить последние записи

`GET /api/archive`

## Важно

Это минимальный backend для публичных страниц, а не загрузчик видео. Он ограничивает размер HTML, число редиректов и блокирует локальные/внутренние IP-адреса. Перед публикацией необходимо настроить `CORS_ORIGIN`, добавить аутентификацию, rate limit, постоянное хранилище и соблюдать условия использования TikTok/Google, авторские права и robots.txt.
