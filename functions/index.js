// hiya backend (Cloud Functions v2).
// tg   — вебхук Telegram-бота @hiyawrld_bot (номер в очереди раннего доступа).
// lead — приём заявки с сайта (почта/Google), замена FormSubmit.
// Обе шлют владельцу уведомление о новой заявке (lib/common.js: OWNER_CHAT_ID).
// Секреты: TG_BOT_TOKEN, TG_WEBHOOK_SECRET (firebase functions:secrets:set).

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { handleUpdate } = require('./lib/handleUpdate');
const { handleLead } = require('./lib/handleLead');

const TG_BOT_TOKEN = defineSecret('TG_BOT_TOKEN');
const TG_WEBHOOK_SECRET = defineSecret('TG_WEBHOOK_SECRET');

admin.initializeApp(); // FIREBASE_CONFIG в рантайме содержит databaseURL

function deps() {
  return { fs: admin.firestore(), rtdb: admin.database(), now: () => Date.now() };
}

async function tgSend(msg) {
  if (!msg) return;
  try {
    const r = await fetch('https://api.telegram.org/bot' + TG_BOT_TOKEN.value() + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg),
    });
    if (!r.ok) console.error('sendMessage failed', r.status, await r.text());
  } catch (e) {
    console.error('sendMessage error', e);
  }
}

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
      const { reply, notify } = await handleUpdate(req.body, deps());
      await tgSend(reply);
      await tgSend(notify);
    } catch (e) {
      console.error('tg update failed', e);
    }
    // Всегда 200: иначе Telegram бесконечно ретраит проблемный update
    res.status(200).send('ok');
  }
);

// Клиент шлёт fetch(…, { body: JSON.stringify(payload) }) БЕЗ Content-Type —
// это «simple request», браузер не делает CORS-preflight (важно для вебвью).
const SITE_ORIGIN = 'https://boozybatsmain.github.io';

exports.lead = onRequest(
  {
    region: 'us-central1',
    secrets: [TG_BOT_TOKEN],
    maxInstances: 3,
    invoker: 'public',
  },
  async (req, res) => {
    res.set('Access-Control-Allow-Origin', SITE_ORIGIN);
    res.set('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Methods', 'POST');
      res.set('Access-Control-Allow-Headers', 'Content-Type');
      res.set('Access-Control-Max-Age', '3600');
      res.status(204).send('');
      return;
    }
    if (req.method !== 'POST') {
      res.status(200).send('hiya lead endpoint');
      return;
    }
    let data = req.body;
    if (!data || typeof data !== 'object' || Buffer.isBuffer(data)) {
      try { data = JSON.parse(String(req.rawBody || '{}')); } catch (e) { data = {}; }
    }
    try {
      const { body, notify } = await handleLead(data, deps());
      await tgSend(notify);
      res.status(200).json(body);
    } catch (e) {
      console.error('lead failed', e);
      res.status(200).json({ success: false, error: 'internal' });
    }
  }
);
