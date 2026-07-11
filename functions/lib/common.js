// Общее для обработчиков: константы очереди и выдача номера.
// BASE/TARGET зеркалят index.html: сайт показывает BASE + waitlist/signups.

const BASE = 151;
const TARGET = 300;
const OWNER_CHAT_ID = 406663035; // @oddbear — нотификации о каждой заявке

function sanitizeIni(s) {
  return String(s || '').replace(/[^0-9A-Za-zА-Яа-яЁё]/g, '').slice(0, 2).toUpperCase();
}

function initialsFromName(name) {
  const s = String(name || '').replace(/[^0-9A-Za-zА-Яа-яЁё ]/g, '').trim();
  if (!s) return '';
  const parts = s.split(/\s+/).filter(Boolean);
  return sanitizeIni(parts.length >= 2 ? parts[0][0] + parts[1][0] : s.slice(0, 2));
}

// «первые 2 буквы, а если есть разделитель — по первой из двух частей»
// (та же логика, что в index.html, чтобы аватарки выглядели одинаково)
function initialsFromEmail(email) {
  const local = String(email || '').split('@')[0].toLowerCase();
  const isLetter = /[a-zа-яё]/i;
  const parts = local.split(/[^0-9a-zа-яё]+/i).filter(Boolean);
  const firstLetter = (s) => { const m = s.match(isLetter); return m ? m[0] : (s.charAt(0) || ''); };
  let ini = '';
  if (parts.length >= 2) ini = firstLetter(parts[0]) + firstLetter(parts[1]);
  else if (parts.length === 1) {
    const letters = parts[0].match(new RegExp(isLetter.source, 'gi')) || [];
    ini = letters.length >= 2 ? letters[0] + letters[1] : parts[0].slice(0, 2);
  }
  return sanitizeIni(ini);
}

// Атомарно занять следующее место: транзакция по общему с сайтом счётчику
// + инициалы в ленту аватарок. Возвращает номер в очереди.
async function takePlace(deps, initials) {
  const { rtdb, now } = deps;
  const tx = await rtdb.ref('waitlist/signups').transaction(function (c) {
    return (c || 0) + 1;
  });
  const count = (tx && tx.snapshot && tx.snapshot.val()) || 0;
  if (initials) {
    try { await rtdb.ref('waitlist/recent').push({ i: initials, t: now() }); } catch (e) {}
  }
  return { place: BASE + count, total: BASE + count };
}

module.exports = { BASE, TARGET, OWNER_CHAT_ID, sanitizeIni, initialsFromName, initialsFromEmail, takePlace };
