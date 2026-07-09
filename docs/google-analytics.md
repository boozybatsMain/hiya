# Google Analytics — доступ через код

Лендинг hiya шлёт события в **Google Analytics 4**. К данным GA можно обращаться
**программно, без gcloud и без кликанья в UI** — через GA4 Data API и сервис-аккаунт.
Здесь — всё необходимое, чтобы следующий агент (или человек) сразу это делал кодом.

## Идентификаторы
| Что | Значение |
|-----|----------|
| Measurement ID (в `index.html`) | `G-ZBFLNG3JNW` |
| GA4 Property ID (для Data API) | `544629918` |
| GA Account ID | `182701328` |
| Google Cloud / Firebase project | `hiya-e8f5c` |

## Сервис-аккаунт (авторизация)
- Аккаунт: `hiya-analytics@hiya-e8f5c.iam.gserviceaccount.com`
- Ключ (JSON): `~/.config/hiya/hiya-sa.json` — **СЕКРЕТ, не коммитить.**
  Лежит **вне репозитория** (не в папке сайта!), права `600`. `.gitignore` дополнительно
  блокирует ключи сервис-аккаунтов на случай, если такой файл когда-нибудь попадёт в репо.
- Доступ настроен: аккаунт добавлен как пользователь GA4-ресурса (роль Viewer,
  GA Admin → *Управление доступом к ресурсу*) и в проекте включён **Google Analytics
  Data API**. Проверено рабочим кодом: 2026-07-09.
- Если ключ потерян — пересоздать: GCP Console → IAM → Service Accounts →
  `hiya-analytics` → Keys → Add key (JSON). Затем проверить, что аккаунт есть в
  GA *Property Access Management* (Viewer), а Data API включён.

## Как дёргать API
Скрипт [`scripts/ga_report.sh`](../scripts/ga_report.sh) делает всё сам: подписывает
JWT сервис-аккаунтом через `openssl`, меняет его на access-token, вызывает `runReport`.
Зависимости — только `curl`, `jq`, `openssl` (есть в системе). gcloud НЕ нужен.

```bash
# топ событий за 28 дней
bash scripts/ga_report.sh '{"dateRanges":[{"startDate":"28daysAgo","endDate":"today"}],
  "dimensions":[{"name":"eventName"}],"metrics":[{"name":"eventCount"}],
  "orderBys":[{"metric":{"metricName":"eventCount"},"desc":true}]}' | jq .

# разрез события по источнику/кампании/браузеру/устройству
bash scripts/ga_report.sh '{"dateRanges":[{"startDate":"28daysAgo","endDate":"today"}],
  "dimensions":[{"name":"eventName"},{"name":"sessionSourceMedium"},
  {"name":"sessionCampaignName"},{"name":"browser"},{"name":"deviceCategory"}],
  "metrics":[{"name":"eventCount"}],
  "dimensionFilter":{"filter":{"fieldName":"eventName",
  "stringFilter":{"value":"generate_lead"}}}}' | jq .
```

Переопределить ключ/ресурс: `GA_SA_KEY=/path/key.json GA_PROPERTY_ID=123 bash scripts/ga_report.sh '...'`

Полезные измерения: `eventName`, `sessionSourceMedium`, `sessionCampaignName`,
`firstUserSourceMedium`, `browser`, `deviceCategory`, `country`, `city`, `date`,
`landingPage`. Метрики: `eventCount`, `activeUsers`, `sessions`, `screenPageViews`,
`userEngagementDuration`. Полный список — в документации GA4 Data API (`runReport`).

## Кастомные события сайта
`open_signup`, `generate_lead` (param `method`: `google` | `early_access`),
`lead_error` (param `stage`: `ajax_reject` | `ajax_fail` — заявка ушла запасным
путём), `google_signin_start`, `google_signin_error` (param `code`), `modal_close`,
`scroll_start`, `scroll_depth` (`percent`), `section_view` (`section`),
`page_exit` (`engagement_seconds`, `max_scroll`, `last_section`),
`ui_click` (`label`, `area`), `app_like_demo`, `intro_dismiss`,
`view_how_it_works`, `inapp_browser`.
Плюс авто-события GA4 (enhanced measurement): `form_start`, `form_submit`, `scroll`, `session_start`, `first_visit`, `user_engagement`.

**В каждое событие** дополнительно подмешиваются параметры first-touch атрибуции
`ft_source`, `ft_campaign`, `ft_content` (см. `docs/tracking.md`) — по ним видно
исходную кампанию/креатив, даже когда сессия потеряла атрибуцию (in-app браузер).

Важно: `generate_lead` шлётся **после подтверждения** отправки FormSubmit'ом
(AJAX), а не fire-and-forget — число лидов в GA сходится с письмами.

## Ключевые события и custom dimensions (настроено в GA Admin)

- **Key events**: `generate_lead` (главная конверсия), `open_signup`
  (микроконверсия). Дефолтный `purchase` не используется — на сайте не срабатывает.
- **Custom dimensions** (event scope): `method`, `source`, `section`, `label`,
  `last_section`, `max_scroll`, `engagement_seconds`, `ft_source`, `ft_campaign`,
  `ft_content`. В Data API они доступны как `customEvent:<имя>`.

> Параметры без регистрации в custom dimensions в Data API недоступны — их видно
> лишь в DebugView / BigQuery-экспорте. Регистрировать заранее: задним числом
> данные в измерение не попадают.

## Смежные API того же сервис-аккаунта
- **GA Admin API** (`analyticsadmin.googleapis.com`) — читать/менять настройки ресурса,
  custom dimensions, data streams (нужен scope `analytics.edit` — поменять `SCOPE` в скрипте).
- Ключ тот же.
