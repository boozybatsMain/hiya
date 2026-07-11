# hiya — landing page

Одностраничный лендинг (один самодостаточный файл `index.html`, без сборки).

**Живёт тут:** https://boozybatsmain.github.io/hiya/

## Как обновить страницу

1. Отредактируй `index.html`.
2. Закоммить и запушь:

   ```bash
   git add index.html
   git commit -m "update landing"
   git push
   ```

3. Через ~1 минуту GitHub Pages пересоберёт сайт — обнови страницу в браузере.

Никакой сборки нет. Один HTML-файл + пара картинок в `assets/`.

## Фон сайта — фото кафе

На фоне страницы лежит тёмное фото кафе. Файл — `assets/bg-cafe.jpg`.

- Чтобы поставить своё фото: положи его в `assets/` под именем `bg-cafe.jpg`
  (форматы .jpg/.png). Оно автоматически затемняется и уходит на фон —
  трогать код не нужно.
- Если файла нет — сайт не ломается: вместо фото показывается тёплый
  градиент «как в кафе». Так что можно и без фото.

## Счётчик «151 из 300» — реальный, общий для всех (Firebase)

Число на первом экране («сколько человек уже ждут») хранится в Firebase
Realtime Database и **общее для всех посетителей**. С 11.07.2026 его двигают
только Cloud Function `/lead` (заявки с сайта) и Telegram-бот — **клиент в
базу не пишет**.

✅ Конфиг вставлен (проект `hiya-e8f5c`) в `index.html` → `window.FIREBASE_CONFIG`.

✅ **Правила базы лежат в репо** — [`database.rules.json`](database.rules.json)
(читать можно `waitlist/signups` и `waitlist/recent`, писать — никому; серверный
код ходит через Admin SDK мимо правил). Деплой после правки:
`firebase deploy --only database`. Бэкенд описан в
[`docs/telegram-bot.md`](docs/telegram-bot.md).

Если понадобится сменить проект Firebase — ниже как получить конфиг заново:

1. Зайди на https://console.firebase.google.com → **Add project** (назови,
   напр., `hiya`). Google Analytics можно отключить — не нужен.
2. В меню слева: **Build → Realtime Database → Create Database**.
   Регион — любой (напр., `europe-west1`). Старт в **test mode** (можно
   ужесточить правила позже).
3. Открой вкладку **Rules** базы и вставь такие правила (разрешают читать
   счётчик всем и только увеличивать его):

   ```json
   {
     "rules": {
       "waitlist": {
         "signups": {
           ".read": true,
           ".write": "newData.isNumber() && (!data.exists() || newData.val() === data.val() + 1)"
         }
       }
     }
   }
   ```

4. ⚙ **Project settings → General → Your apps** → иконка веб `</>` →
   зарегистрируй приложение → скопируй объект `firebaseConfig`.
5. В `index.html` найди `window.FIREBASE_CONFIG = null;` (вверху, в `<head>`)
   и замени на свой конфиг, например:

   ```js
   window.FIREBASE_CONFIG = {
     apiKey: "AIza…",
     authDomain: "hiya-xxxx.firebaseapp.com",
     databaseURL: "https://hiya-xxxx-default-rtdb.firebaseio.com",
     projectId: "hiya-xxxx",
     appId: "1:…:web:…"
   };
   ```

   Главное — чтобы был `databaseURL`. Закоммить, запушь — и число станет
   общим и живым для всех. Стартовое значение 151 «зашито» в код: реальные
   заявки прибавляются к нему (151 + число записей в базе).

## Хостинг

- **Хостинг:** GitHub Pages (бесплатно) — раздаёт из ветки `main`, папка `/` (корень).
- **Домен:** бесплатный поддомен `boozybatsmain.github.io/hiya`.
- Можно позже подключить свой домен: Settings → Pages → Custom domain.
