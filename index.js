import fs from "fs";
import path from "path";
import crypto from "crypto"; // Для MD5-хэша
import ttf2woff from "ttf2woff";
import ttf2woff2 from "ttf2woff2";
import opentype from "opentype.js"; // Для парсинга и OTF-конвертации

export default function ViteFontsAutoPlugin(options = {}) {
    const root = process.cwd();
    const srcDir = path.join(root, "src");
    const publicDir = path.join(root, "public");

    const {
        sourceDir = path.join(srcDir, "assets/fonts"),
        destDir = path.join(publicDir, "fonts"), // Всегда public/fonts
        cssFile = path.join(srcDir, "assets/styles/fonts.css"),
        indexHtml = path.join(root, "index.html"),
        preload = true,
        includeCss = true,
        generateTailwind = false,
        clearCache = false,
        maxFileSize = 50 * 1024 * 1024, // Лимит размера (50MB)
        strict = false,
        logs = false,
    } = options;

    // Валидация sourceDir
    if (!fs.existsSync(sourceDir)) {
        if (logs)
            console.warn(
                `⚠️ Директория ${sourceDir} не существует. Плагин пропущен.`
            );
        return {name: "vite-plugin-fonts-auto"};
    }

    const relSrc = (filePath) =>
        `src/${path.relative(srcDir, filePath).replace(/\\/g, "/")}`;
    const relPublic = (filePath) => `/fonts/${path.basename(filePath)}`; // Путь для public/fonts

    // Функция для очистки имени семейства шрифта (удаление суффиксов веса/стиля)
    const cleanFamily = (name) => {
        const suffixes = [
            "Regular",
            "Bold",
            "Italic",
            "Light",
            "Medium",
            "SemiBold",
            "ExtraBold",
            "Black",
            "Heavy",
        ];
        let cleaned = name;
        // Удаление суффикса с пробелом в конце
        cleaned = cleaned.replace(
            new RegExp(`\\s+(?:${suffixes.join("|")})$`, "i"),
            ""
        );
        // Удаление суффикса с - или _ и остатком
        cleaned = cleaned.replace(
            new RegExp(`[-_](?:${suffixes.join("|")}).*$`, "i"),
            ""
        );
        // Удаление суффикса без разделителя в конце
        cleaned = cleaned.replace(
            new RegExp(`(?:${suffixes.join("|")})$`, "i"),
            ""
        );
        // Замена -_ на пробел
        cleaned = cleaned.replace(/[-_]/g, " ");
        // Нормализация пробелов
        cleaned = cleaned.replace(/\s+/g, " ").trim();
        return cleaned;
    };

    return {
        name: "vite-plugin-fonts-auto",
        buildStart() {
            try {
                // Используем одну директорию public/fonts для всех сред
                const targetDestDir = destDir; // Всегда public/fonts
                if (!fs.existsSync(targetDestDir))
                    fs.mkdirSync(targetDestDir, {recursive: true});
                if (includeCss && cssFile && !fs.existsSync(path.dirname(cssFile))) {
                    fs.mkdirSync(path.dirname(cssFile), {recursive: true});
                }

                let cssContent = "";
                let preloadTags = [];
                const families = new Set();

                // Кэш: Загрузка
                const cacheFile = path.join(root, "node_modules/.cache/vite-plugin-fonts-auto", "fonts-cache.json");
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

                // Детекция шрифта
                const detectFromFont = (inputBuffer, fileName) => {
                    try {
                        const arrayBuffer = inputBuffer.buffer.slice(
                            inputBuffer.byteOffset,
                            inputBuffer.byteOffset + inputBuffer.length
                        );
                        const font = opentype.parse(arrayBuffer);
                        if (!font.supported) throw new Error("Font not supported");

                        let family =
                            font.names.fontFamily.en ||
                            path.parse(font.names.fullName.en || fileName).name;
                        // Очистка имени семейства для единообразия
                        family = cleanFamily(family);
                        const weight = font.tables.os2?.usWeightClass || 400;
                        const style = font.tables.head.macStyle & 2 ? "italic" : "normal";
                        const isVariable = !!font.tables.fvar;

                        if (logs)
                            console.log(
                                `📊 Детекция из метаданных: family="${family}", weight=${weight}, style=${style}${
                                    isVariable ? ", variable=true" : ""
                                }`
                            );

                        return {family, weight, style, isVariable, font};
                    } catch (err) {
                        const msg = `Парсинг метаданных failed для ${fileName}: ${err.message}`;
                        if (strict) throw new Error(msg);
                        if (logs) console.warn(`⚠️ ${msg}. Fallback на имя файла.`);
                        return null;
                    }
                };

                // Fallback функции
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

                if (fontFiles.length === 0) {
                    if (logs) console.log("ℹ️ Нет шрифтов для обработки.");
                    return;
                }

                fontFiles.forEach((file) => {
                    try {
                        if (logs) console.log(`\n--- Обработка шрифта: ${file} ---`);

                        const inputPath = path.join(sourceDir, file);
                        const stat = fs.statSync(inputPath);
                        if (stat.size > maxFileSize) {
                            const sizeMB = Math.round(stat.size / 1024 / 1024);
                            const msg = `Шрифт ${file} слишком большой (${sizeMB}MB), пропуск.`;
                            if (strict) throw new Error(msg);
                            if (logs) console.warn(`⚠️ ${msg}`);
                            if (logs) console.log("--- Конец шрифта (пропуск) ---");
                            return;
                        }

                        const fontName = path.parse(file).name.replace(/\s+/g, "");
                        const woff2Path = path.join(targetDestDir, `${fontName}.woff2`);
                        const woffPath = path.join(targetDestDir, `${fontName}.woff`);
                        const cacheKey = inputPath;

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
                            const {family, weight, style, isVariable} = cached.metadata;
                            if (includeCss && cssFile) {
                                const relWoff2 = `/fonts/${path.basename(woff2Path)}`; // Путь для CSS
                                const relWoff = `/fonts/${path.basename(woffPath)}`;
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
                                const relPath = relPublic(woff2Path); // /fonts/filename.woff2
                                preloadTags.push(
                                    `<link rel="preload" href="${relPath}" as="font" type="font/woff2" crossorigin>`
                                );
                            }
                            families.add(family);
                            if (logs) console.log("--- Конец шрифта (кэш) ---");
                            return;
                        }

                        // Детекция
                        let detection = detectFromFont(input, fontName);
                        let ttfBuffer = input;
                        let {family, weight, style, isVariable} = detection || {};

                        if (!fs.existsSync(woff2Path) || !fs.existsSync(woffPath)) {
                            if (
                                file.toLowerCase().endsWith(".otf") &&
                                detection &&
                                detection.font
                            ) {
                                const arrayBuffer = detection.font.toArrayBuffer();
                                ttfBuffer = Buffer.from(arrayBuffer);
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

                            // Конвертация
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

                        // Fallback детекция (с использованием cleanFamily для единообразия)
                        if (!family) {
                            weight = detectWeight(fontName);
                            style = detectStyle(fontName);
                            family = cleanFamily(fontName);
                            isVariable = false;
                            if (logs)
                                console.log(
                                    `📊 Fallback детекция: family="${family}", weight=${weight}, style=${style}`
                                );
                        }

                        if (logs && isVariable)
                            console.log(`📊 Variable font detected: axes preserved.`);

                        // Кэш-обновление
                        cache[cacheKey] = {
                            hash: inputHash,
                            metadata: {family, weight, style, isVariable},
                        };
                        if (logs) console.log(`💾 Кэш обновлён для ${file}`);

                        if (includeCss && cssFile) {
                            const relWoff2 = `/fonts/${path.basename(woff2Path)}`; // Путь для CSS
                            const relWoff = `/fonts/${path.basename(woffPath)}`;
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
                            const relPath = relPublic(woff2Path); // /fonts/filename.woff2
                            preloadTags.push(
                                `<link rel="preload" href="${relPath}" as="font" type="font/woff2" crossorigin>`
                            );
                        }

                        families.add(family);
                        if (logs) console.log("--- Конец шрифта ---");
                    } catch (err) {
                        const msg = `Ошибка при обработке шрифта ${file}: ${err.message}`;
                        if (strict) throw new Error(msg);
                        if (logs) console.warn(`⚠️ ${msg}`);
                        if (logs) console.log("--- Конец шрифта (ошибка) ---");
                    }
                });

                if (logs) console.log("\n=== Обработка шрифтов завершена ===");

                // Кэш: Сохранение
                if (Object.keys(cache).length > 0) {
                    try {
                        fs.mkdirSync(path.dirname(cacheFile), {recursive: true});
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
                        if (generateTailwind && families.size > 0) {
                            if (cssContent.trim()) cssContent += "\n\n";
                            const defaultFamily = Array.from(families)[0];
                            const defaultKey = defaultFamily
                                .toLowerCase()
                                .replace(/\s+/g, "-")
                                .replace(/[^a-z0-9-]/g, "");
                            cssContent += "@theme {\n";
                            Array.from(families).forEach((family) => {
                                const key = family
                                    .toLowerCase()
                                    .replace(/\s+/g, "-")
                                    .replace(/[^a-z0-9-]/g, "");
                                cssContent += `  --font-${key}: "${family}", sans-serif;\n`;
                            });
                            cssContent += "}\n";

                            // Установка шрифта по умолчанию для Tailwind
                            cssContent += "\n\n@layer base {\n";
                            cssContent += `  body {\n`;
                            cssContent += `    font-family: var(--font-${defaultKey});\n`;
                            cssContent += "  }\n";
                            cssContent += "}\n";

                            if (logs)
                                console.log(
                                    `✅ @theme добавлен в ${relSrc(
                                        cssFile
                                    )} (семейства: ${Array.from(families).join(
                                        ", "
                                    )}), default font var: --font-${defaultKey}`
                                );
                        } else if (families.size > 0) {
                            // Если не Tailwind, обновляем variables.css или variables.scss
                            /*let variablesFile = path.join(
                                srcDir,
                                "assets/styles/variables.css"
                            );
                            let isScss = false;

                            // Проверяем, существует ли .scss версия
                            const scssPath = variablesFile.replace(/\.css$/, ".scss");
                            if (fs.existsSync(scssPath)) {
                                variablesFile = scssPath;
                                isScss = true;
                            } else if (!fs.existsSync(variablesFile)) {
                                // Если ни один не существует, создаём .css по умолчанию
                                fs.mkdirSync(path.dirname(variablesFile), {recursive: true});
                                fs.writeFileSync(variablesFile, ":root {\n\n}\n"); // Начальный шаблон для CSS
                            }

                            const defaultFamily = Array.from(families)[0];
                            const fontValue = `"${defaultFamily}", sans-serif`;
                            let variablesContent = fs.readFileSync(variablesFile, "utf8");

                            if (isScss) {
                                // Для SCSS: ищем $fontFamily и заменяем или добавляем в начало
                                const varRegex = /\$fontFamily\s*:\s*[^;]+;/g;
                                if (varRegex.test(variablesContent)) {
                                    variablesContent = variablesContent.replace(
                                        varRegex,
                                        `$fontFamily: ${fontValue};`
                                    );
                                } else {
                                    variablesContent =
                                        `$fontFamily: ${fontValue};\n` + variablesContent;
                                }
                            } else {
                                // Для CSS: ищем --fontFamily в :root и заменяем или добавляем в начало :root
                                const varRegex = /--fontFamily\s*:\s*[^;]+;/g;
                                if (varRegex.test(variablesContent)) {
                                    variablesContent = variablesContent.replace(
                                        varRegex,
                                        `--fontFamily: ${fontValue};`
                                    );
                                } else {
                                    // Добавляем в начало :root
                                    variablesContent = variablesContent.replace(
                                        /:root\s*\{([^}]*)\}/,
                                        `:root {\n  --fontFamily: ${fontValue};$1\n}`
                                    );
                                }
                            }

                            fs.writeFileSync(variablesFile, variablesContent.trim());
                            if (logs)
                                console.log(
                                    `✅ Переменная fontFamily обновлена в ${relSrc(
                                        variablesFile
                                    )} (значение: ${fontValue})`
                                );

                             */
                        }

                        fs.writeFileSync(cssFile, cssContent.trim());
                        if (logs) console.log(`✅ CSS обновлён: ${relSrc(cssFile)}`);
                    } catch (writeErr) {
                        const msg = `Ошибка записи CSS: ${writeErr.message}`;
                        if (strict) throw new Error(msg);
                        if (logs) console.warn(`⚠️ ${msg}`);
                    }
                }

                if (preload && indexHtml && fs.existsSync(indexHtml)) {
                    try {
                        let html = fs.readFileSync(indexHtml, "utf8");
                        let added = 0;

                        // Собираем уникальные preload-теги, которых нет в HTML
                        const existingHrefs = new Set();
                        // Извлекаем все href из существующих preload font тегов
                        html.replace(/<link[^>]+href="([^"]+)"[^>]*>/gi, (match, href) => {
                            if (
                                html.includes('rel="preload"') &&
                                html.includes('as="font"') &&
                                match.includes(href)
                            ) {
                                existingHrefs.add(href);
                            }
                            return match;
                        });

                        const uniqueNewTags = preloadTags.filter((tag) => {
                            const hrefMatch = tag.match(/href="([^"]+)"/);
                            if (hrefMatch) {
                                const href = hrefMatch[1];
                                if (!existingHrefs.has(href)) {
                                    existingHrefs.add(href);
                                    added++;
                                    return true;
                                }
                            }
                            return false;
                        });

                        if (added > 0) {
                            // Формируем вставку с отступами (предполагаем табы в head)
                            const insertion =
                                uniqueNewTags.map((tag) => `\t${tag}`).join("\n") + "\n";

                            // Вставляем перед </head>, сохраняя оригинальное форматирование
                            html = html.replace(/<\/head\s*>/i, insertion + "$&");

                            fs.writeFileSync(indexHtml, html, "utf8");
                            if (logs)
                                console.log(
                                    `✅ Preload обновлён в index.html (добавлено ${added} уникальных)`
                                );
                        } else if (logs) {
                            console.log(
                                "ℹ️ Все preload-теги уже присутствуют, пропускаем вставку."
                            );
                        }
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
