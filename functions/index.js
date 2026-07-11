// hiya backend (Cloud Functions v2).
// tg — вебхук Telegram-бота @hiyawrld_bot: выдаёт номер в очереди раннего
// доступа. Секреты: TG_BOT_TOKEN, TG_WEBHOOK_SECRET (firebase functions:secrets:set).
// Вебхук ставится скриптом scripts/tg_deploy.sh (setWebhook с secret_token).

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { handleUpdate } = require('./lib/handleUpdate');

const TG_BOT_TOKEN = defineSecret('TG_BOT_TOKEN');
const TG_WEBHOOK_SECRET = defineSecret('TG_WEBHOOK_SECRET');

admin.initializeApp(); // FIREBASE_CONFIG в рантайме содержит databaseURL

exports.tg = onRequest(
  {
    region: 'us-central1', // рядом с RTDB (hiya-e8f5c-default-rtdb — us-central)
    secrets: [TG_BOT_TOKEN, TG_WEBHOOK_SECRET],
    maxInstances: 3,
    invoker: 'public',
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(200).send('hiya tg webhook');
      return;
    }
    // Отсекаем всё, что пришло не от Telegram (сверка секрета из setWebhook)
    if (req.get('x-telegram-bot-api-secret-token') !== TG_WEBHOOK_SECRET.value()) {
      res.status(401).send('unauthorized');
      return;
    }
    try {
      const reply = await handleUpdate(req.body, {
        fs: admin.firestore(),
        rtdb: admin.database(),
        now: () => Date.now(),
      });
      if (reply) {
        const r = await fetch('https://api.telegram.org/bot' + TG_BOT_TOKEN.value() + '/sendMessage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reply),
        });
        if (!r.ok) console.error('sendMessage failed', r.status, await r.text());
      }
    } catch (e) {
      console.error('tg update failed', e);
    }
    // Всегда 200: иначе Telegram бесконечно ретраит проблемный update
    res.status(200).send('ok');
  }
);
