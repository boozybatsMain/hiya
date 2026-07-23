// Приём заявки с сайта (почта / Google) — замена FormSubmit.
// Firestore `leads/em:<sha256(email)>` (дедуп по адресу), номер — из общего
// счётчика RTDB (lib/common.js), владельцу — уведомление в Telegram.
//
// Возвращает { body, notify }: body — JSON-ответ клиенту, notify —
// сообщение владельцу (формат sendMessage) или null.

const crypto = require('crypto');
const { TARGET, OWNER_CHAT_ID, initialsFromEmail, takePlace } = require('./common');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// fbc/fbp — куки пикселя, ua/ip — серверные значения (index.js кладёт в data):
// всё это ключи матчинга Meta CAPI, хранятся на лиде ради бэкфилла.
const FT_FIELDS = [
  'method', 'ft_source', 'ft_medium', 'ft_campaign', 'ft_content', 'ft_term',
  'ft_campaign_id', 'ft_adset_id', 'ft_ad_id',
  'fbclid', 'fbc', 'fbp', 'ua', 'ip', 'referrer', 'landing', 'event_id'
];

function ownerNote(email, data, r, dup) {
  const src = [data.ft_source, data.ft_content].filter(Boolean).join(' / ') || '—';
  return {
    chat_id: OWNER_CHAT_ID,
    text: (dup ? '🔁 Повторная заявка' : '🆕 №' + r.place) + ' — ' +
      (data.method === 'google' ? 'Google' : 'почта') + ': ' + email +
      '\nИсточник: ' + src +
      (dup ? '' : '\nВсего в списке: ' + (r.total || r.place))
  };
}

async function handleLead(data, deps) {
  const email = String((data && data.email) || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return { body: { success: false, error: 'invalid_email' }, notify: null };
  }

  // Тестовый прогон: уведомление приходит, но ни очередь, ни база не трогаются
  if (data && data.test === true) {
    return {
      body: { success: true, test: true },
      notify: { chat_id: OWNER_CHAT_ID, text: '🧪 Тестовая заявка (' + email + ') — очередь и база не тронуты' }
    };
  }

  const { fs, now } = deps;
  const id = 'em:' + crypto.createHash('sha256').update(email).digest('hex').slice(0, 32);
  const ref = fs.collection('leads').doc(id);

  const snap = await ref.get();
  if (snap.exists && snap.get('place')) {
    // повторная отправка того же адреса: номер не меняется, счётчик не растёт
    return {
      body: { success: true, place: snap.get('place'), duplicate: true },
      notify: ownerNote(email, data, { place: snap.get('place') }, true)
    };
  }

  if (!snap.exists) {
    const doc = { platform: 'site', email: email, created_at: now(), place: null };
    for (const f of FT_FIELDS) doc[f] = String((data && data[f]) || '').slice(0, 200);
    try {
      await ref.create(doc);
    } catch (e) {
      const again = await ref.get();
      if (again.exists && again.get('place')) {
        return {
          body: { success: true, place: again.get('place'), duplicate: true },
          notify: ownerNote(email, data, { place: again.get('place') }, true)
        };
      }
    }
  }

  const taken = await takePlace(deps, initialsFromEmail(email));
  await ref.set({ place: taken.place, placed_at: now() }, { merge: true });

  return {
    body: { success: true, place: taken.place, target: TARGET },
    notify: ownerNote(email, data || {}, taken, false)
  };
}

module.exports = { handleLead };
