/**
 * Favicon 自动获取 & 缓存
 * 缓存策略：成功图标长期缓存，失败短期缓存；同域名请求去重并限流。
 * 实际网络请求由扩展后台完成，直接使用当前网络访问目标站点。
 * Emoji 图标直接渲染，无需获取。
 */
const Favicons = (() => {
  const SUCCESS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  const FAILURE_TTL_MS = 12 * 60 * 60 * 1000;
  const MAX_CONCURRENT_FETCHES = 4;

  const inflightByDomain = new Map();
  const scheduleNetworkFetch = createLimiter(MAX_CONCURRENT_FETCHES);

  /**
   * 获取并缓存 favicon
   */
  async function fetchAndCache(config, card) {
    if (!card.url || card.iconType !== 'favicon') return;

    try {
      const parsedUrl = parseHttpUrl(card.url);
      if (!parsedUrl) return;

      const domain = getCacheKey(parsedUrl);
      if (!domain) return;

      const cache = ensureCache(config);
      let cachedEntry = normalizeCacheEntry(cache[domain]);
      let cachedValue = getCachedValue(cachedEntry);
      const cardValue = isDataImageUrl(card.iconValue) ? card.iconValue : '';

      if (cardValue && !cachedValue) {
        cache[domain] = createSuccessEntry(cardValue, {
          source: 'card',
          sourceUrl: parsedUrl.href
        });
        cachedEntry = normalizeCacheEntry(cache[domain]);
        cachedValue = getCachedValue(cachedEntry);
      }

      if (cachedValue && !shouldFetch(cachedEntry)) {
        clearCardFaviconValue(card);
        return;
      }

      if (!shouldFetch(cachedEntry)) {
        clearCardFaviconValue(card);
        return;
      }

      await fetchAndStore(parsedUrl.href, config, domain, cachedEntry);
      clearCardFaviconValue(card);
    } catch (error) {
      // favicon 获取失败，静默处理
      console.debug('Favicon fetch failed for', card.url, error);
    }
  }

  /**
   * 批量获取 favicon
   * 处理所有 iconType === 'favicon' 的卡片：
   * - 有可用缓存：直接使用缓存
   * - 无缓存或缓存过期：后台直连目标站点获取
   */
  async function fetchAllForConfig(config) {
    const cardsByDomain = new Map();

    forEachFaviconCard(config, (card) => {
      const parsedUrl = parseHttpUrl(card.url);
      if (!parsedUrl) return;

      const domain = getCacheKey(parsedUrl);
      if (!domain) return;

      if (!cardsByDomain.has(domain)) {
        cardsByDomain.set(domain, {
          url: parsedUrl.href,
          cards: []
        });
      }

      cardsByDomain.get(domain).cards.push(card);
    });

    const tasks = [...cardsByDomain.entries()].map(async ([domain, item]) => {
      const cache = ensureCache(config);
      let cachedEntry = normalizeCacheEntry(cache[domain]);
      let cachedValue = getCachedValue(cachedEntry);
      const cardValue = item.cards.map(card => card.iconValue).find(isDataImageUrl) || '';

      if (cardValue && !cachedValue) {
        cache[domain] = createSuccessEntry(cardValue, {
          source: 'card',
          sourceUrl: item.url
        });
        cachedEntry = normalizeCacheEntry(cache[domain]);
        cachedValue = getCachedValue(cachedEntry);
      }

      if (cachedValue && !shouldFetch(cachedEntry)) {
        item.cards.forEach(clearCardFaviconValue);
        return;
      }

      if (!shouldFetch(cachedEntry)) {
        item.cards.forEach(clearCardFaviconValue);
        return;
      }

      await fetchAndStore(item.url, config, domain, cachedEntry);
      item.cards.forEach(clearCardFaviconValue);
    });

    await Promise.allSettled(tasks);
  }

  /**
   * 根据域名获取 favicon（优先读缓存，缓存无则从网络获取）
   * 用于编辑器弹窗实时预览
   */
  async function fetchForDomain(url, config) {
    try {
      const parsedUrl = parseHttpUrl(url);
      if (!parsedUrl) return null;

      const domain = getCacheKey(parsedUrl);
      if (!domain) return null;

      let cachedEntry = null;

      if (config) {
        const cache = ensureCache(config);
        cachedEntry = normalizeCacheEntry(cache[domain]);
        const cachedValue = getCachedValue(cachedEntry);
        if (cachedValue && !shouldFetch(cachedEntry)) return cachedValue;
      }

      const fetchedValue = await fetchAndStore(parsedUrl.href, config, domain, cachedEntry);
      return fetchedValue || getCachedValue(cachedEntry);
    } catch {
      return null;
    }
  }

  function getCachedForUrl(url, config) {
    const parsedUrl = parseHttpUrl(url);
    if (!parsedUrl || !config) return '';

    const cache = config._faviconCache || {};
    const entry = normalizeCacheEntry(cache[getCacheKey(parsedUrl)]);
    return getCachedValue(entry);
  }

  function migrateCardFaviconToCache(config, card) {
    if (!config || !card || card.iconType !== 'favicon' || !isDataImageUrl(card.iconValue)) {
      return false;
    }

    const parsedUrl = parseHttpUrl(card.url);
    if (!parsedUrl) return false;

    const cache = ensureCache(config);
    const domain = getCacheKey(parsedUrl);
    const cachedEntry = normalizeCacheEntry(cache[domain]);

    if (!getCachedValue(cachedEntry)) {
      cache[domain] = createSuccessEntry(card.iconValue, {
        source: 'card',
        sourceUrl: parsedUrl.href
      });
    }

    clearCardFaviconValue(card);
    return true;
  }

  function migrateConfig(config) {
    let migrated = false;
    forEachFaviconCard(config, (card) => {
      if (migrateCardFaviconToCache(config, card)) {
        migrated = true;
      }
    });
    return migrated;
  }

  async function fetchAndStore(url, config, domain, previousEntry) {
    const cache = config ? ensureCache(config) : null;

    try {
      const result = await fetchViaExtension(url, domain);
      if (!result?.dataUrl) {
        throw new Error(result?.error || 'No favicon found');
      }

      if (cache) {
        cache[domain] = createSuccessEntry(result.dataUrl, {
          source: result.source,
          sourceUrl: result.url,
          mimeType: result.mimeType
        });
      }

      return result.dataUrl;
    } catch (error) {
      if (cache) {
        cache[domain] = createFailureEntry(previousEntry, error);
      }
      return getCachedValue(previousEntry);
    }
  }

  function fetchViaExtension(url, domain) {
    if (!canUseRuntimeBridge()) return Promise.resolve(null);

    if (inflightByDomain.has(domain)) {
      return inflightByDomain.get(domain);
    }

    const request = scheduleNetworkFetch(() => sendRuntimeMessage({
      type: 'favicon-fetch',
      url
    })).finally(() => {
      inflightByDomain.delete(domain);
    });

    inflightByDomain.set(domain, request);
    return request;
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }

        resolve(response);
      });
    });
  }

  function createLimiter(limit) {
    const queue = [];
    let active = 0;

    function runNext() {
      if (active >= limit || queue.length === 0) return;

      const item = queue.shift();
      active += 1;

      Promise.resolve()
        .then(item.task)
        .then(item.resolve, item.reject)
        .finally(() => {
          active -= 1;
          runNext();
        });
    }

    return function limitTask(task) {
      return new Promise((resolve, reject) => {
        queue.push({ task, resolve, reject });
        runNext();
      });
    };
  }

  function forEachFaviconCard(config, callback) {
    for (const group of config.groups || []) {
      for (const subgroup of group.subgroups || []) {
        for (const card of subgroup.cards || []) {
          if (card.url && card.iconType === 'favicon') {
            callback(card);
          }
        }
      }
    }
  }

  function parseHttpUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      return url;
    } catch {
      return null;
    }
  }

  function getCacheKey(url) {
    return url.hostname.toLowerCase();
  }

  function ensureCache(config) {
    config._faviconCache = config._faviconCache || {};
    return config._faviconCache;
  }

  function normalizeCacheEntry(entry) {
    if (!entry) return null;

    if (typeof entry === 'string') {
      return {
        status: 'success',
        value: entry,
        legacy: true
      };
    }

    if (entry.value) {
      return {
        status: entry.status || 'success',
        value: entry.value,
        fetchedAt: Number(entry.fetchedAt || entry.updatedAt || 0),
        failedAt: Number(entry.failedAt || 0),
        nextRetryAt: Number(entry.nextRetryAt || 0),
        source: entry.source || '',
        sourceUrl: entry.sourceUrl || ''
      };
    }

    return {
      status: entry.status || 'miss',
      fetchedAt: Number(entry.fetchedAt || entry.updatedAt || 0),
      failedAt: Number(entry.failedAt || 0),
      nextRetryAt: Number(entry.nextRetryAt || 0),
      error: entry.error || ''
    };
  }

  function getCachedValue(entry) {
    return isDataImageUrl(entry?.value) ? entry.value : '';
  }

  function shouldFetch(entry) {
    if (!entry) return true;
    if (entry.legacy) return false;

    const now = Date.now();
    if (entry.nextRetryAt && entry.nextRetryAt > now) return false;

    const value = getCachedValue(entry);
    if (value) {
      const fetchedAt = Number(entry.fetchedAt || 0);
      return !fetchedAt || now - fetchedAt > SUCCESS_TTL_MS;
    }

    const failedAt = Number(entry.failedAt || entry.fetchedAt || 0);
    return !failedAt || now - failedAt > FAILURE_TTL_MS;
  }

  function createSuccessEntry(value, metadata = {}) {
    return {
      status: 'success',
      value,
      fetchedAt: Date.now(),
      source: metadata.source || 'direct',
      sourceUrl: metadata.sourceUrl || '',
      mimeType: metadata.mimeType || ''
    };
  }

  function createFailureEntry(previousEntry, error) {
    const now = Date.now();
    const previousValue = getCachedValue(previousEntry);

    if (previousValue) {
      return {
        ...previousEntry,
        status: 'success',
        value: previousValue,
        failedAt: now,
        nextRetryAt: now + FAILURE_TTL_MS,
        error: error?.message || 'Favicon fetch failed'
      };
    }

    return {
      status: 'miss',
      failedAt: now,
      nextRetryAt: now + FAILURE_TTL_MS,
      error: error?.message || 'Favicon fetch failed'
    };
  }

  function isDataImageUrl(value) {
    return typeof value === 'string' && /^data:image\//i.test(value);
  }

  function clearCardFaviconValue(card) {
    if (card?.iconType === 'favicon' && card.iconValue) {
      card.iconValue = '';
    }
  }

  function canUseRuntimeBridge() {
    return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.sendMessage);
  }

  return {
    fetchAndCache,
    fetchAllForConfig,
    fetchForDomain,
    getCachedForUrl,
    migrateCardFaviconToCache,
    migrateConfig
  };
})();
