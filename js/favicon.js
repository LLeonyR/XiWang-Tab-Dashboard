/**
 * Favicon 自动获取 & 缓存
 * 缓存策略：获取到的图标永久缓存在本地，下次直接加载缓存。
 * 如果没有缓存，则在打开时自动获取一次。
 * Emoji 图标直接渲染，无需获取。
 */
const Favicons = (() => {
  /**
   * 获取并缓存 favicon
   * 使用 favicon.im 服务获取 favicon，缓存 base64 到 storage
   */
  async function fetchAndCache(config, card) {
    if (!card.url || card.iconType !== 'favicon') return;

    try {
      const domain = new URL(card.url).hostname;
      if (!domain) return;

      const cache = config._faviconCache || {};

      // 检查缓存（永久有效，兼容旧格式字符串和新格式对象）
      if (cache[domain]) {
        const entry = cache[domain];

        if (typeof entry === 'string' && entry) {
          card.iconValue = entry;
          return;
        }

        if (entry && entry.value) {
          card.iconValue = entry.value;
          return;
        }
      }

      // favicon.im 在当前网络环境下比 Google S2 更稳定
      const faviconUrl = `https://favicon.im/${encodeURIComponent(domain)}?larger=true`;

      // 尝试加载图片并转为 base64
      const base64 = await loadImageAsBase64(faviconUrl);
      if (base64) {
        cache[domain] = base64;
        card.iconValue = base64;
        config._faviconCache = cache;
      }
    } catch (error) {
      // favicon 获取失败，静默处理
      console.debug('Favicon fetch failed for', card.url, error);
    }
  }

  /**
   * 批量获取 favicon
   * 处理所有 iconType === 'favicon' 的卡片：
   * - 有缓存：直接使用缓存
   * - 无缓存：从 favicon.im 获取并永久缓存
   */
  async function fetchAllForConfig(config) {
    const promises = [];
    for (const group of config.groups) {
      for (const subgroup of group.subgroups) {
        for (const card of subgroup.cards) {
          if (card.url && card.iconType === 'favicon') {
            promises.push(fetchAndCache(config, card));
          }
        }
      }
    }
    await Promise.allSettled(promises);
  }

  /**
   * 将图片 URL 加载为 base64
   */
  async function loadImageAsBase64(url) {
    try {
      const response = await fetch(url);
      if (!response.ok) return null;

      const blob = await response.blob();
      if (!blob.type.startsWith('image/')) return null;

      return await blobToDataUrl(blob);
    } catch {
      return null;
    }
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  }

  /**
   * 根据域名获取 favicon（优先读缓存，缓存无则从网络获取）
   * 用于编辑器弹窗实时预览
   */
  async function fetchForDomain(url, config) {
    try {
      const domain = new URL(url).hostname;
      if (!domain) return null;

      // 优先读缓存
      if (config) {
        const cache = config._faviconCache || {};
        const entry = cache[domain];
        if (typeof entry === 'string' && entry) return entry;
        if (entry && entry.value) return entry.value;
      }

      // 网络获取
      const faviconUrl = `https://favicon.im/${encodeURIComponent(domain)}?larger=true`;
      const base64 = await loadImageAsBase64(faviconUrl);
      if (base64 && config) {
        config._faviconCache = config._faviconCache || {};
        config._faviconCache[domain] = base64;
      }
      return base64;
    } catch {
      return null;
    }
  }

  return {
    fetchAndCache,
    fetchAllForConfig,
    fetchForDomain
  };
})();
