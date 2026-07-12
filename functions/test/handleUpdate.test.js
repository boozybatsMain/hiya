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

  // 1а. В ответе есть кнопка «Пригласить друзей» с персональной ссылкой
  const kb = r1.reply.reply_markup.inline_keyboard[0][0];
  assert(/Пригласить/.test(kb.text), 'invite button text');
  assert(kb.url.includes(encodeURIComponent('start=ref_777')), 'invite link has ref_<id>');

  // 2. Повторный /start: номер тот же, счётчик не растёт, владельцу НЕ шлём
  const r2 = await handleUpdate(upd('/start'), deps);
  assert(r2.reply.text.includes('№' + (BASE + 10)), 'repeat keeps place');
  assert(state.count === 10, 'no double increment');
  assert(r2.notify === null, 'no owner notify on repeat');

  // 2а. Приход по реферальной ссылке: новый лид с ref_777 → у 777 invited=1,
  // владельцу видно, кто привёл
  const rRef = await handleUpdate(upd('/start ref_777', 555), deps);
  assert(state.docs['tg:555'].start_payload === 'ref_777', 'ref payload stored');
  assert(state.docs['tg:777'].invited === 1, 'referrer credited');
  assert(/Привёл: Иван Тест \(@ivan\)/.test(rRef.notify.text), 'notify names referrer');

  // 2б. Повторный /start приглашённого по той же ссылке — invited не растёт
  await handleUpdate(upd('/start ref_777', 555), deps);
  assert(state.docs['tg:777'].invited === 1, 'no credit on repeat start');

  // 2в. Своя же ссылка и выдуманный реферер — без кредита и без падения
  const rSelf = await handleUpdate(upd('/start ref_666', 666), deps);
  assert(!state.docs['tg:666'].invited, 'self-invite not credited');
  assert(!/Привёл/.test(rSelf.notify.text), 'no referrer line for self-invite');
  const rFake = await handleUpdate(upd('/start ref_424242', 424), deps);
  assert(rFake.reply.text.includes('Готово'), 'fake referrer ignored, lead still created');

  // 2г. GA-события: новый /start → generate_lead (method=telegram) с развёрнутой
  // ft-меткой; повтор → tg_start_repeat; реферальный приход → +tg_invite рефереру
  const gaNew = await handleUpdate(upd('/start ig__creative-02', 1001), deps);
  assert(gaNew.ga.length === 1 && gaNew.ga[0].name === 'generate_lead', 'ga lead event');
  assert(gaNew.ga[0].params.method === 'telegram', 'ga method');
  assert(gaNew.ga[0].params.ft_source === 'ig' && gaNew.ga[0].params.ft_content === 'creative-02', 'ga ft from payload');
  assert(gaNew.ga[0].client_id === '1001.1', 'ga client id');
  const gaRep = await handleUpdate(upd('/start', 1001), deps);
  assert(gaRep.ga.length === 1 && gaRep.ga[0].name === 'tg_start_repeat', 'ga repeat event');
  const gaRef = await handleUpdate(upd('/start ref_777', 1002), deps);
  assert(gaRef.ga.length === 2 && gaRef.ga[1].name === 'tg_invite', 'ga invite event');
  assert(gaRef.ga[0].params.ft_source === 'referral', 'ga ft referral');
  assert(gaRef.ga[1].client_id === '777.1', 'invite credited to referrer client');

  // 3. /place для нового пользователя — предлагает /start
  const r3 = await handleUpdate(upd('/place', 888), deps);
  assert(/нет в списке/.test(r3.reply.text), 'place for unknown user');
  assert(r3.ga.length === 1 && r3.ga[0].name === 'tg_place_check' && r3.ga[0].params.via === 'unknown', 'ga place unknown');
  const r3b = await handleUpdate(upd('/place', 1001), deps);
  assert(r3b.ga[0].params.via === 'known', 'ga place known');

  // 4. Прочий текст — help
  const r4 = await handleUpdate(upd('привет', 999), deps);
  assert(/Жми \/start/.test(r4.reply.text), 'help text');

  // 5. Мусорный update — без падения и без ответов
  const r5 = await handleUpdate({}, deps);
  assert(r5.reply === null && r5.notify === null, 'garbage update ignored');

  console.log('OK: handleUpdate tests passed');
})().catch((e) => { console.error('TEST FAILED:', e.message); process.exit(1); });
