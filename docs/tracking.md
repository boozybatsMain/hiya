# Трекинг на сайте — как устроена инструментация

Карта всей клиентской аналитики `index.html`: какие системы подключены, как они
гейтятся, что и куда шлётся, как устроена атрибуция лида. Идентификаторы и доступ
к данным — в соседних доках: [`google-analytics.md`](google-analytics.md),
[`meta-pixel.md`](meta-pixel.md).

## Три системы + гейтинг

| Система | Зачем | Подключение |
|---|---|---|
| **Google Analytics 4** | события, воронка, источники | `window.GA_ID`, грузится сразу (async) |
| **Microsoft Clarity** | записи сессий, теплокарты | project `xjnrzbddvw`, грузится сразу (async) |
| **Meta Pixel** | атрибуция/оптимизация рекламы, аудитории | `window.FB_PIXEL_ID`, грузится сразу при заполненном ID |

Все три подчиняются **одному флагу `live`**: не работают на localhost и у
посетителей с самоисключением `?mytraffic=off` (localStorage `hiya_no_ga`).
Свой трафик не попадает ни в GA, ни в Clarity, ни в пиксель.

Лениво (по idle, ~1.5 c) грузится только **Google Sign-In** (GSI) — он тяжёлый,
нужен лишь у модалки и не грузится вовсе в in-app браузерах Instagram/Facebook
(там Google OAuth запрещён политикой Google, кнопка скрыта).

> История: до 10.07.2026 gtag и Clarity тоже грузились лениво (idle 800 мс или
> первое касание) — из-за этого терялись короткие визиты (~16% сессий без
> атрибуции) и расходились счётчики систем. Не возвращать ленивую загрузку.

## First-touch атрибуция (UTM-персист)

При первом заходе UTM-метки и `fbclid` сохраняются в localStorage `hiya_ft`:
`{source, medium, campaign, content, term, fbclid, ref, lp, ts}`.

- **Не перезаписывается** при повторных заходах (first-touch)…
- …**кроме апгрейда**: если сохранён `(direct)`, а новый заход пришёл с
  UTM/fbclid — рекламный источник затирает «пустой».
- Доступ из кода: `window.hiyaFT()`.

Куда прокидывается first-touch:
1. **В каждое GA-событие** — параметры `ft_source`, `ft_campaign`, `ft_content`
   (подмешивает обёртка `window.track`; зарегистрированы как custom dimensions).
2. **В Clarity** — теги `ft_source` / `ft_campaign` / `ft_content`
   (`clarity('set', …)`) — фильтруют записи сессий по кампании/креативу.
3. **В письмо с лидом** — скрытые поля FormSubmit (см. ниже): каждый лид
   приходит с источником, кампанией и креативом.

## Обёртки (безопасные, молчат при `live=false`)

- `track(name, params)` — GA-событие + автоматически ft_*.
- `fbevent(type, name, params, eventId)` — Meta Pixel
  (`fbevent('track','Lead',{...}, id)` / `fbevent('trackCustom','OpenSignup',{...})`).
- `ctag(key, value)` — Clarity custom tag.

## Флоу лида (sendLead)

1. Пользователь отправляет email (или входит через Google) → `sendLead(email, method)`.
2. Заявка уходит **`fetch`-ем в FormSubmit AJAX API** (`formsubmit.co/ajax/<endpoint>`,
   `keepalive: true` — переживает закрытие вкладки) со всеми полями:
   `email`, `method`, `ft_*`, `fbclid`, `referrer`, `landing`, `event_id`.
3. **Только после подтверждения** сервером (`success: true`) шлются события:
   `generate_lead` (GA), `Lead` (Pixel, с `eventID`), `lead=yes` (Clarity).
4. При ошибке AJAX — запасной путь через скрытую форму в iframe (как раньше)
   + GA-событие `lead_error` (`stage: ajax_reject | ajax_fail`).
5. UI не ждёт сеть: счётчик, аватарка и экран «Ты в списке» — сразу.

`event_id` (вида `lead_<ts>_<rand>`) уходит и в пиксель, и в письмо — это ключ
дедупликации для будущего серверного Conversions API (Firebase Function).

## События модалки

- `open_signup {source}` (GA) + `OpenSignup {source}` (Pixel) +
  тег `modal=opened` (Clarity) — при каждом открытии модалки.
- В Clarity сегмент **«открыл модалку, но не оставил заявку»** = записи с тегом
  `modal=opened` без тега `lead` — самые ценные для UX-разбора.

## Поле почты — наблюдение без PII

Слепая зона между `open_signup` и `generate_lead` закрыта событиями (сам адрес
НИКУДА не отправляется — только длина, валидность и домен после «@»):

- `email_focus` — первый тап в поле (Clarity-тег `email=focused`);
- `email_typed` — первый введённый символ (`email=typed`);
- `lead_invalid_email {length, domain}` — нажал «Отправить», адрес не прошёл
  валидацию;
- `email_abandon {via: modal_close|page_exit, length, valid, domain}` — ввёл
  что-то, но заявка не ушла: модалка закрыта любым путём или страница умерла
  (`email=abandoned`). Один раз за загрузку; после успешной отправки не шлётся.

В Clarity сегмент «начал вводить почту и бросил» = тег `email=abandoned`.

## Telegram-канал заявки

Кнопки в модалке и на экране успеха ведут в бота `@hiyawrld_bot`
(диплинк с first-touch меткой, см. [`telegram-bot.md`](telegram-bot.md)).
События: `tg_click {area: modal|ok}` (GA) + тег `tg=click` (Clarity).
Лиды из бота НЕ проходят через FormSubmit — они в Firestore `leads/tg:*`,
но двигают тот же счётчик RTDB, что видит сайт.

## Где смотреть

- GA-события/воронка — кодом через `scripts/ga_report.sh` (см. `google-analytics.md`).
- Записи и теплокарты — Clarity UI (проект hiya).
- События пикселя — Events Manager → Наборы данных → hiya (см. `meta-pixel.md`).
- Лиды «источник истины» — письма FormSubmit (в каждом теперь полная атрибуция).
