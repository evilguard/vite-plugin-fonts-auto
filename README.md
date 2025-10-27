# ⚡ vite-plugin-fonts-auto

Vite Fonts Auto Plugin — это плагин для Vite, который автоматически обрабатывает шрифты в вашем проекте. Он конвертирует файлы шрифтов из форматов `TTF/OTF` в современные `WOFF/WOFF2`, генерирует CSS-правила `@font-face`, добавляет теги `<link rel="preload">` в `index.html` для быстрой загрузки, поддерживает `variable fonts` и генерирует `Tailwind CSS` `@theme` для кастомных семейств шрифтов.

Плагин работает на этапе `buildStart`, использует кэширование для ускорения повторных сборок и минимизирует ручную работу с шрифтами. Идеально подходит для проектов на Vite, где нужно оптимизировать веб-шрифты без лишних инструментов.

### Основные возможности

- ✅ Автоматическая конвертация: TTF/OTF → WOFF/WOFF2 с использованием ttf2woff и ttf2woff2.
- ✅ Поддержка OTF: Конвертация OTF в TTF через opentype.js для совместимости.
- ✅ Детекция метаданных: Чтение family name, weight, style и variable axes из шрифта.
- ✅ Fallback-детекция: Если метаданные недоступны, анализ имени файла.
- ✅ Генерация CSS: Создание @font-face с font-display: swap и поддержкой variable fonts.
- ✅ Preload-теги: Автоматическая вставка в <head> index.html с проверкой дубликатов и форматированием.
- ✅ Tailwind @theme: Опциональная генерация переменных --font-\* для семейств шрифтов.
- ✅ Кэширование: Хранение хэшей и метаданных в .vite/fonts-cache.json для пропуска неизменённых шрифтов.
- ✅ Логирование: Детальные логи с эмодзи (включается опцией logs: true).
- ✅ Безопасность: Лимит размера файла (по умолчанию 50MB), опциональный strict режим для ошибок.
- ✅ Гибкие опции: Настраиваемые пути, включение/выключение функций.

---

## 📦 Установка

```sh
#npm
npm install --save-dev vite-plugin-fonts-auto

# yarn
yarn add -D vite-plugin-fonts-auto

# pnpm
pnpm add -D vite-plugin-fonts-auto
```

## ⚙ Использование

#### 1. Добавьте плагин в vite.config.js

```js
// vite.config.js

import { defineConfig } from "vite";
import ViteFontsAutoPlugin from "vite-plugin-fonts-auto";

export default defineConfig({
  plugins: [
    ViteFontsAutoPlugin({
      // Опции по умолчанию (см. ниже)
    }),
  ],
});
```

#### 2. Поместите исходные шрифты (TTF/OTF) в директорию `src/assets/fonts`

Плагин автоматически:

- Конвертирует их в src/assets/fonts/converted (dev) или dist/assets (prod).
- Создаст/обновит src/assets/styles/fonts.css с @font-face.
- Добавит preload-теги в index.html.
- Сгенерирует кэш в .vite/fonts-cache.json.

#### 3. Выполните команду (`dev` или `build`)

```sh
#npm
npm run dev

# yarn
yarn dev

# pnpm
pnpm dev
```

#### 📁 Пример результата:

После выполнения команды

```css
src/
 ├── assets/
 │   ├── fonts/
 │   │   ├── Roboto-Regular.ttf
 │   │   └── converted/
 │   │        ├── Roboto-Regular.woff
 │   │        └── Roboto-Regular.woff2
 │   └── styles/
 │       └── fonts.css
 │
 style.css
 index.html
```

#### 4. Импорт CSS в приложение

В вашем основном `CSS/SCSS` (например, `src/main.css`) в начало файла импортируйте сгенерированный `fonts.css`:

```css
@import "assets/styles/fonts.css";
```

#### 5. Готово! Можно пользоваться шрифтами.

🧾 Пример сгенерированного CSS

```css
@font-face {
  font-family: "Roboto";
  src: url("../fonts/converted/Roboto-Regular.woff2") format("woff2"), url("../fonts/converted/Roboto-Regular.woff")
      format("woff");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
```

## <svg xmlns="http://www.w3.org/2000/svg" width="30px" height="30px" viewBox="0 0 32 20"><title>file_type_tailwind</title><path d="M9,13.7q1.4-5.6,7-5.6c5.6,0,6.3,4.2,9.1,4.9q2.8.7,4.9-2.1-1.4,5.6-7,5.6c-5.6,0-6.3-4.2-9.1-4.9Q11.1,10.9,9,13.7ZM2,22.1q1.4-5.6,7-5.6c5.6,0,6.3,4.2,9.1,4.9q2.8.7,4.9-2.1-1.4,5.6-7,5.6c-5.6,0-6.3-4.2-9.1-4.9Q4.1,19.3,2,22.1Z" style="fill:#44a8b3"/></svg> Использование с Tailwind

#### 1. В опциях включите поддержку Tailwind

```js
ViteFontsAutoPlugin({
  generateTailwind: true,
});
```

#### 2. Перезапустите проект

В `fonts.css` будут сгенерированы переменные `@theme`:

```css
@theme {
  --font-roboto: "Roboto", sans-serif;
}
```

#### 3. Использование:

```html
<h1 class="font-roboto">Hello World!</h1>
```

## 🔧 Опции

| Опция              | Тип     | По умолчанию                  | Описание                                   |
| ------------------ | ------- | ----------------------------- | ------------------------------------------ |
| `sourceDir`        | string  | `src/assets/fonts`            | Исходные шрифты `.ttf` / `.otf`            |
| `destDir`          | string  | `src/assets/fonts/converted`  | Конвертированные WOFF / WOFF2              |
| `cssFile`          | string  | `src/assets/styles/fonts.css` | Генерируемый CSS с `@font-face` и `@theme` |
| `indexHtml`        | string  | `index.html`                  | HTML для добавления preload-тегов          |
| `preload`          | boolean | `true`                        | Добавлять preload для WOFF2 в HTML         |
| `includeCss`       | boolean | `true`                        | Генерировать CSS `@font-face`              |
| `generateTailwind` | boolean | `false`                       | Создавать переменные `@theme` для Tailwind |
| `clearCache`       | boolean | `false`                       | Очищать кэш при сборке                     |
| `maxFileSize`      | number  | `52428800`                    | Максимальный размер шрифта в байтах (50mb) |
| `strict`           | boolean | `false`                       | Бросать ошибки вместо логов                |
| `logs`             | boolean | `false`                       | Логи работы плагина                        |

## 🔗 Репозиторий и баги

- GitHub: https://github.com/KozlovDS/vite-plugin-fonts-auto
- Issues: https://github.com/KozlovDS/vite-plugin-fonts-auto/issues

## 📝 Лицензия

MIT License © 2025 kozlovv.ds@ya.ru
