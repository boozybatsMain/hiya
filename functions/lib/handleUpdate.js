// Ядро Telegram-вебхука: обработка одного update.
// Зависимости (Firestore, RTDB) приходят снаружи, поэтому логика тестируется
// обычным node без эмуляторов (test/handleUpdate.test.js).
//
// Модель данных:
//  - Firestore `leads/tg:<user_id>` — запись лида (кто, когда, номер, ft-метка).
//  - RTDB `waitlist/signups` — ЕДИНЫЙ счётчик с сайтом (см. lib/common.js).
//
// Возвращает { reply, notify }: reply — ответ пользователю, notify —
// уведомление владельцу (@oddbear); оба в формате sendMessage или null.

const { BASE, TARGET, OWNER_CHAT_ID, initialsFromName, takePlace } = require('./common');

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
    'Напишу здесь в день запуска в Алматы. Возьми друзей — знакомиться веселее, ' +
    'когда в кафе есть кого лайкать 😉';
}
function existingText(place) {
  return 'Ты уже в списке — №' + place + ' из ' + TARGET + ', премиум навсегда твой. ' +
    'Напишу здесь в день запуска в Алматы!';
}
const HELP_TEXT = 'Я бот раннего доступа hiya — знакомства с теми, кто сейчас в том же заведении.\n' +
  'Жми /start — займу тебе место в списке (№ из ' + TARGET + ') и напишу в день запуска в Алматы.';

function ownerNote(user, payload, r) {
  const who = (user.first_name || '') + (user.username ? ' (@' + user.username + ')' : '');
  return {
    chat_id: OWNER_CHAT_ID,
    text: '🆕 №' + r.place + ' — Telegram: ' + (who || user.id) +
      '\nМетка: ' + (payload || '—') + '\nВсего в списке: ' + (r.total || r.place)
  };
}

async function handleUpdate(update, deps) {
  const msg = (update && (update.message || update.edited_message)) || null;
  if (!msg || !msg.from || msg.from.is_bot || !msg.chat) return { reply: null, notify: null };
  const text = String(msg.text || '').trim();
  const chatId = msg.chat.id;

  if (/^\/start/.test(text)) {
    const payload = text.split(/\s+/)[1] || '';
    const r = await ensureLead(deps, msg.from, payload);
    return {
      reply: { chat_id: chatId, text: r.isNew ? newText(r.place) : existingText(r.place) },
      notify: r.isNew ? ownerNote(msg.from, payload, r) : null
    };
  }

  if (/^\/place/.test(text)) {
    const snap = await deps.fs.collection('leads').doc('tg:' + msg.from.id).get();
    if (snap.exists && snap.get('place')) {
      return { reply: { chat_id: chatId, text: existingText(snap.get('place')) }, notify: null };
    }
    return { reply: { chat_id: chatId, text: 'Тебя пока нет в списке. ' + HELP_TEXT }, notify: null };
  }

  return { reply: { chat_id: chatId, text: HELP_TEXT }, notify: null };
}

module.exports = { handleUpdate, ensureLead, BASE, TARGET };
