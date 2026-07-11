// Юнит-тест ядра вебхука на стабах — обычный node, без эмуляторов.
const assert = require('assert');
const { handleUpdate, BASE } = require('../lib/handleUpdate');
const { OWNER_CHAT_ID } = require('../lib/common');
const { makeStubs } = require('./stubs');

function upd(text, userId) {
  return {
    message: {
      text: text,
      from: { id: userId || 777, first_name: 'Иван Тест', username: 'ivan' },
      chat: { id: userId || 777 },
    },
  };
}

(async () => {
  // 1. Новый /start: счётчик 9 -> 10, номер BASE+10 = 161, уведомление владельцу
  const { deps, state } = makeStubs(9);
  const r1 = await handleUpdate(upd('/start ig_creative01'), deps);
  assert(r1.reply.text.includes('№' + (BASE + 10)), 'new lead place: ' + r1.reply.text);
  assert(state.docs['tg:777'].place === BASE + 10, 'place stored');
  assert(state.docs['tg:777'].start_payload === 'ig_creative01', 'payload stored');
  assert(state.recent.length === 1 && state.recent[0].i === 'ИТ', 'avatar initials');
  assert(r1.notify && r1.notify.chat_id === OWNER_CHAT_ID, 'owner notified');
  assert(r1.notify.text.includes('ig_creative01'), 'notify has payload');

  // 2. Повторный /start: номер тот же, счётчик не растёт, владельцу НЕ шлём
  const r2 = await handleUpdate(upd('/start'), deps);
  assert(r2.reply.text.includes('№' + (BASE + 10)), 'repeat keeps place');
  assert(state.count === 10, 'no double increment');
  assert(r2.notify === null, 'no owner notify on repeat');

  // 3. /place для нового пользователя — предлагает /start
  const r3 = await handleUpdate(upd('/place', 888), deps);
  assert(/нет в списке/.test(r3.reply.text), 'place for unknown user');

  // 4. Прочий текст — help
  const r4 = await handleUpdate(upd('привет', 999), deps);
  assert(/Жми \/start/.test(r4.reply.text), 'help text');

  // 5. Мусорный update — без падения и без ответов
  const r5 = await handleUpdate({}, deps);
  assert(r5.reply === null && r5.notify === null, 'garbage update ignored');

  console.log('OK: handleUpdate tests passed');
})().catch((e) => { console.error('TEST FAILED:', e.message); process.exit(1); });
