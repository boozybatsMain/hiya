// Юнит-тест ядра вебхука на стабах — обычный node, без эмуляторов.
const assert = require('assert');
const { handleUpdate, BASE } = require('../lib/handleUpdate');

function makeStubs(initialCount) {
  const state = { count: initialCount, docs: {}, recent: [] };
  const fs = {
    collection: (name) => ({
      doc: (id) => ({
        get: async () => ({
          exists: !!state.docs[id],
          get: (f) => (state.docs[id] || {})[f],
        }),
        create: async (data) => {
          if (state.docs[id]) { const e = new Error('exists'); e.code = 6; throw e; }
          state.docs[id] = data;
        },
        set: async (data, opts) => {
          state.docs[id] = Object.assign({}, state.docs[id], data);
        },
      }),
    }),
  };
  const rtdb = {
    ref: (path) => ({
      transaction: async (fn) => {
        state.count = fn(state.count);
        return { snapshot: { val: () => state.count } };
      },
      push: async (v) => { state.recent.push(v); },
    }),
  };
  return { deps: { fs, rtdb, now: () => 1000 }, state };
}

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
  // 1. Новый /start: счётчик 9 -> 10, номер BASE+10 = 161
  const { deps, state } = makeStubs(9);
  const r1 = await handleUpdate(upd('/start ig_creative01'), deps);
  assert(r1.text.includes('№' + (BASE + 10)), 'new lead place: ' + r1.text);
  assert(state.docs['tg:777'].place === BASE + 10, 'place stored');
  assert(state.docs['tg:777'].start_payload === 'ig_creative01', 'payload stored');
  assert(state.recent.length === 1 && state.recent[0].i === 'ИТ', 'avatar initials');

  // 2. Повторный /start: номер тот же, счётчик не растёт
  const r2 = await handleUpdate(upd('/start'), deps);
  assert(r2.text.includes('№' + (BASE + 10)), 'repeat keeps place');
  assert(state.count === 10, 'no double increment');

  // 3. /place для нового пользователя — предлагает /start
  const r3 = await handleUpdate(upd('/place', 888), deps);
  assert(/нет в списке/.test(r3.text), 'place for unknown user');

  // 4. Прочий текст — help
  const r4 = await handleUpdate(upd('привет', 999), deps);
  assert(/Жми \/start/.test(r4.text), 'help text');

  // 5. Мусорный update — null, без падения
  const r5 = await handleUpdate({}, deps);
  assert(r5 === null, 'garbage update ignored');

  console.log('OK: all handleUpdate tests passed');
})().catch((e) => { console.error('TEST FAILED:', e.message); process.exit(1); });
