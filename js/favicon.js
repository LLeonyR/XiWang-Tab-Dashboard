/**
 * Favicon 自动获取 & 缓存
 */
const Favicons = (() => {
  /**
   * 获取并缓存 favicon
   * 使用 Google S2 服务获取 favicon，缓存 base64 到 storage
   */
  async function fetchAndCache(config, card) {
    if (!card.url) return;

    try {
      const domain = new URL(card.url).hostname;
      const cache = config._faviconCache || {};

      // 已有缓存则直接使用
      if (cache[domain]) {
        card.iconValue = cache[domain];
        card.iconType = 'favicon';
        return;
      }

      // Google S2 favicon 服务
      const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;

      // 尝试加载图片
      const base64 = await loadImageAsBase64(faviconUrl);
      if (base64) {
        cache[domain] = base64;
        card.iconValue = base64;
        card.iconType = 'favicon';
        config._faviconCache = cache;
      }
    } catch (error) {
      // favicon 获取失败，静默处理
      console.debug('Favicon fetch failed for', card.url, error);
    }
  }

  /**
   * 批量获取 favicon
   */
  async function fetchAllForConfig(config) {
    const promises = [];
    for (const group of config.groups) {
      for (const subgroup of group.subgroups) {
        for (const card of subgroup.cards) {
          if (card.url && card.iconType === 'favicon' && !card.iconValue) {
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
  function loadImageAsBase64(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';

      const timeout = setTimeout(() => {
        img.src = '';
        resolve(null);
      }, 5000);

      img.onload = () => {
        clearTimeout(timeout);
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 32;
          canvas.height = 32;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, 32, 32);
          resolve(canvas.toDataURL('image/png'));
        } catch {
          resolve(null);
        }
      };

      img.onerror = () => {
        clearTimeout(timeout);
        resolve(null);
      };

      img.src = url;
    });
  }

  return {
    fetchAndCache,
    fetchAllForConfig
  };
})();
