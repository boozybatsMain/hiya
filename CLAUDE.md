# hiya — правила для агента

## Доступ к рекламным кабинетам

Агенту разрешено самостоятельно заходить (через браузер / Chrome extension) в:
- **Facebook Ads** (Meta Ads Manager, business.facebook.com / adsmanager.facebook.com)
- **Google Ads** (ads.google.com)

Разрешено без отдельного вопроса: открывать кабинеты, смотреть кампании, статистику
и биллинг-отчёты, готовить черновики кампаний/объявлений, собирать аналитику.

Перед действиями, которые тратят деньги или публикуют наружу — запуск/остановка
кампании, изменение бюджета или ставок, публикация объявления, изменение платёжных
данных — сначала показать, что именно будет сделано, и получить подтверждение в чате.

Идентификаторы Meta: бизнес-портфолио «Hiya App» `1333129068437415`, рекламный
аккаунт `1365306939076203`, датасет/пиксель «hiya» `2523353561436955`. Подробности
про пиксель и известные грабли кабинета — в [`docs/meta-pixel.md`](docs/meta-pixel.md).
Карта клиентского трекинга (GA + Clarity + Pixel, UTM-персист, флоу лида) —
в [`docs/tracking.md`](docs/tracking.md).

## Firebase

Проект: `hiya-e8f5c` (console.firebase.google.com). Агенту разрешено заходить в
консоль Firebase и менять настройки проекта (Auth-провайдеры, домены, правила RTDB)
по задаче. Google-провайдер в Authentication включён (support email
camafobia@gmail.com), домен `boozybatsmain.github.io` добавлен в Authorized domains.

## Google Analytics — доступ через код

К данным GA4 можно обращаться **кодом**, не только через UI. Сервис-аккаунт
`hiya-analytics@hiya-e8f5c.iam.gserviceaccount.com`; ключ — `~/.config/hiya/hiya-sa.json`
(**секрет**, лежит ВНЕ репозитория/папки сайта, права 600). Готовый скрипт без gcloud:
`scripts/ga_report.sh` (сервис-аккаунт → JWT → token → GA4 Data API на curl+openssl).
Property ID `544629918`. Полная инструкция, идентификаторы и примеры запросов —
в [`docs/google-analytics.md`](docs/google-analytics.md).
