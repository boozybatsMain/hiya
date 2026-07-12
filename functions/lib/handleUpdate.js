// Ядро Telegram-вебхука: обработка одного update.
// Зависимости (Firestore, RTDB) приходят снаружи, поэтому логика тестируется
// обычным node без эмуляторов (test/handleUpdate.test.js).
//
// Модель данных:
//  - Firestore `leads/tg:<user_id>` — запись лида (кто, когда, номер, ft-метка;
//    у реферера — invited/last_invite_at, у приглашённого метка ref_<id>
//    лежит в start_payload).
//  - RTDB `waitlist/signups` — ЕДИНЫЙ счётчик с сайтом (см. lib/common.js).
//
// Возвращает { reply, notify, ga }: reply — ответ пользователю, notify —
// уведомление владельцу (@oddbear), оба в формате sendMessage или null;
// ga — события для GA4 Measurement Protocol (index.js отправляет), формат
// { client_id, name, params }. Логика остаётся чистой — сеть снаружи.

const { BASE, TARGET, OWNER_CHAT_ID, initialsFromName, takePlace, ftFromPayload } = require('./common');

// client_id GA для tg-пользователя: стабильный «X.Y»-вид, чтобы события
// одного человека склеивались, но с site-клиентами не пересекались
function gaClientId(userId) { return String(userId) + '.1'; }

// Выдать (или вернуть существующий) номер в очереди для tg-пользователя.
async function ensureLead(deps, user, payload) {
  const { fs, now } = deps;
  const ref = fs.collection('leads').doc('tg:' + user.id);

  const snap = await ref.get();
  if (snap.exists && snap.get('place')) {
    return { place: snap.get('place'), isNew: false };
  }

  if (!snap.exists) {
    try {
      await ref.create({
        platform: 'telegram',
        tg_user_id: user.id,
        username: user.username || '',
        first_name: user.first_name || '',
        start_payload: String(payload || '').slice(0, 64),
        created_at: now(),
        place: null
      });
    } catch (e) {
      // ALREADY_EXISTS: параллельный /start того же пользователя — перечитываем
      const again = await ref.get();
      if (again.exists && again.get('place')) {
        return { place: again.get('place'), isNew: false };
      }
    }
  }

  const taken = await takePlace(deps, initialsFromName(user.first_name || user.username));
  await ref.set({ place: taken.place, placed_at: now() }, { merge: true });
  return { place: taken.place, total: taken.total, isNew: true };
}

function newText(place) {
  return 'Готово! Ты №' + place + ' из ' + TARGET + ' в раннем доступе hiya — ' +
    'премиум навсегда закреплён за тобой.\n\n' +
    'Напишу здесь в день запуска в Алматы. Зови друзей кнопкой ниже — ' +
    'знакомиться веселее, когда в кафе есть кого лайкать 😉';
}
function existingText(place) {
  return 'Ты уже в списке — №' + place + ' из ' + TARGET + ', премиум навсегда твой. ' +
    'Напишу здесь в день запуска в Алматы!\n\n' +
    'Зови друзей — кнопка ниже отправит им приглашение 😉';
}

// Персональная реферальная ссылка: /start ref_<tg_user_id> у приглашённого.
// Кнопка открывает нативный шаринг Telegram (выбор чата) с готовым текстом.
const BOT_USERNAME = 'hiyawrld_bot';
const SHARE_TEXT = 'Держи место в раннем доступе hiya — знакомства с теми, ' +
  'кто сейчас в том же заведении. Ранним — премиум навсегда 😉';

function inviteMarkup(userId) {
  const link = 'https://t.me/' + BOT_USERNAME + '?start=ref_' + userId;
  return {
    inline_keyboard: [[{
      text: '👋 Пригласить друзей',
      url: 'https://t.me/share/url?url=' + encodeURIComponent(link) +
        '&text=' + encodeURIComponent(SHARE_TEXT)
    }]]
  };
}

// ref_<id> из метки диплинка; своя же ссылка (self-invite) не считается.
function refIdFrom(payload, selfId) {
  const m = /^ref_(\d+)$/.exec(String(payload || ''));
  return m && m[1] !== String(selfId) ? m[1] : null;
}

// Best-effort счётчик приглашений у реферера (аналитика, не награда):
// leads/tg:<id>.invited += 1. Несуществующий реферер (выдуманная метка) — игнор.
async function creditReferrer(deps, refId) {
  const { fs, now } = deps;
  try {
    const ref = fs.collection('leads').doc('tg:' + refId);
    const snap = await ref.get();
    if (!snap.exists || !snap.get('place')) return null;
    const invited = (snap.get('invited') || 0) + 1;
    await ref.set({ invited: invited, last_invite_at: now() }, { merge: true });
    return {
      first_name: snap.get('first_name') || '',
      username: snap.get('username') || '',
      place: snap.get('place'),
      invited: invited
    };
  } catch (e) {
    return null;
  }
}
const HELP_TEXT = 'Я бот раннего доступа hiya — знакомства с теми, кто сейчас в том же заведении.\n' +
  'Жми /start — займу тебе место в списке (№ из ' + TARGET + ') и напишу в день запуска в Алматы.';

function ownerNote(user, payload, r, referrer) {
  const who = (user.first_name || '') + (user.username ? ' (@' + user.username + ')' : '');
  let text = '🆕 №' + r.place + ' — Telegram: ' + (who || user.id) +
    '\nМетка: ' + (payload || '—') + '\nВсего в списке: ' + (r.total || r.place);
  if (referrer) {
    const refWho = (referrer.first_name || '') +
      (referrer.username ? ' (@' + referrer.username + ')' : '');
    text += '\n👥 Привёл: ' + (refWho || '№' + referrer.place) +
      ' — приглашённых: ' + referrer.invited;
  }
  return { chat_id: OWNER_CHAT_ID, text: text };
}

async function handleUpdate(update, deps) {
  const msg = (update && (update.message || update.edited_message)) || null;
  if (!msg || !msg.from || msg.from.is_bot || !msg.chat) return { reply: null, notify: null, ga: [] };
  const text = String(msg.text || '').trim();
  const chatId = msg.chat.id;

  if (/^\/start/.test(text)) {
    const payload = text.split(/\s+/)[1] || '';
    const r = await ensureLead(deps, msg.from, payload);
    // Реферальный приход засчитываем только новым лидам: повторный /start
    // по чужой ссылке счётчик приглашений не двигает.
    const refId = r.isNew ? refIdFrom(payload, msg.from.id) : null;
    const referrer = refId ? await creditReferrer(deps, refId) : null;
    // GA: новый лид — тот же generate_lead, что и на сайте (method=telegram),
    // повторный /start — своё событие; ft-метка склеивает с кампанией.
    const ft = ftFromPayload(payload);
    const ga = [{
      client_id: gaClientId(msg.from.id),
      name: r.isNew ? 'generate_lead' : 'tg_start_repeat',
      params: { method: 'telegram', ft_source: ft.ft_source, ft_content: ft.ft_content }
    }];
    // приглашение засчитано → событие рефереру (его client_id: считаем ЕГО заслугу)
    if (referrer) {
      ga.push({ client_id: gaClientId(refId), name: 'tg_invite', params: { method: 'telegram' } });
    }
    return {
      reply: {
        chat_id: chatId,
        text: r.isNew ? newText(r.place) : existingText(r.place),
        reply_markup: inviteMarkup(msg.from.id)
      },
      notify: r.isNew ? ownerNote(msg.from, payload, r, referrer) : null,
      ga: ga
    };
  }

  if (/^\/place/.test(text)) {
    const snap = await deps.fs.collection('leads').doc('tg:' + msg.from.id).get();
    const known = snap.exists && !!snap.get('place');
    const ga = [{
      client_id: gaClientId(msg.from.id),
      name: 'tg_place_check',
      params: { method: 'telegram', via: known ? 'known' : 'unknown' }
    }];
    if (known) {
      return {
        reply: {
          chat_id: chatId,
          text: existingText(snap.get('place')),
          reply_markup: inviteMarkup(msg.from.id)
        },
        notify: null,
        ga: ga
      };
    }
    return { reply: { chat_id: chatId, text: 'Тебя пока нет в списке. ' + HELP_TEXT }, notify: null, ga: ga };
  }

  return { reply: { chat_id: chatId, text: HELP_TEXT }, notify: null, ga: [] };
}

module.exports = { handleUpdate, ensureLead, BASE, TARGET };
