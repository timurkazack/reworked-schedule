/*
Copyright (c) 2026 Jool_
Licensed under the Non-Commercial Custom License.
See the LICENSE file in the project root for full license text.

Разрешено использование, изменение и создание форков только в НЕКОММЕРЧЕСКИХ целях.
Указание авторства (Jool_) обязательно во всех копиях и производных работах.
Коммерческое использование и распространение оригинального кода без изменений ЗАПРЕЩЕНО.
*/
// Имя кеша привязано к версии из version.json. `_buildId` хранит
// идентификатор сборки для автообновления, см. refreshCache/getVersion.
const CACHE_NAME_PREFIX = "schedule";
const FALLBACK_VERSION = "0.0.0";
let _cacheName = null;
let _buildId = null;

// Список файлов, которые забираем в оффлайн-кеш при установке
const FILES = [
    "./config.json",
    "./css/app.min.css",
    "./help/vid/Android_Crome_PWA_Install.mp4",
    "./help/vid/IOS_Safari_PWA_Install.mp4",
    "./icons/Arrow.svg",
    "./icons/Clock.svg",
    "./icons/Copyboard.svg",
    "./icons/Mode1.svg",
    "./icons/Mode2.svg",
    "./icons/Moon.svg",
    "./icons/Refresh.svg",
    "./icons/Settings.svg",
    "./icons/Sun.svg",
    "./icons/btnOff.svg",
    "./icons/btnOn.svg",
    "./icons/giphy.gif",
    "./icons/icon-192.png",
    "./icons/icon-512.png",
    "./icons/old/icon-192_old.png",
    "./icons/old/icon-512_old.png",
    "./icons/plate.svg",
    "./icons/unused/copy.svg",
    "./icons/unused/icon-192.png",
    "./icons/unused/icon-512.png",
    "./icons/unused/moon.svg",
    "./icons/unused/new_dark.jpg",
    "./icons/unused/new_light.jpg",
    "./icons/unused/sand_clock.svg",
    "./icons/unused/settings-minimalistic-svgrepo-com.svg",
    "./icons/unused/sun.svg",
    "./icons/unused/update.svg",
    "./index.html",
    "./js/app.min.js",
    "./manifest.json",
    "./version.json"
];

// Находим самый «свежий» (лексикографически последний) кеш нашего приложения,
// чтобы переиспользовать его, когда version.json недоступен
function getExistingCacheName() {
    return caches.keys().then(keys =>
        keys
            .filter(key => key.indexOf(CACHE_NAME_PREFIX + "-v") === 0)
            .sort()
            .pop() || null
    );
}

// Определяем имя кеша по версии, считанной из version.json.
// При недоступности файла (нет сети) подхватываем существующий кеш,
// чтобы сохранить оффлайн-версию.
function getCacheName() {
    if (_cacheName) return Promise.resolve(_cacheName);
    return fetch("version.json?t=" + Date.now(), { cache: "no-store" })
        .then(r => {
            if (!r.ok) throw new Error("HTTP " + r.status);
            return r.json();
        })
        .then(data => {
            _cacheName = CACHE_NAME_PREFIX + "-v" + data.version;
            _buildId = data.buildid || null;
            return _cacheName;
        })
        .catch(() => {
            return getExistingCacheName().then(existing => {
                if (existing) {
                    _cacheName = existing;
                } else {
                    _cacheName = CACHE_NAME_PREFIX + "-v" + FALLBACK_VERSION;
                }
                return _cacheName;
            });
        });
}

function getActiveCacheName() {
    if (_cacheName) return Promise.resolve(_cacheName);
    return getExistingCacheName();
}

// Кешируем файлы небольшими пакетами, чтобы не блокировать установку
// при большом списке; неудачные файлы собираем и возвращаем наверх.
async function cacheFiles(cache, files) {
    const BATCH_SIZE = 8;
    const allResults = [];
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
        const batch = files.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(batch.map(async file => {
            try {
                const response = await fetch(file, { cache: "no-store" });
                if (!response.ok) throw new Error("HTTP " + response.status);
                await cache.put(file, response.clone());
                return { file, ok: true };
            } catch (error) {
                return { file, ok: false, error: error.message };
            }
        }));
        allResults.push(...results);
    }

    const failed = allResults.filter(r => !r.ok);
    if (failed.length > 0) {
        console.warn("[SW] Не удалось закешировать файлы:", failed);
    }
    return failed;
}

// Удаляем кеши более старых версий, кроме текущей
async function clearStaleCaches(currentName) {
    const keys = await caches.keys();
    await Promise.all(
        keys
            .filter(key => key.startsWith(CACHE_NAME_PREFIX + "-v") && key !== currentName)
            .map(key => caches.delete(key))
    );
}

// Установка: наполняем кеш будущей версии, но НЕ активируемся и не
// перехватываем управление - страница продолжает жить на старой версии.
// Активацию запускаем вручную сообщением skipWaiting (при нажатии
// «Обновить»), чтобы до этого момента ничего не менялось.
self.addEventListener("install", event => {
    event.waitUntil(
        getCacheName()
            .then(name => caches.open(name))
            .then(cache => cacheFiles(cache, FILES))
    );
});

// Активация: чистим устаревшие кеши и берём контроль над страницами
self.addEventListener("activate", event => {
    event.waitUntil(
        (async () => {
            const currentName = _cacheName || (await getExistingCacheName());
            if (currentName) await clearStaleCaches(currentName);
            await self.clients.claim();
        })()
    );
});

// Стратегия cache-first: из кеша - иначе сеть (и заодно кладём в кеш)
self.addEventListener("fetch", event => {
    if (event.request.method !== "GET") return;

    const url = new URL(event.request.url);
    if (url.origin !== location.origin) return;

    event.respondWith(
        getActiveCacheName()
            .then(name => name ? caches.open(name) : null)
            .then(cache => {
                if (!cache) return fetch(event.request);
                return cache.match(event.request).then(cached => {
                    if (cached) return cached;
                    return fetch(event.request).then(response => {
                        if (response && response.ok) {
                            cache.put(event.request, response.clone()).catch(() => {});
                        }
                        return response;
                    });
                });
            })
            .catch(() => fetch(event.request))
    );
});

// Обмен сообщениями со страницей.
// skipWaiting - отложенная активация по запросу (кнопка «Обновить»).
// getVersion - отдаём версию и buildid текущего кеша.
// refreshCache - подгружаем новую версию и при расхождении переключаем кеш.
self.addEventListener("message", event => {
    if (!event.data) return;

    if (event.data.type === "skipWaiting") {
        self.skipWaiting();
        return;
    }

    if (!event.ports || !event.ports[0]) return;
    const port = event.ports[0];

    if (event.data.type === "getVersion") {
        const version = _cacheName
            ? _cacheName.replace(CACHE_NAME_PREFIX + "-v", "")
            : null;
        port.postMessage({ version: version, buildid: _buildId });
        return;
    }

    if (event.data.type === "refreshCache") {
        event.waitUntil(
            (async () => {
                try {
                    const response = await fetch("version.json?t=" + Date.now(), { cache: "no-store" });
                    if (!response.ok) throw new Error("HTTP " + response.status);
                    const info = await response.json();
                    const name = CACHE_NAME_PREFIX + "-v" + info.version;

                    // Пересобираем кеш, если поменялась ВЕРСИЯ или BUILDID.
                    // Buildid меняется при каждом деплое автоматически, поэтому
                    // фикс кода подтягивается, даже когда семантическая версия
                    // в version.json не изменилась. Раньше кеш обновлялся только
                    // по версии - и старые файлы (например, исправленный cards.js)
                    // продолжали отдаваться из кеша, ломая уже починенную логику.
                    const versionChanged = name !== _cacheName;
                    const buildChanged = (info.buildid || null) !== _buildId;

                    if (versionChanged || buildChanged) {
                        const cache = await caches.open(name);
                        await cacheFiles(cache, FILES);
                        _cacheName = name;
                        _buildId = info.buildid || null;
                        await clearStaleCaches(name);
                    }

                    port.postMessage({ ok: true, version: info.version, buildid: _buildId });
                } catch (error) {
                    port.postMessage({ ok: false, error: error.message });
                }
            })()
        );
    }
});
