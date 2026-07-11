// Ядро Telegram-вебхука: обработка одного update.
// Зависимости (Firestore, RTDB) приходят снаружи, поэтому логика тестируется
// обычным node без эмуляторов (test/handleUpdate.test.js).
//
// Модель данных:
//  - Firestore `leads/tg:<user_id>` — запись лида (кто, когда, номер, ft-метка).
//  - RTDB `waitlist/signups` — ЕДИНЫЙ счётчик с сайтом (сайт показывает
//    BASE + signups); транзакция +1 выдаёт номер атомарно.
//  - RTDB `waitlist/recent` — инициалы для ленты аватарок на сайте.

const BASE = 151;   // как в index.html: показываемое число = BASE + signups
const TARGET = 300;

function initialsFrom(name) {
  const s = String(name || '').replace(/[^0-9A-Za-zА-Яа-яЁё ]/g, '').trim();
  if (!s) return '';
  const parts = s.split(/\s+/).filter(Boolean);
  const ini = parts.length >= 2 ? parts[0][0] + parts[1][0] : s.slice(0, 2);
  return ini.toUpperCase();
}

// Выдать (или вернуть существующий) номер в очереди для tg-пользователя.
async function ensureLead(deps, user, payload) {
  const { fs, rtdb, now } = deps;
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

  // Атомарный источник номера — общий с сайтом счётчик
  const tx = await rtdb.ref('waitlist/signups').transaction(function (c) {
    return (c || 0) + 1;
  });
  const count = (tx && tx.snapshot && tx.snapshot.val()) || 0;
  const place = BASE + count;

  await ref.set({ place: place, placed_at: now() }, { merge: true });

  const ini = initialsFrom(user.first_name || user.username);
  if (ini) {
    try { await rtdb.ref('waitlist/recent').push({ i: ini, t: now() }); } catch (e) {}
  }
  return { place: place, isNew: true };
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

// Возвращает {chat_id, text} для sendMessage или null, если отвечать не на что.
async function handleUpdate(update, deps) {
  const msg = (update && (update.message || update.edited_message)) || null;
  if (!msg || !msg.from || msg.from.is_bot || !msg.chat) return null;
  const text = String(msg.text || '').trim();
  const chatId = msg.chat.id;

  if (/^\/start/.test(text)) {
    const payload = text.split(/\s+/)[1] || '';
    const r = await ensureLead(deps, msg.from, payload);
    return { chat_id: chatId, text: r.isNew ? newText(r.place) : existingText(r.place) };
  }

  if (/^\/place/.test(text)) {
    const snap = await deps.fs.collection('leads').doc('tg:' + msg.from.id).get();
    if (snap.exists && snap.get('place')) {
      return { chat_id: chatId, text: existingText(snap.get('place')) };
    }
    return { chat_id: chatId, text: 'Тебя пока нет в списке. ' + HELP_TEXT };
  }

  return { chat_id: chatId, text: HELP_TEXT };
}

module.exports = { handleUpdate, ensureLead, initialsFrom, BASE, TARGET };
