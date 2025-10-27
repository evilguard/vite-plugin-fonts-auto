import fs from "fs";
import path from "path";
import crypto from "crypto"; // Для MD5-хэша
import ttf2woff from "ttf2woff";
import ttf2woff2 from "ttf2woff2";
import opentype from "opentype.js"; // Для парсинга и OTF-конвертации
import { load } from "cheerio"; // Для DOM-парсинга preload

export default function ViteFontsAutoPlugin(options = {}) {
  const root = process.cwd();
  const srcDir = path.join(root, "src");
  const distDir = path.join(root, "dist");
  const cacheFile = path.join(root, ".vite", "fonts-cache.json"); // Кэш-файл

  const {
    sourceDir = path.join(srcDir, "assets/fonts"),
    destDir = path.join(srcDir, "assets/fonts/converted"),
    buildDestDir = path.join(distDir, "assets/fonts"),
    cssFile = path.join(srcDir, "assets/styles/fonts.css"),
    indexHtml = path.join(root, "index.html"),
    preload = true,
    includeCss = true,
    generateTailwind = false,
    clearCache = false, // Очистить кэш при запуске
    maxFileSize = 50 * 1024 * 1024, // Лимит размера (50MB)
    strict = false, // Throw ошибки вместо warn
    logs = false, // Единственный параметр для логов (true - включить, false - выключить)
  } = options;

  // Валидация sourceDir
  if (!fs.existsSync(sourceDir)) {
    if (logs)
      console.warn(
        `⚠️ Директория ${sourceDir} не существует. Плагин пропущен.`
      );
    return { name: "vite-plugin-fonts-auto" };
  }

  const relSrc = (filePath) =>
    `src/${path.relative(srcDir, filePath).replace(/\\/g, "/")}`;
  const relDist = (filePath) => `assets/fonts/${path.basename(filePath)}`;

  return {
    name: "vite-plugin-fonts-auto",
    buildStart() {
      try {
        const targetDestDir =
          process.env.NODE_ENV === "production" ? buildDestDir : destDir;
        if (!fs.existsSync(targetDestDir))
          fs.mkdirSync(targetDestDir, { recursive: true });
        if (includeCss && cssFile && !fs.existsSync(path.dirname(cssFile))) {
          fs.mkdirSync(path.dirname(cssFile), { recursive: true });
        }

        let cssContent = "";
        let preloadTags = []; // Массив строк для Cheerio
        const families = new Set(); // Уникальные семьи для @theme

        // Кэш: Загрузка
        let cache = {};
        if (fs.existsSync(cacheFile)) {
          try {
            cache = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
            if (logs)
              console.log(
                `💾 Кэш загружен: ${Object.keys(cache).length} записей`
              );
          } catch (err) {
            if (logs)
              console.warn(
                `⚠️ Ошибка загрузки кэша: ${err.message}. Пересоздаём.`
              );
            cache = {};
          }
        }
        if (clearCache) {
          cache = {};
          if (logs) console.log("🧹 Кэш очищен по опции.");
        }

        // Функция для хэша
        const getHash = (buffer) =>
          crypto.createHash("md5").update(buffer).digest("hex");

        // Улучшенная функция: Детекция + опционально возвращает font для OTF-конвертации
        const detectFromFont = (inputBuffer, fileName) => {
          try {
            // Фикс: Полный ArrayBuffer слайс для DataView-совместимости
            const arrayBuffer = inputBuffer.buffer.slice(
              inputBuffer.byteOffset,
              inputBuffer.byteOffset + inputBuffer.length
            );
            const font = opentype.parse(arrayBuffer); // ← Теперь ArrayBuffer
            if (!font.supported) throw new Error("Font not supported");

            const family =
              font.names.fontFamily.en ||
              path.parse(font.names.fullName.en || fileName).name;
            const weight = font.tables.os2?.usWeightClass || 400;
            const style = font.tables.head.macStyle & 2 ? "italic" : "normal"; // Bit 1 для italic
            const isVariable = !!font.tables.fvar; // Variable font detect
            const familyClean = family.replace(/[-_]/g, " ");

            if (logs)
              console.log(
                `📊 Детекция из метаданных: family="${familyClean}", weight=${weight}, style=${style}${
                  isVariable ? ", variable=true" : ""
                }`
              );

            return { family: familyClean, weight, style, isVariable, font };
          } catch (err) {
            const msg = `Парсинг метаданных failed для ${fileName}: ${err.message}`;
            if (strict) throw new Error(msg);
            if (logs) console.warn(`⚠️ ${msg}. Fallback на имя файла.`);
            return null;
          }
        };

        // Старые функции (fallback)
        const detectWeight = (name) => {
          const lower = name.toLowerCase();
          if (lower.includes("thin")) return 100;
          if (lower.includes("extralight") || lower.includes("ultralight"))
            return 200;
          if (lower.includes("light")) return 300;
          if (
            lower.includes("regular") ||
            lower.includes("normal") ||
            lower.match(/\b\d{3}\b/)
          )
            return 400;
          if (lower.includes("medium")) return 500;
          if (lower.includes("semibold") || lower.includes("demibold"))
            return 600;
          if (lower.includes("bold")) return 700;
          if (lower.includes("extrabold") || lower.includes("ultrabold"))
            return 800;
          if (lower.includes("black") || lower.includes("heavy")) return 900;
          return 400;
        };

        const detectStyle = (name) =>
          name.toLowerCase().includes("italic") ? "italic" : "normal";

        const fontFiles = fs
          .readdirSync(sourceDir)
          .filter((f) => /\.(ttf|otf)$/i.test(f));

        // Если нет шрифтов — early return
        if (fontFiles.length === 0) {
          if (logs) console.log("ℹ️ Нет шрифтов для обработки.");
          return;
        }

        fontFiles.forEach((file) => {
          try {
            // Разделитель для каждого шрифта
            if (logs) console.log(`\n--- Обработка шрифта: ${file} ---`);

            const inputPath = path.join(sourceDir, file);
            const stat = fs.statSync(inputPath); // Check размера
            if (stat.size > maxFileSize) {
              const sizeMB = Math.round(stat.size / 1024 / 1024);
              const msg = `Шрифт ${file} слишком большой (${sizeMB}MB), пропуск. Увеличьте maxFileSize в опциях.`;
              if (strict) throw new Error(msg);
              if (logs) console.warn(`⚠️ ${msg}`);
              if (logs) console.log("--- Конец шрифта (пропуск) ---");
              return; // Skip всё для этого шрифта
            }

            const fontName = path.parse(file).name.replace(/\s+/g, "");
            const woff2Path = path.join(targetDestDir, `${fontName}.woff2`);
            const woffPath = path.join(targetDestDir, `${fontName}.woff`);
            const cacheKey = inputPath; // Ключ — полный путь

            // Кэш-чек
            const cached = cache[cacheKey];
            const input = fs.readFileSync(inputPath);
            const inputHash = getHash(input);
            if (
              cached &&
              cached.hash === inputHash &&
              fs.existsSync(woff2Path) &&
              fs.existsSync(woffPath)
            ) {
              if (logs)
                console.log(
                  `💾 Кэш hit для ${file}: используем cached metadata.`
                );
              const { family, weight, style, isVariable } = cached.metadata;
              // CSS/Preload с cached
              if (includeCss && cssFile) {
                const relWoff2 = path
                  .relative(path.dirname(cssFile), woff2Path)
                  .replace(/\\/g, "/");
                const relWoff = path
                  .relative(path.dirname(cssFile), woffPath)
                  .replace(/\\/g, "/");
                let fontFace = `@font-face {
  font-family: "${family}";
  src: url("${relWoff2}") format("woff2"), url("${relWoff}") format("woff");
  font-weight: ${isVariable ? "normal" : weight};
  font-style: ${style};
  font-display: swap;
}`;
                if (isVariable)
                  fontFace += `\n  /* Variable: use font-variation-settings for axes */\n`;
                cssContent += fontFace + "\n";
              }
              if (preload && indexHtml) {
                const relPath = relDist(woff2Path);
                preloadTags.push(
                  `<link rel="preload" href="${relPath}" as="font" type="font/woff2" crossorigin>`
                );
              }
              families.add(family); // Добавляем family для @theme
              if (logs) console.log("--- Конец шрифта (кэш) ---");
              return; // Skip остальное
            }

            // Детекция на input (раньше, для OTF и variable TTF)
            let detection = detectFromFont(input, fontName);
            let ttfBuffer = input; // По умолчанию TTF-buffer = input
            let { family, weight, style, isVariable } = detection || {}; // Из detection

            if (!fs.existsSync(woff2Path) || !fs.existsSync(woffPath)) {
              // OTF-конвертация (используем detection.font)
              if (
                file.toLowerCase().endsWith(".otf") &&
                detection &&
                detection.font
              ) {
                const arrayBuffer = detection.font.toArrayBuffer(); // OTF → TTF ArrayBuffer
                ttfBuffer = Buffer.from(arrayBuffer); // → Buffer для woff
                if (logs)
                  console.log(
                    `🔄 OTF → TTF-buffer для ${file}: ${input.length} → ${ttfBuffer.length} bytes`
                  );
              } else if (file.toLowerCase().endsWith(".otf")) {
                if (logs)
                  console.warn(
                    `⚠️ OTF-конвертация failed для ${file}, используем оригинал.`
                  );
              }

              // Конвертация WOFF (используем ttfBuffer)
              fs.writeFileSync(woff2Path, ttf2woff2(new Uint8Array(ttfBuffer)));
              fs.writeFileSync(
                woffPath,
                Buffer.from(ttf2woff(new Uint8Array(ttfBuffer)).buffer)
              );

              if (logs) {
                console.log(
                  `➡ WOFF2: ${relSrc(woff2Path)} (${
                    fs.statSync(woff2Path).size
                  } bytes)`
                );
                console.log(
                  `➡ WOFF: ${relSrc(woffPath)} (${
                    fs.statSync(woffPath).size
                  } bytes)`
                );
              }
            } else if (logs) {
              console.log(`ℹ️ Шрифт "${file}" уже отформатирован, пропускаем.`);
            }

            // Fallback детекция (если detection null, на ttfBuffer, но fallback non-variable)
            if (!family) {
              weight = detectWeight(fontName);
              style = detectStyle(fontName);
              family = fontName
                .replace(
                  /[-_](Regular|Bold|Italic|Light|Medium|SemiBold|ExtraBold|Black|Heavy).*/i,
                  ""
                )
                .replace(/[-_]/g, " ");
              isVariable = false;
              if (logs)
                console.log(
                  `📊 Fallback детекция: family="${family}", weight=${weight}, style=${style}`
                );
            }

            // Лог variable (после детекции)
            if (logs && isVariable)
              console.log(`📊 Variable font detected: axes preserved.`);

            // Кэш-обновление
            cache[cacheKey] = {
              hash: inputHash,
              metadata: { family, weight, style, isVariable },
            };
            if (logs) console.log(`💾 Кэш обновлён для ${file}`);

            if (includeCss && cssFile) {
              const relWoff2 = path
                .relative(path.dirname(cssFile), woff2Path)
                .replace(/\\/g, "/");
              const relWoff = path
                .relative(path.dirname(cssFile), woffPath)
                .replace(/\\/g, "/");
              let fontFace = `@font-face {
  font-family: "${family}";
  src: url("${relWoff2}") format("woff2"), url("${relWoff}") format("woff");
  font-weight: ${isVariable ? "normal" : weight};
  font-style: ${style};
  font-display: swap;
}`;
              if (isVariable)
                fontFace += `\n  /* Variable: use font-variation-settings for axes */\n`;
              cssContent += fontFace + "\n";
            }

            if (preload && indexHtml) {
              const relPath = relDist(woff2Path);
              preloadTags.push(
                `<link rel="preload" href="${relPath}" as="font" type="font/woff2" crossorigin>`
              );
            }

            families.add(family); // Добавляем family для @theme

            // Разделитель в конце шрифта
            if (logs) console.log("--- Конец шrifта ---");
          } catch (err) {
            const msg = `Ошибка при обработке шрифта ${file}: ${err.message}`;
            if (strict) throw new Error(msg);
            if (logs) console.warn(`⚠️ ${msg}`);
            if (logs) console.log("--- Конец шрифта (ошибка) ---");
          }
        });

        // Глобальный разделитель после всех шрифтов
        if (logs) console.log("\n=== Обработка шрифтов завершена ===");

        // Кэш: Сохранение
        if (Object.keys(cache).length > 0) {
          try {
            fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
            fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
            if (logs)
              console.log(
                `💾 Кэш сохранён: ${Object.keys(cache).length} записей`
              );
          } catch (cacheErr) {
            const msg = `Ошибка сохранения кэша: ${cacheErr.message}`;
            if (strict) throw new Error(msg);
            if (logs) console.warn(`⚠️ ${msg}`);
          }
        }

        if (includeCss && cssFile) {
          try {
            // Автоматическая генерация @theme в fonts.css (если generateTailwind true)
            if (generateTailwind && families.size > 0) {
              if (cssContent.trim()) cssContent += "\n\n"; // Разделитель перед @theme
              cssContent += "@theme {\n";
              Array.from(families).forEach((family) => {
                const key = family
                  .toLowerCase()
                  .replace(/\s+/g, "-")
                  .replace(/[^a-z0-9-]/g, ""); // Kebab-case
                cssContent += `  --font-${key}: "${family}", sans-serif;\n`;
              });
              cssContent += "}\n";
              if (logs)
                console.log(
                  `✅ @theme добавлен в ${relSrc(
                    cssFile
                  )} (семейства: ${Array.from(families).join(", ")})`
                );
            }

            fs.writeFileSync(cssFile, cssContent.trim());
            if (logs) console.log(`✅ CSS обновлён: ${relSrc(cssFile)}`);
          } catch (writeErr) {
            const msg = `Ошибка записи CSS: ${writeErr.message}`;
            if (strict) throw new Error(msg);
            if (logs) console.warn(`⚠️ ${msg}`);
          }
        }

        // Preload с Cheerio (с фиксом форматирования)
        if (preload && indexHtml && fs.existsSync(indexHtml)) {
          try {
            let html = fs.readFileSync(indexHtml, "utf8");
            let added = 0;
            const $ = load(html, { xmlMode: false }); // Стандартный режим
            preloadTags.forEach((tagStr) => {
              const $link = load(tagStr)("link");
              const href = $link.attr("href");
              const exists =
                $(`head link[rel="preload"][as="font"][href="${href}"]`)
                  .length > 0;
              if (!exists) {
                $("head").append($link);
                added++;
              }
            });
            html = $.html(); // Сериализуем

            // Фикс: Форматирование preload-тегов с переносами
            if (added > 0) {
              // Найти <head>...</head>, вставить \n\t перед каждым preload <link>
              html = html.replace(
                /<head[^>]*>(.*?)<\/head>/gis,
                (match, headContent) => {
                  const formattedHead = headContent.replace(
                    /(<link[^>]*rel="preload"[^>]*>)/g,
                    "\n\t$1"
                  );
                  return `<head${
                    match.match(/<head([^>]*)>/)[1] || ""
                  }>${formattedHead}\n</head>`;
                }
              );
              if (logs)
                console.log(
                  `🔍 Cheerio: добавлено ${added} уникальных preload-тегов с форматированием`
                );
            }

            fs.writeFileSync(indexHtml, html, "utf8");
            if (logs && added > 0)
              console.log(
                `✅ Preload обновлён в index.html (добавлено ${added} уникальных)`
              );
            else if (logs && added === 0)
              console.log(
                "ℹ️ Все preload-теги уже присутствуют, пропускаем вставку."
              );
          } catch (preloadErr) {
            const msg = `Ошибка preload: ${preloadErr.message}`;
            if (strict) throw new Error(msg);
            console.warn(`⚠️ ${msg}`);
          }
        }

        if (logs) console.log("✅ Шрифты сгенерированы!");
      } catch (globalErr) {
        const msg = `Критическая ошибка в buildStart: ${globalErr.message}`;
        if (strict) throw new Error(msg);
        console.error(`❌ ${msg}`);
      }
    },
  };
}
