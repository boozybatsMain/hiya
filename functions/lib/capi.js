// Meta Conversions API: серверные Lead-события в датасет «hiya».
// Зачем: браузерный пиксель не видит лиды, завершающиеся в Telegram-боте
// (у бота нет браузера), и терял Lead сайта при уходе из вебвью до ответа
// сервера. Сервер шлёт Lead сам; с браузерным событием Meta дедуплицирует
// по паре (event_name, event_id) — двойного счёта нет.
// Токен — Secret Manager META_CAPI_TOKEN (Events Manager → Настройки →
// Conversions API → «Создать токен доступа»). Ошибки не роняют обработчики:
// отчётность — best effort, как gaSend.

const crypto = require('crypto');

const DATASET_ID = '2523353561436955'; // зеркалит window.FB_PIXEL_ID (index.html)
const GRAPH_URL = 'https://graph.facebook.com/v21.0/' + DATASET_ID + '/events';
const SITE_URL = 'https://boozybatsmain.github.io';

function sha256(s) {
  return crypto.createHash('sha256').update(String(s).trim().toLowerCase()).digest('hex');
}

// _fbc из голого fbclid (когда кука _fbc не досталась):
// формат fb.1.<время клика, мс>.<fbclid>
function fbcFromClid(fbclid, ts) {
  if (!fbclid) return '';
  return 'fb.1.' + (ts || Date.now()) + '.' + fbclid;
}

// Событие Lead. Пустые идентификаторы не кладём: качество матчинга Meta
// считает по заполненным ключам, мусор в user_data только вредит.
// action_source=website: воронка начинается на сайте, и все идентификаторы
// (fbc/fbp/ip/ua) — из браузерной сессии, даже когда финал в Telegram.
function leadEvent(o) {
  const ud = {};
  if (o.email) ud.em = [sha256(o.email)];
  if (o.tg_user_id) ud.external_id = [sha256('tg:' + o.tg_user_id)];
  if (o.fbc) ud.fbc = String(o.fbc).slice(0, 500);
  if (o.fbp) ud.fbp = String(o.fbp).slice(0, 100);
  if (o.ip) ud.client_ip_address = String(o.ip).slice(0, 64);
  if (o.ua) ud.client_user_agent = String(o.ua).slice(0, 500);
  const ev = {
    event_name: 'Lead',
    event_time: Math.floor((o.ts || Date.now()) / 1000),
    action_source: 'website',
    event_source_url: SITE_URL + String(o.landing || '/').slice(0, 500),
    user_data: ud,
    custom_data: { method: String(o.method || '') },
  };
  if (o.event_id) ev.event_id = String(o.event_id).slice(0, 100);
  return ev;
}

// Отправка пачки событий. Без токена молча выходим (зеркалит gaSend):
// работа сайта/бота важнее отчётности. Возвращает текст ответа Graph API
// ({"events_received":N,...}) либо null.
async function capiSend(events, token, testCode) {
  if (!events || !events.length || !token) return null;
  const body = { data: events };
  if (testCode) body.test_event_code = String(testCode);
  try {
    const r = await fetch(GRAPH_URL + '?access_token=' + encodeURIComponent(token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(4000),
    });
    const text = await r.text();
    if (!r.ok) { console.error('capi failed', r.status, text); return null; }
    console.log('capi ok', text);
    return text;
  } catch (e) {
    console.error('capi error', e);
    return null;
  }
}

module.exports = { capiSend, leadEvent, fbcFromClid, sha256, DATASET_ID, SITE_URL };
