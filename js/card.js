/**
 * 卡片组件 - 渲染 & 事件处理
 */
const CardComponent = (() => {
  /**
   * 渲染卡片 HTML
   */
  function render(card, displayMode, config) {
    const iconHtml = Icons.renderCardIcon(card, config);
    const modeClass = displayMode === 'compact' ? 'compact' : 'comfortable';
    return `
      <div class="card ${modeClass}"
           data-card-id="${card.id}"
           draggable="true"
           title="${Icons.escapeHtml(card.name)}&#10;${Icons.escapeHtml(card.url)}">
        <div class="card-icon">${iconHtml}</div>
        <span class="card-name">${Icons.escapeHtml(card.name)}</span>
      </div>`;
  }

  /**
   * 处理卡片点击 - 在新标签页打开 URL
   */
  function handleClick(card) {
    if (!card.url) return;
    // 校验 URL
    if (/^https?:\/\/.+/.test(card.url)) {
      chrome.tabs.create({ url: card.url, active: true });
    }
  }

  /**
   * 处理中键点击 - 后台打开
   */
  function handleMiddleClick(e, card) {
    if (e.button === 1 && card.url && /^https?:\/\/.+/.test(card.url)) {
      e.preventDefault();
      chrome.tabs.create({ url: card.url, active: false });
    }
  }

  /**
   * 设置拖拽事件
   */
  function setupDragEvents(cardEl, card) {
    cardEl.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', JSON.stringify({
        type: 'card',
        cardId: card.id
      }));
      e.dataTransfer.effectAllowed = 'move';
      cardEl.classList.add('dragging');
    });

    cardEl.addEventListener('dragend', () => {
      cardEl.classList.remove('dragging');
    });

    cardEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });

    cardEl.addEventListener('dragenter', (e) => {
      e.preventDefault();
      cardEl.classList.add('drag-over');
    });

    cardEl.addEventListener('dragleave', () => {
      cardEl.classList.remove('drag-over');
    });
  }

  return {
    render,
    handleClick,
    handleMiddleClick,
    setupDragEvents
  };
})();
