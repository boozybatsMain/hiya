// Юнит-тест приёма заявки с сайта.
const assert = require('assert');
const { handleLead } = require('../lib/handleLead');
const { BASE, OWNER_CHAT_ID } = require('../lib/common');
const { makeStubs } = require('./stubs');

(async () => {
  // 1. Новая заявка: счётчик 9 -> 10, место 161, уведомление владельцу
  const { deps, state } = makeStubs(9);
  const r1 = await handleLead({
    email: 'Ivan.Petrov@Gmail.com', method: 'early_access',
    ft_source: 'ig', ft_content: 'creative-01-dark-phone',
    ft_campaign_id: 'cmp_1', ft_adset_id: 'set_1', ft_ad_id: 'ad_1',
    event_id: 'lead_1_x'
  }, deps);
  assert(r1.body.success === true && r1.body.place === BASE + 10, 'place: ' + JSON.stringify(r1.body));
  assert(r1.notify.chat_id === OWNER_CHAT_ID, 'owner notified');
  assert(r1.notify.text.includes('ivan.petrov@gmail.com'), 'email in notify (lowercased)');
  assert(r1.notify.text.includes('ig / creative-01-dark-phone'), 'source in notify');
  assert(state.docs[Object.keys(state.docs).find((id) => id.startsWith('em:'))].ft_campaign_id === 'cmp_1',
    'campaign id stored');
  assert(state.docs[Object.keys(state.docs).find((id) => id.startsWith('em:'))].ft_adset_id === 'set_1',
    'adset id stored');
  assert(state.docs[Object.keys(state.docs).find((id) => id.startsWith('em:'))].ft_ad_id === 'ad_1',
    'ad id stored');
  assert(state.recent[0].i === 'IP', 'initials: ' + state.recent[0].i);

  // 2. Тот же адрес (в другом регистре) — дубликат: место то же, счётчик стоит
  const r2 = await handleLead({ email: 'ivan.petrov@gmail.com', method: 'google' }, deps);
  assert(r2.body.duplicate === true && r2.body.place === BASE + 10, 'dup keeps place');
  assert(state.count === 10, 'no double increment');
  assert(/Повторная/.test(r2.notify.text), 'dup notify marked');

  // 3. Невалидный адрес
  const r3 = await handleLead({ email: 'not-an-email' }, deps);
  assert(r3.body.success === false && r3.body.error === 'invalid_email', 'invalid email rejected');

  // 4. Тестовый прогон: уведомление есть, база и счётчик не тронуты
  const before = state.count;
  const r4 = await handleLead({ email: 'test@test.com', test: true }, deps);
  assert(r4.body.test === true && /Тестовая/.test(r4.notify.text), 'test mode notify');
  assert(state.count === before && !state.docs['em:' + 'x'], 'test mode side-effect free');

  console.log('OK: handleLead tests passed');
})().catch((e) => { console.error('TEST FAILED:', e.message); process.exit(1); });
