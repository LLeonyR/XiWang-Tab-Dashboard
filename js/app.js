/**
 * 应用入口 - 初始化 & 事件编排
 */
(async function App() {
  'use strict';

  let config = null;
  let deleteTimer = null;
  let deleteInfo = null;

  // ========== 初始化 ==========

  async function init() {
    // 加载配置
    config = await Storage.loadConfig();

    // 首次使用，加载示例数据
    if (!config.groups || config.groups.length === 0) {
      config = getDefaultSampleConfig();
      await Storage.saveConfig(config);
    }

    // 渲染页面
    Renderer.renderAll(config);

    // 初始化侧边栏滚轮检测（只调用一次）
    SidebarComponent.initWheelDetection();

    // 绑定全局事件
    bindGlobalEvents();

    // 监听存储变化（多标签页同步）
    Storage.onConfigChanged((newConfig) => {
      config = newConfig;
      Renderer.renderAll(config);
    });

    // 延迟加载 favicon（非阻塞）
    const scheduleTask = typeof requestIdleCallback !== 'undefined'
      ? requestIdleCallback
      : (fn) => setTimeout(fn, 100);

    scheduleTask(() => {
      Favicons.fetchAllForConfig(config).then(() => {
        Renderer.refreshContent();
        Storage.saveConfig(config);
      });
    });
  }

  // ========== 全局事件绑定 ==========

  function bindGlobalEvents() {
    // 添加分组
    document.getElementById('addGroupBtn').addEventListener('click', async () => {
      const group = await Editor.addGroup();
      if (group) {
        // 自动切换到新分组
        config.settings.activeGroupId = group.id;
        Renderer.renderAll(config);
        Storage.saveConfig(config);
      }
    });

    // 添加小分组
    document.getElementById('addSubgroupBtn').addEventListener('click', async () => {
      const curGroup = Renderer.getCurrentGroup();
      if (!curGroup) {
        // 没有分组时，先创建分组
        const group = await Editor.addGroup();
        if (group) {
          config.settings.activeGroupId = group.id;
          Renderer.renderAll(config);
          Storage.saveConfig(config);
        }
        return;
      }

      const subgroup = await Editor.addSubgroup(curGroup.id);
      if (subgroup) {
        Renderer.refreshContent();
        Storage.saveConfig(config);
      }
    });

    // 分组切换（IntersectionObserver 触发）
    document.addEventListener('group-change', (e) => {
      const { groupId } = e.detail;
      if (groupId && groupId !== config.settings.activeGroupId) {
        Renderer.switchGroup(groupId);
      }
    });

    // 侧边栏点击事件（点击切换分组）
    document.getElementById('groupList').addEventListener('click', (e) => {
      const groupItem = e.target.closest('.group-item');
      if (groupItem) {
        const groupId = groupItem.dataset.groupId;
        if (groupId && groupId !== config.settings.activeGroupId) {
          Renderer.switchGroup(groupId);
        }
      }
    });

    // 右键菜单
    document.addEventListener('contextmenu', handleContextMenu);

    // 点击其他地方关闭右键菜单
    document.addEventListener('click', (e) => {
      const menu = document.getElementById('contextMenu');
      if (!menu.contains(e.target)) {
        menu.classList.add('hidden');
      }
    });

    // 侧边栏分组拖拽排序
    setupSidebarDragSort();

    // 内容区拖拽排序
    setupContentDragSort();

    // 键盘快捷键
    document.addEventListener('keydown', handleKeyboard);

    // 工具栏
    bindToolbarEvents();
  }

  // ========== 右键菜单 ==========

  function handleContextMenu(e) {
    e.preventDefault();

    const cardEl = e.target.closest('.card');
    const subgroupEl = e.target.closest('.subgroup');
    const groupItemEl = e.target.closest('.group-item');

    let menuItems = [];

    if (cardEl) {
      const cardId = cardEl.dataset.cardId;
      const card = findCardById(config, cardId);
      if (card) {
        menuItems = [
          { label: '✎ 编辑卡片', action: () => editCardMenu(card) },
          { label: '📋 复制 URL', action: () => copyToClipboard(card.url) },
          { label: '🗑 删除卡片', danger: true, action: () => deleteCardMenu(card) }
        ];
      }
    } else if (subgroupEl && !cardEl) {
      const subgroupId = subgroupEl.dataset.subgroupId;
      const subgroup = findSubgroupById(config, subgroupId);
      if (subgroup) {
        menuItems = [
          { label: '✎ 编辑小分组', action: () => editSubgroupMenu(subgroup) },
          { label: `⊞ 切换为${subgroup.displayMode === 'compact' ? '宽松' : '紧凑'}模式`, action: () => toggleSubgroupMode(subgroup) },
          { label: '🗑 删除小分组', danger: true, action: () => deleteSubgroupMenu(subgroup) }
        ];
      }
    } else if (groupItemEl) {
      const groupId = groupItemEl.dataset.groupId;
      const group = findGroup(config, groupId);
      if (group) {
        menuItems = [
          { label: '✎ 编辑分组', action: () => editGroupMenu(group) },
          { label: '🗑 删除分组', danger: true, action: () => deleteGroupMenu(group) }
        ];
      }
    }

    if (menuItems.length > 0) {
      showContextMenu(e.clientX, e.clientY, menuItems);
    }
  }

  function showContextMenu(x, y, items) {
    const menu = document.getElementById('contextMenu');
    menu.innerHTML = items.map((item, index) => `
      ${index > 0 && items[index - 1].danger !== item.danger ? '<div class="context-menu-divider"></div>' : ''}
      <div class="context-menu-item ${item.danger ? 'danger' : ''}" data-index="${index}">
        ${item.label}
      </div>
    `).join('');

    menu.classList.remove('hidden');

    // 调整位置，避免超出视口
    const menuW = 170;
    const menuH = items.length * 36 + 20;
    menu.style.left = Math.min(x, window.innerWidth - menuW) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - menuH) + 'px';

    // 绑定点击
    menu.querySelectorAll('.context-menu-item').forEach(el => {
      el.addEventListener('click', () => {
        menu.classList.add('hidden');
        const idx = parseInt(el.dataset.index);
        if (items[idx]) items[idx].action();
      });
    });
  }

  // ========== 右键菜单操作 ==========

  async function editCardMenu(card) {
    const result = await Editor.editCard(config.settings.activeGroupId,
      findSubgroupIdForCard(config, card.id), card.id);
    if (result) {
      Renderer.refreshContent();
      Storage.saveConfig(config);
    }
  }

  async function deleteCardMenu(card) {
    const subgroupId = findSubgroupIdForCard(config, card.id);
    const deleted = Editor.deleteItem(config, 'card', config.settings.activeGroupId, subgroupId, card.id);
    if (deleted) {
      Renderer.refreshContent();
      Storage.saveConfig(config);
      showUndoToast('卡片', () => {
        Editor.restoreDelete(config, 'card', config.settings.activeGroupId, subgroupId, deleted);
        Renderer.refreshContent();
        Storage.saveConfig(config);
      });
    }
  }

  async function editSubgroupMenu(subgroup) {
    const result = await Editor.editSubgroup(config.settings.activeGroupId, subgroup.id);
    if (result) {
      Renderer.refreshContent();
      Storage.saveConfig(config);
    }
  }

  async function deleteSubgroupMenu(subgroup) {
    const subgroupId = subgroup.id;
    const deleted = Editor.deleteItem(config, 'subgroup', config.settings.activeGroupId, null, subgroupId);
    if (deleted) {
      Renderer.refreshContent();
      Storage.saveConfig(config);
      showUndoToast('小分组', () => {
        Editor.restoreDelete(config, 'subgroup', config.settings.activeGroupId, null, deleted);
        Renderer.refreshContent();
        Storage.saveConfig(config);
      });
    }
  }

  function toggleSubgroupMode(subgroup) {
    subgroup.displayMode = subgroup.displayMode === 'compact' ? 'comfortable' : 'compact';
    subgroup.updatedAt = now();
    Renderer.refreshContent();
    Storage.saveConfig(config);
  }

  async function editGroupMenu(group) {
    const result = await Editor.editGroup(group);
    if (result) {
      Renderer.renderAll(config);
      Storage.saveConfig(config);
    }
  }

  async function deleteGroupMenu(group) {
    if (config.groups.length <= 1) {
      showToast('至少需要保留一个分组');
      return;
    }
    const deleted = Editor.deleteItem(config, 'group', null, null, group.id);
    if (deleted) {
      // 如果删除的是当前激活分组，切换到第一个
      if (config.settings.activeGroupId === group.id) {
        config.settings.activeGroupId = config.groups[0]?.id || null;
      }
      Renderer.renderAll(config);
      Storage.saveConfig(config);
      showUndoToast('分组', () => {
        Editor.restoreDelete(config, 'group', null, null, deleted);
        Renderer.renderAll(config);
        Storage.saveConfig(config);
      });
    }
  }

  // ========== 拖拽排序 ==========

  function setupSidebarDragSort() {
    const groupList = document.getElementById('groupList');

    groupList.addEventListener('dragover', (e) => {
      e.preventDefault();
      const target = e.target.closest('.group-item');
      if (target) {
        target.style.transform = 'scale(1.1)';
      }
    });

    groupList.addEventListener('dragleave', (e) => {
      const target = e.target.closest('.group-item');
      if (target) {
        target.style.transform = '';
      }
    });

    groupList.addEventListener('drop', (e) => {
      e.preventDefault();
      groupList.querySelectorAll('.group-item').forEach(el => {
        el.style.transform = '';
      });

      const target = e.target.closest('.group-item');
      if (!target) return;

      let dragData;
      try {
        dragData = JSON.parse(e.dataTransfer.getData('text/plain'));
      } catch {
        return;
      }

      if (!dragData || dragData.type !== 'group') return;

      const targetGroupId = target.dataset.groupId;
      const draggedGroupId = dragData.groupId;

      if (targetGroupId === draggedGroupId) return;

      const fromIdx = config.groups.findIndex(g => g.id === draggedGroupId);
      const toIdx = config.groups.findIndex(g => g.id === targetGroupId);

      if (fromIdx !== -1 && toIdx !== -1) {
        config.groups = reorderArray(config.groups, fromIdx, toIdx);
        Renderer.renderAll(config);
        Storage.saveConfig(config);
      }
    });
  }

  function setupContentDragSort() {
    const grid = document.getElementById('subgroupGrid');

    grid.addEventListener('drop', (e) => {
      const targetSubgroup = e.target.closest('.subgroup');
      if (!targetSubgroup) return;

      // 如果是在卡片上的 drop，由 renderer 的卡片拖拽处理
      if (e.target.closest('.card')) return;

      let dragData;
      try {
        dragData = JSON.parse(e.dataTransfer.getData('text/plain'));
      } catch {
        return;
      }

      if (!dragData || dragData.type !== 'subgroup') return;

      const targetId = targetSubgroup.dataset.subgroupId;
      const draggedId = dragData.subgroupId;
      if (targetId === draggedId) return;

      const curGroup = Renderer.getCurrentGroup();
      if (!curGroup) return;

      const fromIdx = curGroup.subgroups.findIndex(sg => sg.id === draggedId);
      const toIdx = curGroup.subgroups.findIndex(sg => sg.id === targetId);

      if (fromIdx !== -1 && toIdx !== -1) {
        curGroup.subgroups = reorderArray(curGroup.subgroups, fromIdx, toIdx);
        Renderer.refreshContent();
        Storage.saveConfig(config);
      }
    });
  }

  // ========== 键盘快捷键 ==========

  function handleKeyboard(e) {
    // Esc 关闭右键菜单
    if (e.key === 'Escape') {
      document.getElementById('contextMenu').classList.add('hidden');
    }
  }

  // ========== 工具栏 ==========

  function bindToolbarEvents() {
    // 导出
    document.getElementById('exportBtn').addEventListener('click', async () => {
      await Storage.exportConfig();
      showToast('配置已导出');
    });

    // 导入
    const importFile = document.getElementById('importFile');
    document.getElementById('importBtn').addEventListener('click', () => {
      importFile.click();
    });

    importFile.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const newConfig = await Storage.importConfig(file);
        config = newConfig;
        Renderer.renderAll(config);
        showToast('配置已导入');
      } catch (error) {
        showToast('导入失败：' + error.message);
      }
      importFile.value = '';
    });

    // 主题切换
    const themeBtn = document.getElementById('themeBtn');
    // 初始化主题
    applyTheme(config.settings.theme);

    themeBtn.addEventListener('click', () => {
      const themes = ['auto', 'light', 'dark'];
      const currentIdx = themes.indexOf(config.settings.theme);
      const nextTheme = themes[(currentIdx + 1) % themes.length];
      config.settings.theme = nextTheme;
      applyTheme(nextTheme);
      Storage.saveConfig(config);

      const labels = { auto: '🌓', light: '☀️', dark: '🌙' };
      const iconSpan = themeBtn.querySelector('.toolbar-btn-icon');
      if (iconSpan) {
        iconSpan.textContent = labels[nextTheme];
      }
    });

    // 设置初始图标
    const labels = { auto: '🌓', light: '☀️', dark: '🌙' };
    const initIconSpan = themeBtn.querySelector('.toolbar-btn-icon');
    if (initIconSpan) {
      initIconSpan.textContent = labels[config.settings.theme] || '🌓';
    }
  }

  function applyTheme(theme) {
    if (theme === 'auto') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }

  // ========== Toast 提示 ==========

  function showToast(message, duration = 2000) {
    const toast = document.getElementById('toast');
    toast.innerHTML = `<span>${message}</span>`;
    toast.classList.remove('hidden');

    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
      toast.classList.add('hidden');
    }, duration);
  }

  // 暴露到全局作用域供其他模块使用
  window.showToast = showToast;

  function showUndoToast(itemName, undoCallback) {
    const toast = document.getElementById('toast');
    toast.innerHTML = `
      <span>已删除${itemName}</span>
      <span class="toast-undo" id="toastUndo">撤销</span>
    `;
    toast.classList.remove('hidden');

    document.getElementById('toastUndo').addEventListener('click', () => {
      undoCallback();
      toast.classList.add('hidden');
    });

    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
      toast.classList.add('hidden');
    }, 5000);
  }

  // ========== 工具函数 ==========

  function findCardById(config, cardId) {
    for (const group of config.groups) {
      for (const sg of group.subgroups) {
        const card = sg.cards.find(c => c.id === cardId);
        if (card) return card;
      }
    }
    return null;
  }

  function findSubgroupById(config, subgroupId) {
    for (const group of config.groups) {
      const sg = group.subgroups.find(s => s.id === subgroupId);
      if (sg) return sg;
    }
    return null;
  }

  function findSubgroupIdForCard(config, cardId) {
    for (const group of config.groups) {
      for (const sg of group.subgroups) {
        if (sg.cards.find(c => c.id === cardId)) return sg.id;
      }
    }
    return null;
  }

  function copyToClipboard(text) {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      showToast('URL 已复制到剪贴板');
    }).catch(() => {
      showToast('复制失败');
    });
  }

  // ========== 启动 ==========
  init();
})();
