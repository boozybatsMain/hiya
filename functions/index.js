// hiya backend (Cloud Functions v2).
// tg   — вебхук Telegram-бота @hiyawrld_bot (номер в очереди раннего доступа).
// lead — приём заявки с сайта (почта/Google), замена FormSubmit; также приём
//        handoff-кодов для бот-лидов и админ-ветка бэкфилла (см. ниже).
// Обе шлют владельцу уведомление о новой заявке (lib/common.js: OWNER_CHAT_ID)
// и Lead в Meta Conversions API (lib/capi.js) — пиксель в одиночку терял
// конверсии: бот живёт вне браузера, а вебвью умирает раньше ответа сервера.
// Секреты: TG_BOT_TOKEN, TG_WEBHOOK_SECRET, GA_API_SECRET, META_CAPI_TOKEN
// (firebase functions:secrets:set).

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { handleUpdate } = require('./lib/handleUpdate');
const { handleLead } = require('./lib/handleLead');
const { capiSend, leadEvent, fbcFromClid, sha256 } = require('./lib/capi');

const TG_BOT_TOKEN = defineSecret('TG_BOT_TOKEN');
const TG_WEBHOOK_SECRET = defineSecret('TG_WEBHOOK_SECRET');
const GA_API_SECRET = defineSecret('GA_API_SECRET'); // Measurement Protocol «tg-bot» (GA Admin → Data Streams)
const META_CAPI_TOKEN = defineSecret('META_CAPI_TOKEN'); // Events Manager → Настройки → Conversions API

function capiToken() {
  let t = '';
  // trim: см. gaSend — хвостовой \n в секрете молча ломает запросы
  try { t = META_CAPI_TOKEN.value().trim(); } catch (e) { /* секрет не подключён — capiSend молча пропустит */ }
  return t;
}

// Реальный IP посетителя. Google Front End ДОПИСЫВАЕТ его ПОСЛЕДНИМ в
// X-Forwarded-For, сохраняя присланные клиентом элементы в начале — первый
// элемент подделывается обычным curl -H, доверять можно только последнему.
function clientIp(req) {
  const parts = String(req.get('x-forwarded-for') || '').split(',')
    .map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : (req.ip || '');
}

admin.initializeApp(); // FIREBASE_CONFIG в рантайме содержит databaseURL

function deps() {
  return { fs: admin.firestore(), rtdb: admin.database(), now: () => Date.now() };
}

// События бота в GA4 через Measurement Protocol: у бота нет браузера, а без
// этого воронка обрывалась на tg_click с сайта. handleUpdate возвращает чистый
// список { client_id, name, params } — сеть только здесь. engagement_time_msec
// обязателен, иначе GA не считает пользователя активным и прячет событие из
// отчётов. Ошибки не роняют вебхук: аналитика — best effort.
const { GA_MEASUREMENT_ID } = require('./lib/common');

async function gaSend(events) {
  if (!events || !events.length) return;
  let secret = '';
  // trim ОБЯЗАТЕЛЕН: 12–18.07.2026 секрет лежал в Secret Manager с хвостовым \n
  // (залит через cat) — api_secret получал %0A, GA отвечала 204 и МОЛЧА
  // выбрасывала все события бота. 204 ≠ доставлено: неверный api_secret не
  // отличим от успеха ни по ответу, ни по /debug/mp/collect (он секрет не
  // проверяет). Быстрая проверка доставки — Realtime (см. docs/google-analytics.md).
  try { secret = GA_API_SECRET.value().trim(); } catch (e) { /* секрет не подключён — молча пропускаем */ }
  if (!secret) return;
  await Promise.all(events.map(async (ev) => {
    try {
      const r = await fetch('https://www.google-analytics.com/mp/collect?measurement_id=' +
        GA_MEASUREMENT_ID + '&api_secret=' + encodeURIComponent(secret), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: ev.client_id,
          events: [{ name: ev.name, params: Object.assign({ engagement_time_msec: 1 }, ev.params) }]
        })
      });
      console.log('ga mp', ev.name, r.status); // след в логах: отправка была (объёмы — единицы в день)
    } catch (e) {
      console.error('ga mp error', e); // сюда попадает только сетевой сбой
    }
  }));
}

async function tgSend(msg) {
  if (!msg) return;
  try {
    // Таймаут: уведомление не должно задерживать ответ клиенту — раньше
    // подвисший api.telegram.org растягивал окно, в котором вебвью умирал
    // до подтверждения заявки.
    const r = await fetch('https://api.telegram.org/bot' + TG_BOT_TOKEN.value() + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg),
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) console.error('sendMessage failed', r.status, await r.text());
  } catch (e) {
    console.error('sendMessage error', e);
  }
}

exports.tg = onRequest(
  {
    region: 'us-central1', // рядом с RTDB (hiya-e8f5c-default-rtdb — us-central)
    secrets: [TG_BOT_TOKEN, TG_WEBHOOK_SECRET, GA_API_SECRET, META_CAPI_TOKEN],
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
      const { reply, notify, ga, capi, capiDoc } = await handleUpdate(req.body, deps());
      await tgSend(reply);
      const results = await Promise.all([
        tgSend(notify),
        gaSend(ga),
        capiSend(capi, capiToken()), // Lead нового бот-лида (handoff с сайта)
      ]);
      // Отметка «Lead доехал до Meta»: гейтит ретраи повторного /start
      // (handleUpdate) и защищает от двойной отправки бэкфиллом.
      if (results[2] && capiDoc) {
        await admin.firestore().collection('leads').doc(capiDoc)
          .set({ capi_sent_at: Date.now() }, { merge: true }).catch(() => {});
      }
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

// Handoff браузерных идентификаторов для бот-лида: tgGo (сайт) кладёт сюда
// fbclid/_fbc/_fbp + ip/ua ДО ухода в Telegram, диплинк несёт только короткий
// код. Бот при /start забирает документ (lib/handleUpdate.js) и сервер шлёт
// Lead в CAPI с этими ключами — иначе бот-лид не атрибуцируется.
// area='ok' — клик с экрана успеха ПОСЛЕ email-заявки: бот по нему Lead не
// шлёт (человек уже отрепорчен), но документ пишем — для склейки в Firestore.
async function saveHandoff(req, data) {
  const fs = admin.firestore();
  const doc = {
    created_at: Date.now(),
    area: String(data.area || '').slice(0, 20),
    fbclid: String(data.fbclid || '').slice(0, 500),
    fbc: String(data.fbc || '').slice(0, 500),
    fbp: String(data.fbp || '').slice(0, 100),
    ft_source: String(data.ft_source || '').slice(0, 100),
    ft_content: String(data.ft_content || '').slice(0, 200),
    landing: String(data.landing || '').slice(0, 500),
    referrer: String(data.referrer || '').slice(0, 500),
    ip: clientIp(req),
    ua: String(req.get('user-agent') || '').slice(0, 500),
  };
  await fs.collection('handoffs').doc(String(data.handoff)).set(doc);
  // Уборка: эндпоинт неаутентифицирован, а непотреблённые коды (клик по кнопке
  // без /start в боте) иначе копились бы вечно. Сутки — с запасом больше жизни
  // любого честного кода.
  try {
    const old = await fs.collection('handoffs')
      .where('created_at', '<', Date.now() - 24 * 3600 * 1000)
      .limit(25).get();
    await Promise.all(old.docs.map((d) => d.ref.delete()));
  } catch (e) { /* уборка — best effort */ }
}

// Временная админ-ветка (гейт — TG_WEBHOOK_SECRET): инвентаризация свежих
// лидов и разовый бэкфилл Lead-событий в CAPI (Meta принимает event_time до
// 7 дней назад). Нужна, пока есть лиды, пришедшие ДО подключения CAPI.
// Бэкфилл требует явный ids: «отправить всё окно» одним вызовом нельзя —
// дедупликация Meta по event_id живёт ~48 часов, и повторная отправка уже
// доехавших событий старше этого окна засчиталась бы вторым Lead'ом.
async function handleAdmin(data, res) {
  const since = Number(data.since || (Date.now() - 6 * 24 * 3600 * 1000));
  const fs = admin.firestore();
  const snap = await fs.collection('leads').where('created_at', '>=', since).get();
  if (data.action === 'list') {
    const rows = snap.docs.map((d) => {
      const v = d.data();
      return {
        id: d.id, platform: v.platform, place: v.place, created_at: v.created_at,
        method: v.method || '', ft_source: v.ft_source || '', ft_content: v.ft_content || '',
        label: v.start_payload || '', username: v.username || '', first_name: v.first_name || '',
        email_domain: v.email ? String(v.email).split('@')[1] : '',
        has_fbclid: !!v.fbclid, has_event_id: !!v.event_id, landing: v.landing || '',
        capi_sent_at: v.capi_sent_at || null
      };
    });
    res.status(200).json({ success: true, leads: rows });
    return;
  }
  if (data.action === 'backfill') {
    if (!Array.isArray(data.ids) || !data.ids.length) {
      res.status(200).json({ success: false, error: 'ids_required' });
      return;
    }
    const overrides = (data.overrides && typeof data.overrides === 'object') ? data.overrides : {};
    const events = [];
    const sentIds = [];
    const skipped = [];
    for (const d of snap.docs) {
      if (data.ids.indexOf(d.id) < 0) continue;
      const v = d.data();
      const o = overrides[d.id] || {};
      if (v.capi_sent_at && !o.force) { skipped.push({ id: d.id, reason: 'already_sent' }); continue; }
      const ua = o.ua || v.ua || String(data.ua || '');
      if (!ua) { skipped.push({ id: d.id, reason: 'no_user_agent' }); continue; } // website-события без UA Graph отвергает целым батчем
      events.push(leadEvent({
        event_id: v.event_id || ('tglead_' + (v.tg_user_id || d.id)),
        ts: Number(o.ts || v.created_at),
        landing: o.landing || v.landing || '/',
        email: v.email || '',
        tg_user_id: v.tg_user_id || '',
        fbc: o.fbc || v.fbc || fbcFromClid(v.fbclid, v.created_at),
        fbp: o.fbp || v.fbp || '',
        ua: ua,
        ip: o.ip || v.ip || '',
        method: v.method || (v.platform === 'telegram' ? 'telegram' : ''),
      }));
      sentIds.push(d.id);
    }
    const graph = await capiSend(events, capiToken(), data.test_event_code || '');
    if (graph && !data.test_event_code) {
      await Promise.all(sentIds.map((id) =>
        fs.collection('leads').doc(id).set({ capi_sent_at: Date.now() }, { merge: true }).catch(() => {})));
    }
    res.status(200).json({ success: !!graph || !events.length, sent: events.length, skipped: skipped, graph: graph, events: events });
    return;
  }
  res.status(200).json({ success: false, error: 'unknown_action' });
}

exports.lead = onRequest(
  {
    region: 'us-central1',
    secrets: [TG_BOT_TOKEN, TG_WEBHOOK_SECRET, META_CAPI_TOKEN],
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
      if (typeof data.handoff === 'string' && /^hx[a-z0-9]{8}$/.test(data.handoff)) {
        await saveHandoff(req, data);
        res.status(200).json({ success: true, handoff: true });
        return;
      }
      if (data.admin) {
        if (data.admin !== TG_WEBHOOK_SECRET.value()) {
          res.status(401).json({ success: false, error: 'unauthorized' });
          return;
        }
        await handleAdmin(data, res);
        return;
      }
      // ua/ip кладём в payload ДО handleLead: они сохраняются на документе
      // лида (FT_FIELDS) — без них будущий бэкфилл website-событий невозможен
      // (Graph требует client_user_agent). Значения только серверные.
      data.ua = String(req.get('user-agent') || '').slice(0, 500);
      data.ip = clientIp(req);
      const { body, notify } = await handleLead(data, deps());
      // Серверный Lead в CAPI — тот же event_id, что у браузерного пикселя
      // (Meta дедуплицирует). Дубликаты заявок не репортим; тестовые прогоны —
      // только с test_event_code (уходят во вкладку «Тестирование событий»).
      // pixel_live: 0 — заход владельца/тестовый (?mytraffic=off, ?x=N):
      // лид сохраняем, но в Meta не репортим — как и браузерный пиксель.
      const clientLive = !('pixel_live' in data) || !!data.pixel_live;
      const events = [];
      const isNewLead = body && body.success === true && !body.duplicate && !body.test && clientLive;
      const isVerifyRun = body && body.success === true && body.test === true && data.test_event_code;
      if (isNewLead || isVerifyRun) {
        events.push(leadEvent({
          event_id: data.event_id || '',
          ts: Date.now(),
          landing: data.landing || '/',
          email: data.email || '',
          fbc: data.fbc || fbcFromClid(data.fbclid),
          fbp: data.fbp || '',
          ip: data.ip,
          ua: data.ua,
          method: data.method || '',
        }));
      }
      const results = await Promise.all([
        tgSend(notify),
        capiSend(events, capiToken(), isVerifyRun ? String(data.test_event_code) : ''),
      ]);
      if (results[1] && isNewLead) {
        // отметка «доехало» — защита от двойной отправки бэкфиллом
        const id = 'em:' + sha256(data.email).slice(0, 32);
        await admin.firestore().collection('leads').doc(id)
          .set({ capi_sent_at: Date.now() }, { merge: true }).catch(() => {});
      }
      res.status(200).json(body);
    } catch (e) {
      console.error('lead failed', e);
      res.status(200).json({ success: false, error: 'internal' });
    }
  }
);
