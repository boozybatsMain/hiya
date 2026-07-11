# Telegram-бот раннего доступа — @hiyawrld_bot

Бот выдаёт номер в очереди раннего доступа («Ты №161 из 300 — премиум навсегда»)
и является каналом активации: в день запуска шлём приглашение всем подписчикам.
Кнопка на сайте ведёт в бота диплинком — для Instagram-webview это ещё и побег
в нативное приложение Telegram без набора почты.

## Архитектура (монолит в этом репо)

- `functions/index.js` — Cloud Function v2 `tg` (us-central1, рядом с RTDB):
  вебхук Telegram. Секреты `TG_BOT_TOKEN`, `TG_WEBHOOK_SECRET` из Firebase
  Secret Manager, в репо их НЕТ.
- `functions/lib/handleUpdate.js` — ядро без привязки к Functions (тестируется
  обычным node: `cd functions && npm test`).
- Данные:
  - Firestore `leads/tg:<user_id>` — лид: username, имя, `start_payload`
    (метка из диплинка, ≤64 симв.), `place`, таймстемпы. Дедуп по user id —
    один человек = один номер навсегда.
  - RTDB `waitlist/signups` — ЕДИНЫЙ счётчик с сайтом (сайт показывает
    `151 + signups`); номер выдаёт транзакция `+1` — накрутить нельзя,
    источник номера только сервер.
  - RTDB `waitlist/recent` — инициалы для ленты аватарок на сайте (бот пушит
    инициалы из имени).

## Безопасность

- Токен бота — только в Secret Manager (`firebase functions:secrets:set`).
  Токен светился в чате при настройке 11.07.2026 — **после первого рабочего
  деплоя перевыпустить** в @BotFather (`/revoke`) и перезапустить
  `scripts/tg_deploy.sh` с новым.
- Вебхук ставится с `secret_token`; функция сверяет заголовок
  `X-Telegram-Bot-Api-Secret-Token` и отвечает 401 чужим POST'ам.
- Функция всегда отвечает Telegram'у 200 (иначе бесконечные ретраи), ошибки — в
  логи (`firebase functions:log`).
- `maxInstances: 3` — потолок от неожиданных всплесков/флуда.

## Деплой (после включения Blaze)

Blaze обязателен для Cloud Functions. Биллинг-аккаунта в Google Cloud пока нет —
создать может только владелец (нужна карта): Firebase Console → Usage and
billing → Modify plan → Blaze → Create a Cloud Billing account. Сразу после —
поставить бюджет-алерт ($5) там же.

Затем одна команда:

```bash
TG_BOT_TOKEN='<токен из @BotFather>' bash scripts/tg_deploy.sh
```

Скрипт: проверит токен → положит секреты → задеплоит `tg` → поставит вебхук
с секретом → покажет `getWebhookInfo`. Проверка: написать боту `/start`.

## Кнопка на сайте (добавлена 11.07.2026, вебхук живой)

Две кнопки `.btn-tg` в `index.html`: в модалке («Или займи место через
Telegram») и на экране «Ты в списке» («Продублировать в Telegram»).
Диплинк `https://t.me/hiyawrld_bot?start=<метка>`, метка из first-touch:
`<source>__<content>` (только `[A-Za-z0-9_-]`, ≤64, фолбэк `site`) — бот
кладёт её в `start_payload` лида. События: GA `tg_click {area: modal|ok}`
(param `area` зарегистрирован) + Clarity-тег `tg=click`.

## Статус деплоя (11.07.2026)

Функция задеплоена: `https://us-central1-hiya-e8f5c.cloudfunctions.net/tg`,
вебхук стоит с secret_token (посторонний POST → 401), политика очистки
образов — 3 дня. Blaze включён (биллинг-аккаунт «Firebase Payment»),
бюджет-алерт $5. Firestore `(default)` создан в us-central1, production-rules.
Runtime Node 20 (deprecated, до 2026-10-30 работает — поднять engines до 22
при следующем деплое).

## Профиль бота (уже настроено через Bot API 11.07.2026)

Имя «Хэйя», описание и short description на русском, команды `/start`
(занять место) и `/place` (мой номер). Меняются curl'ом:
`setMyDescription` / `setMyShortDescription` / `setMyCommands`.

## Что дальше (тот же монолит)

- `POST /lead` — серверный приём почтовой заявки (план из
  [`meta-pixel.md`](meta-pixel.md)): Firestore + перенос счётчика на сервер +
  пересылка в FormSubmit + CAPI с существующим `event_id`. После этого RTDB
  закрывается на запись (`.write: false`) — уходит гриф-дыра счётчика.
- Рассылка запуска: один скрипт по `leads/*` с `platform: telegram`.
