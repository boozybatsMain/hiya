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
Runtime поднят до Node 22 при деплое 12.07.2026.

## Профиль бота (уже настроено через Bot API 11.07.2026)

Имя «Хэйя», описание и short description на русском, команды `/start`
(занять место) и `/place` (мой номер). Меняются curl'ом:
`setMyDescription` / `setMyShortDescription` / `setMyCommands`.

## Реферальная ссылка (добавлена 12.07.2026, только аналитика)

К ответам бота (/start и /place) прикреплена inline-кнопка «👋 Пригласить
друзей»: открывает нативный шаринг Telegram (`t.me/share/url`) с готовым
текстом и персональной ссылкой `https://t.me/hiyawrld_bot?start=ref_<tg_user_id>`.

Учёт (награды пока нет):
- у приглашённого метка `ref_<id>` лежит в обычном `start_payload` лида;
- у реферера в `leads/tg:<id>` инкрементится `invited` (+`last_invite_at`) —
  только когда приглашённый НОВЫЙ (повторный /start по ссылке не считается),
  self-invite и выдуманные `ref_` игнорируются;
- в уведомлении владельцу строка «👥 Привёл: <имя> (@username) — приглашённых: N».

Кто приглашает: Firestore → `leads`, фильтр по полю `invited > 0`.

## Аналитика бота в GA4 (добавлена 12.07.2026)

У бота нет браузера — события шлёт сервер через **Measurement Protocol**
(`index.js: gaSend`, Measurement ID тот же, что у сайта). `handleUpdate`
возвращает чистый список `ga: [{ client_id, name, params }]` (тестируется без
сети), отправка — best effort, ошибки не роняют вебхук.

События (все с `method: telegram`):
- `generate_lead` — новый лид из бота, то же ключевое событие, что у сайта;
- `tg_start_repeat` — повторный /start;
- `tg_invite` — приглашение засчитано (событие идёт **рефереру**, его client_id);
- `tg_place_check` — /place (`via: known|unknown`).

Метка диплинка разворачивается обратно в `ft_source`/`ft_content`
(`common.js: ftFromPayload`; `ref_<id>` → `ft_source=referral`), так что лиды
бота склеиваются с кампаниями в одном отчёте с сайтом. Client_id — `<tg_id>.1`.

Секрет MP: GA Admin → Data Streams → «Hiya» → Measurement Protocol API secrets →
`tg-bot` (создан Admin API; для этого на ресурсе подтверждён User Data Collection
Acknowledgement 12.07.2026). Значение — в Firebase Secret Manager
(`GA_API_SECRET`) и локально `~/.config/hiya/ga-mp-secret.txt` (вне репо).
Известная особенность: MP-события НЕ видны в Realtime-отчёте, в обычные отчёты
приходят с задержкой до пары часов. Валидация формата —
`https://www.google-analytics.com/debug/mp/collect` (тот же URL с `/debug`).

## /lead — приём заявок с сайта (добавлен 11.07.2026)

`POST https://us-central1-hiya-e8f5c.cloudfunctions.net/lead` (JSON) — замена
FormSubmit. Firestore `leads/em:<sha256(email)>` (дедуп: повторная отправка
того же адреса возвращает прежний номер и НЕ двигает счётчик), номер — из
общего счётчика RTDB, аватарка-инициалы, ответ `{success, place}`.
Поле `test: true` — прогон без записи (только уведомление, помечено 🧪).

**Уведомления владельцу**: каждая заявка (Telegram-бот И сайт) шлёт сообщение
в чат `406663035` (@oddbear, `OWNER_CHAT_ID` в `lib/common.js`): номер, канал
(Telegram/Google/почта), контакт, источник ft, всего в списке. Повторные
заявки помечаются 🔁 и счётчик не трогают.

**RTDB закрыта на запись** (`database.rules.json` в репо, деплой
`firebase deploy --only database`): читать можно `waitlist/signups` и
`waitlist/recent`, писать — никому (Function/бот идут через Admin SDK).
Гриф-дыра счётчика из аудита закрыта.

## Что дальше (тот же монолит)

- CAPI: серверный Lead с существующим `event_id` — по триггерам из
  [`ads-rebuild-todo.md`](ads-rebuild-todo.md)/аудита (после запуска).
- Рассылка запуска: один скрипт по `leads/*` (`platform: telegram` — через
  бота; `platform: site` — по почте).
