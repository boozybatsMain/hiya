#!/usr/bin/env bash
# Однокнопочный деплой Telegram-бота (@hiyawrld_bot) после включения Blaze.
# Делает: секреты -> deploy функции tg -> setWebhook с secret_token -> проверка.
#
# Использование:
#   TG_BOT_TOKEN='123:ABC...' bash scripts/tg_deploy.sh
#
# Требует: firebase CLI (авторизованный), curl, jq, openssl. Токен НЕ хранится
# в репо — только в Firebase Secrets и у BotFather.
set -euo pipefail

: "${TG_BOT_TOKEN:?Передай токен: TG_BOT_TOKEN='...' bash scripts/tg_deploy.sh}"
PROJECT="${FIREBASE_PROJECT:-hiya-e8f5c}"
REGION="us-central1"
FUNC_URL="https://${REGION}-${PROJECT}.cloudfunctions.net/tg"

echo "== 1/5 Проверяю токен у Telegram =="
ME=$(curl -s "https://api.telegram.org/bot${TG_BOT_TOKEN}/getMe")
echo "$ME" | jq -e '.ok' >/dev/null || { echo "Токен невалиден: $ME"; exit 1; }
BOT_USER=$(echo "$ME" | jq -r '.result.username')
echo "   бот: @${BOT_USER}"

echo "== 2/5 Кладу секреты в Firebase Secret Manager =="
WEBHOOK_SECRET=$(openssl rand -hex 24)
printf '%s' "$TG_BOT_TOKEN"   | firebase functions:secrets:set TG_BOT_TOKEN      --project "$PROJECT" --force --data-file=-
printf '%s' "$WEBHOOK_SECRET" | firebase functions:secrets:set TG_WEBHOOK_SECRET --project "$PROJECT" --force --data-file=-

echo "== 3/5 Деплой функции tg =="
firebase deploy --only functions:tg --project "$PROJECT" --non-interactive --force

echo "== 4/5 Ставлю вебхук =="
curl -s "https://api.telegram.org/bot${TG_BOT_TOKEN}/setWebhook" \
  --data-urlencode "url=${FUNC_URL}" \
  --data-urlencode "secret_token=${WEBHOOK_SECRET}" \
  --data-urlencode 'allowed_updates=["message"]' \
  --data-urlencode "drop_pending_updates=true" | jq .

echo "== 5/5 Проверка =="
curl -s "https://api.telegram.org/bot${TG_BOT_TOKEN}/getWebhookInfo" | jq '{url: .result.url, pending: .result.pending_update_count, last_error: .result.last_error_message}'
echo "Готово. Напиши боту @${BOT_USER} /start — должен ответить номером в очереди."
