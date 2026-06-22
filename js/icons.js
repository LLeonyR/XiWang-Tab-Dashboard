/**
 * 图标处理：Emoji / Favicon / 自定义图片渲染
 */
const Icons = (() => {
  const DEFAULT_ICON = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;

  /**
   * 渲染卡片图标为 HTML 字符串
   */
  function renderCardIcon(card) {
    switch (card.iconType) {
      case 'emoji':
        return `<span class="emoji-icon">${escapeHtml(card.iconValue || '🌐')}</span>`;
      case 'favicon':
        return renderFaviconImg(card);
      case 'custom':
        if (card.iconValue) {
          return `<img src="${escapeHtml(card.iconValue)}" alt="" loading="lazy" onerror="this.parentElement.innerHTML='${DEFAULT_ICON.replace(/'/g, "\\'")}'">`;
        }
        return DEFAULT_ICON;
      default:
        return DEFAULT_ICON;
    }
  }

  /**
   * 渲染 favicon 图片
   */
  function renderFaviconImg(card) {
    if (card.iconValue) {
      return `<img src="${escapeHtml(card.iconValue)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='block';">
        <span class="emoji-icon" style="display:none">🌐</span>`;
    }
    // 没有缓存的 favicon，尝试自动获取
    try {
      const domain = new URL(card.url).hostname;
      const googleFavicon = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
      return `<img src="${googleFavicon}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='block';">
        <span class="emoji-icon" style="display:none">🌐</span>`;
    } catch {
      return `<span class="emoji-icon">🌐</span>`;
    }
  }

  /**
   * 生成用于选择器的 Emoji 列表
   */
  function getEmojiList() {
    return [
      '⭐', '📁', '📂', '🛠️', '💻', '🎨', '📝',
      '💼', '🏠', '📚', '🎮', '🎵', '🎬', '📷',
      '💬', '📧', '🌐', '🔧', '⚙️', '🔍', '📊',
      '🗂️', '📌', '🔖', '🏷️', '💡', '🔥', '❤️',
      '🚀', '🎯', '📱', '🖥️', '⌨️', '🖱️', '📡',
      '🗄️', '📋', '📎', '✂️', '📏', '🧰', '🔬',
      '🧪', '📐', '✏️', '🖊️', '🖍️', '📔', '📕',
      '📗', '📘', '📙', '🔗', '🌍', '🌎', '🌏'
    ];
  }

  /**
   * HTML 转义（防止 XSS）
   */
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  return {
    DEFAULT_ICON,
    renderCardIcon,
    renderFaviconImg,
    getEmojiList,
    escapeHtml
  };
})();
