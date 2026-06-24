/**
 * 小分组（文件夹）组件 - 渲染 & 事件处理
 */
const SubgroupComponent = (() => {
  /**
   * 渲染小分组 HTML
   */
  function render(subgroup, config) {
    const modeClass = subgroup.displayMode === 'compact' ? 'compact' : 'comfortable';
    const emptyClass = subgroup.cards.length === 0 ? 'empty' : '';
    const cardsHtml = subgroup.cards
      .sort((a, b) => a.order - b.order)
      .map(card => CardComponent.render(card, subgroup.displayMode, config))
      .join('');

    return `
      <div class="subgroup ${modeClass} ${emptyClass}"
           data-subgroup-id="${subgroup.id}"
           draggable="true">
        <div class="subgroup-header">
          <span class="subgroup-icon">${subgroup.icon || '📁'}</span>
          <span class="subgroup-name" data-subgroup-name="${subgroup.id}">${Icons.escapeHtml(subgroup.name)}</span>
          <div class="subgroup-actions">
            <button class="subgroup-action-btn"
                    data-action="add-card"
                    data-subgroup-id="${subgroup.id}"
                    title="添加卡片">＋</button>
            <button class="subgroup-action-btn"
                    data-action="move-subgroup"
                    data-subgroup-id="${subgroup.id}"
                    title="移动到其他分组">↗</button>
            <button class="subgroup-action-btn"
                    data-action="edit-subgroup"
                    data-subgroup-id="${subgroup.id}"
                    title="编辑">✎</button>
          </div>
        </div>
        <div class="subgroup-cards" data-subgroup-cards="${subgroup.id}">
          ${cardsHtml}
        </div>
      </div>`;
  }

  /**
   * 设置拖拽事件（小分组级别）
   */
  function setupDragEvents(subgroupEl, subgroup) {
    subgroupEl.addEventListener('dragstart', (e) => {
      // 如果拖拽的是卡片，不要冒泡处理
      if (e.target.closest('.card')) return;

      e.dataTransfer.setData('text/plain', JSON.stringify({
        type: 'subgroup',
        subgroupId: subgroup.id
      }));
      e.dataTransfer.effectAllowed = 'move';
      subgroupEl.classList.add('dragging');
    });

    subgroupEl.addEventListener('dragend', () => {
      subgroupEl.classList.remove('dragging');
    });

    subgroupEl.addEventListener('dragover', (e) => {
      if (e.target.closest('.card')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });

    subgroupEl.addEventListener('dragenter', (e) => {
      if (e.target.closest('.card')) return;
      e.preventDefault();
      subgroupEl.classList.add('drag-over');
    });

    subgroupEl.addEventListener('dragleave', () => {
      subgroupEl.classList.remove('drag-over');
    });
  }

  return {
    render,
    setupDragEvents
  };
})();
