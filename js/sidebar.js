/**
 * 侧边栏组件 - 左侧分组导航 & 切换
 */
const SidebarComponent = (() => {
  let currentActiveId = null;
  let wheelTimer = null;

  /**
   * 渲染侧边栏分组列表
   */
  function render(groups, activeGroupId) {
    const groupList = document.getElementById('groupList');
    if (!groupList) return;

    const sorted = [...groups].sort((a, b) => a.order - b.order);
    currentActiveId = activeGroupId;

    groupList.innerHTML = `${sorted.map(group => `
      <div class="group-item ${group.id === activeGroupId ? 'active' : ''}"
           data-group-id="${group.id}"
           title="${Icons.escapeHtml(group.name)}"
           draggable="true">
        <span class="group-item-icon">${group.icon || '📂'}</span>
        <span class="group-item-name">${Icons.escapeHtml(group.name)}</span>
      </div>
    `).join('')}
      <button id="addGroupBtn" class="sidebar-add-btn" title="添加类别">＋</button>
    `;

    // 设置分组拖拽事件
    setupGroupDragEvents();

    // 滚动到激活的分组
    if (activeGroupId) {
      const activeEl = groupList.querySelector(`[data-group-id="${activeGroupId}"]`);
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'center', behavior: 'instant' });
      }
    }
  }

  /**
   * 初始化滚轮检测（只调用一次）
   * 使用节流而非 IntersectionObserver 避免循环触发
   */
  function initWheelDetection() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    sidebar.addEventListener('wheel', (e) => {
      e.preventDefault();

      // 节流：300ms 内只响应一次
      if (wheelTimer) return;

      wheelTimer = setTimeout(() => {
        wheelTimer = null;
      }, 300);

      // 找到下一个或上一个分组
      const groupList = document.getElementById('groupList');
      const items = Array.from(groupList.querySelectorAll('.group-item'));
      if (items.length === 0) return;

      const activeIdx = items.findIndex(item => item.classList.contains('active'));
      let targetIdx = activeIdx;

      if (e.deltaY > 0 && activeIdx < items.length - 1) {
        targetIdx = activeIdx + 1;
      } else if (e.deltaY < 0 && activeIdx > 0) {
        targetIdx = activeIdx - 1;
      } else {
        return; // 没有变化
      }

      const targetItem = items[targetIdx];
      const groupId = targetItem.dataset.groupId;

      if (groupId && groupId !== currentActiveId) {
        document.dispatchEvent(new CustomEvent('group-change', {
          detail: { groupId }
        }));
      }
    }, { passive: false });
  }

  /**
   * 高亮指定分组（只更新 DOM 类名，不触发重渲染）
   */
  function highlightGroup(groupId) {
    const groupList = document.getElementById('groupList');
    if (!groupList) return;

    groupList.querySelectorAll('.group-item').forEach(item => {
      item.classList.toggle('active', item.dataset.groupId === groupId);
    });
    currentActiveId = groupId;
  }

  /**
   * 设置分组拖拽事件
   */
  function setupGroupDragEvents() {
    const groupList = document.getElementById('groupList');
    if (!groupList) return;

    groupList.querySelectorAll('.group-item').forEach(item => {
      item.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', JSON.stringify({
          type: 'group',
          groupId: item.dataset.groupId
        }));
        e.dataTransfer.effectAllowed = 'move';
        item.classList.add('dragging');
      });

      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
      });
    });
  }

  return {
    render,
    initWheelDetection,
    highlightGroup,
    destroy: () => {}
  };
})();
