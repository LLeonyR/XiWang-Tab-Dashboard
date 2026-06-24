/**
 * 应用入口 - 初始化 & 事件编排
 */
(async function App() {
  'use strict';

  let config = null;
  let deleteTimer = null;
  let deleteInfo = null;
  let activeSyncAbort = null;
  let clockTimer = null;
  let worldClockCountries = null;

  // ========== 初始化 ==========

  async function init() {
    // 加载配置
    config = await Storage.loadConfig();
    if (typeof Favicons !== 'undefined' && Favicons.migrateConfig(config)) {
      await Storage.saveConfig(config, { markDirty: false });
    }

    // 首次使用，加载示例数据
    if (!config.groups || config.groups.length === 0) {
      config = getDefaultSampleConfig();
      if (typeof Favicons !== 'undefined') Favicons.migrateConfig(config);
      await Storage.saveConfig(config, { markDirty: false });
    }

    // 渲染页面
    Renderer.renderAll(config);

    // 初始化侧边栏滚轮检测（只调用一次）
    SidebarComponent.initWheelDetection();

    // 绑定全局事件
    bindGlobalEvents();
    startToolbarClock();

    // 监听存储变化（多标签页同步）
    Storage.onConfigChanged((newConfig) => {
      config = newConfig;
      applyTheme(config.settings.theme);
      updateThemeButtonIcon(config.settings.theme);
      updateToolbarClock();
      updateWorldClockBar();
      Renderer.renderAll(config);
    });

    // 延迟加载 favicon（非阻塞）
    const scheduleTask = typeof requestIdleCallback !== 'undefined'
      ? requestIdleCallback
      : (fn) => setTimeout(fn, 100);

    scheduleTask(refreshFavicons);
  }

  // ========== 全局事件绑定 ==========

  function bindGlobalEvents() {
    async function handleAddGroup() {
      const group = await Editor.addGroup();
      if (group) {
        // 自动切换到新类别
        addVisibleGroup(group.id);
        config.settings.activeGroupId = group.id;
        Renderer.renderAll(config);
        Storage.saveConfig(config);
      }
    }

    // 配置
    document.getElementById('settingsBtn').addEventListener('click', openSettingsModal);
    document.getElementById('appSettingsBtn').addEventListener('click', openAppSettingsModal);

    // 添加分组
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
      const addButton = e.target.closest('#addGroupBtn');
      if (addButton) {
        handleAddGroup();
        return;
      }

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
          { label: '✎ 编辑分组', action: () => editSubgroupMenu(subgroup) },
          { label: `⊞ 切换为${subgroup.displayMode === 'compact' ? '宽松' : '紧凑'}模式`, action: () => toggleSubgroupMode(subgroup) },
          { label: '🗑 删除分组', danger: true, action: () => deleteSubgroupMenu(subgroup) }
        ];
      }
    } else if (groupItemEl) {
      const groupId = groupItemEl.dataset.groupId;
      const group = findGroup(config, groupId);
      if (group) {
        menuItems = [
          { label: '✎ 编辑类别', action: () => editGroupMenu(group) },
          { label: '🗑 删除类别', danger: true, action: () => deleteGroupMenu(group) }
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
      showUndoToast('分组', () => {
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
      showToast('至少需要保留一个类别');
      return;
    }
    const deleted = Editor.deleteItem(config, 'group', null, null, group.id);
    if (deleted) {
      removeVisibleGroup(group.id);
      // 如果删除的是当前激活类别，切换到第一个
      if (config.settings.activeGroupId === group.id) {
        config.settings.activeGroupId = config.groups[0]?.id || null;
      }
      Renderer.renderAll(config);
      Storage.saveConfig(config);
      showUndoToast('类别', () => {
        Editor.restoreDelete(config, 'group', null, null, deleted);
        addVisibleGroup(deleted.id);
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

  function startToolbarClock() {
    updateToolbarClock();
    updateWorldClockBar();
    if (clockTimer) {
      clearInterval(clockTimer);
    }
    clockTimer = setInterval(() => {
      updateToolbarClock();
      updateWorldClockBar();
    }, 1000);
  }

  function updateToolbarClock() {
    const clockEl = document.getElementById('toolbarClock');
    const timeEl = document.getElementById('toolbarTime');
    const weekdayEl = document.getElementById('toolbarWeekday');
    if (!clockEl || !timeEl || !weekdayEl) return;

    const now = new Date();
    clockEl.classList.remove('hidden');
    timeEl.textContent = now.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    weekdayEl.textContent = now.toLocaleDateString('zh-CN', {
      weekday: 'long'
    });
    clockEl.title = '本地时间';
  }

  function updateWorldClockBar() {
    const bar = document.getElementById('worldClockBar');
    if (!bar) return;

    const worldClock = getWorldClockSettings();
    if (!worldClock.enabled || worldClock.countryCodes.length === 0) {
      bar.classList.add('hidden');
      bar.innerHTML = '';
      return;
    }

    const now = new Date();
    const countries = getWorldClockCountries();
    const countryMap = new Map(countries.map(country => [country.code, country]));
    const items = worldClock.countryCodes
      .map(code => {
        const country = countryMap.get(code);
        if (!country) return null;

        const timeZone = getWorldClockTimeZone(code);
        return {
          code,
          name: country.name,
          timeZone,
          offset: getTimeZoneOffsetMinutes(now, timeZone)
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.offset - b.offset || a.name.localeCompare(b.name, 'zh-CN'))
      .map(item => {
        const time = formatWorldClockTime(now, item.code);

        return `
          <span class="world-clock-item" title="${Icons.escapeHtml(item.name)}">
            <span class="world-clock-item-name">${Icons.escapeHtml(item.name)}</span>
            <span class="world-clock-item-time">${time}</span>
          </span>
        `;
      });

    bar.innerHTML = items.join('');
    bar.classList.toggle('hidden', items.length === 0);
  }

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
        updateToolbarClock();
        updateWorldClockBar();
        showToast('配置已导入');
        refreshFavicons();
      } catch (error) {
        showToast('导入失败：' + error.message);
      }
      importFile.value = '';
    });

    // 主题切换
    const themeBtn = document.getElementById('themeBtn');
    // 初始化主题
    applyTheme(config.settings.theme);
    updateThemeButtonIcon(config.settings.theme);

    themeBtn.addEventListener('click', () => {
      const themes = ['auto', 'light', 'dark'];
      const currentIdx = themes.indexOf(config.settings.theme);
      const nextTheme = themes[(currentIdx + 1) % themes.length];
      config.settings.theme = nextTheme;
      applyTheme(nextTheme);
      Storage.saveConfig(config);
      updateThemeButtonIcon(nextTheme);
    });
  }

  function applyTheme(theme) {
    if (theme === 'auto') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }

  function refreshFavicons() {
    return Favicons.fetchAllForConfig(config).then(() => {
      Renderer.refreshContent();
      return Storage.saveConfig(config, { markDirty: false });
    });
  }

  function updateThemeButtonIcon(theme) {
    const labels = { auto: '🌓', light: '☀️', dark: '🌙' };
    const iconSpan = document.querySelector('#themeBtn .toolbar-btn-icon');
    if (iconSpan) {
      iconSpan.textContent = labels[theme] || '🌓';
    }
  }

  // ========== 设置 ==========

  async function openAppSettingsModal() {
    const modalBox = document.getElementById('modalBox');
    const confirmBtn = document.getElementById('modalConfirm');
    const oldConfirmText = confirmBtn.textContent;

    modalBox.classList.add('modal-box-settings');
    const modalPromise = Editor.showModal('设置', renderAppSettingsModal());
    confirmBtn.textContent = '保存';
    bindAppSettingsModalEvents();

    const result = await modalPromise;
    modalBox.classList.remove('modal-box-settings');
    confirmBtn.textContent = oldConfirmText;

    if (!result) return;

    const data = Editor.getCapturedFormData();
    config.settings.worldClock = {
      enabled: data.worldClockEnabled === 'on',
      countryCodes: Array.isArray(data.worldClockCountries) ? data.worldClockCountries : []
    };
    const visibleGroupIds = Array.isArray(data.visibleGroups) && data.visibleGroups.length > 0
      ? data.visibleGroups
      : config.groups.map(group => group.id);
    const groupOrder = Array.isArray(data.groupOrder) && data.groupOrder.length > 0
      ? data.groupOrder
      : config.groups.map(group => group.id);
    applyGroupDisplayOrder(groupOrder);
    config.settings.groupDisplay = {
      visibleGroupIds
    };

    Renderer.renderAll(config);
    await Storage.saveConfig(config);
    updateWorldClockBar();
    showToast('设置已保存');
  }

  function renderAppSettingsModal() {
    const worldClock = getWorldClockSettings();
    const groupDisplay = getGroupDisplaySettings();
    const countries = getWorldClockCountries();

    return `
      <div class="app-settings-layout">
        <aside class="app-settings-menu" aria-label="设置菜单">
          <button type="button" class="app-settings-menu-item active" data-settings-tab="worldClock">世界时钟</button>
          <button type="button" class="app-settings-menu-item" data-settings-tab="groupDisplay">分组显示</button>
        </aside>
        <section class="app-settings-content" data-settings-panel="worldClock">
          <div class="settings-section-header">
            <div>
              <div class="settings-section-title">世界时钟</div>
              <div class="settings-section-desc">配置世界时钟国家列表。</div>
            </div>
          </div>

          <label class="setting-row setting-row-switch">
            <span>
              <span class="setting-row-title">显示开关</span>
            </span>
            <span class="switch-control">
              <input id="worldClockEnabled" class="switch-input" type="checkbox" name="worldClockEnabled" ${worldClock.enabled ? 'checked' : ''}>
              <span class="switch-slider" aria-hidden="true"></span>
            </span>
          </label>

          <div id="worldClockCountryGroup" class="form-group ${worldClock.enabled ? '' : 'hidden'}">
            <div class="world-clock-country-header">
              <label class="form-label" for="worldClockCountrySearch">国家选择</label>
              <span id="worldClockSelectedCount" class="world-clock-selected-count"></span>
            </div>
            <div id="worldClockSelector" class="world-clock-selector">
              <div id="worldClockSelectedChips" class="world-clock-selected-chips"></div>
              <input id="worldClockCountrySearch" class="world-clock-search-input" type="search" placeholder="搜索国家或代码">
            </div>
            <div id="worldClockCountryList" class="world-clock-country-list">
              ${renderWorldClockCountryOptions(countries, worldClock.countryCodes)}
            </div>
            <div id="worldClockNoResults" class="world-clock-empty hidden">没有匹配的国家</div>
          </div>
        </section>
        <section class="app-settings-content hidden" data-settings-panel="groupDisplay">
          <div class="settings-section-header">
            <div>
              <div class="settings-section-title">分组显示</div>
              <div class="settings-section-desc">选择左侧导航和内容区中显示的分组。</div>
            </div>
          </div>

          <div class="group-display-list">
            ${renderGroupDisplayOptions(groupDisplay.visibleGroupIds)}
          </div>
        </section>
      </div>
    `;
  }

  function bindAppSettingsModalEvents() {
    const enabledInput = document.getElementById('worldClockEnabled');
    const countryGroup = document.getElementById('worldClockCountryGroup');
    const menuItems = document.querySelectorAll('[data-settings-tab]');
    const panels = document.querySelectorAll('[data-settings-panel]');

    if (enabledInput && countryGroup) {
      enabledInput.addEventListener('change', () => {
        countryGroup.classList.toggle('hidden', !enabledInput.checked);
      });
    }

    bindWorldClockCountrySearch();
    bindGroupDisplayDragSort();

    menuItems.forEach(item => {
      item.addEventListener('click', () => {
        const tab = item.dataset.settingsTab;
        menuItems.forEach(menuItem => menuItem.classList.toggle('active', menuItem === item));
        panels.forEach(panel => panel.classList.toggle('hidden', panel.dataset.settingsPanel !== tab));
      });
    });
  }

  function getWorldClockSettings() {
    const fallback = {
      enabled: true,
      countryCodes: ['CN']
    };
    const saved = config?.settings?.worldClock || {};
    const rawCountryCodes = Array.isArray(saved.countryCodes)
      ? saved.countryCodes
      : (saved.countryCode ? [saved.countryCode] : fallback.countryCodes);
    const countryCodes = normalizeCountryCodes(rawCountryCodes);

    return {
      ...fallback,
      ...saved,
      countryCodes
    };
  }

  function getGroupDisplaySettings() {
    const savedIds = config?.settings?.groupDisplay?.visibleGroupIds;
    const validIds = new Set((config.groups || []).map(group => group.id));
    const visibleGroupIds = Array.isArray(savedIds) && savedIds.length > 0
      ? savedIds.filter(id => validIds.has(id))
      : (config.groups || []).map(group => group.id);

    return { visibleGroupIds };
  }

  function renderGroupDisplayOptions(selectedGroupIds) {
    const selectedSet = new Set(selectedGroupIds);
    const groups = [...(config.groups || [])].sort((a, b) => a.order - b.order);

    if (groups.length === 0) {
      return '<div class="settings-empty-state">暂无分组</div>';
    }

    return groups.map(group => `
      <label class="group-display-option" draggable="true" data-group-display-item="${group.id}">
        <span class="group-display-drag-handle" title="拖动排序">⋮⋮</span>
        <input type="hidden" name="groupOrder[]" value="${group.id}">
        <input type="checkbox" name="visibleGroups[]" value="${group.id}" ${selectedSet.has(group.id) ? 'checked' : ''}>
        <span class="group-display-icon">${Icons.escapeHtml(group.icon || '📂')}</span>
        <span class="group-display-name">${Icons.escapeHtml(group.name)}</span>
      </label>
    `).join('');
  }

  function bindGroupDisplayDragSort() {
    const list = document.querySelector('.group-display-list');
    if (!list) return;

    let draggedItem = null;

    list.addEventListener('dragstart', (event) => {
      const item = event.target.closest('[data-group-display-item]');
      if (!item || event.target.closest('input')) {
        event.preventDefault();
        return;
      }

      draggedItem = item;
      item.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', item.dataset.groupDisplayItem);
    });

    list.addEventListener('dragend', () => {
      if (draggedItem) {
        draggedItem.classList.remove('dragging');
      }
      draggedItem = null;
      list.querySelectorAll('.group-display-option').forEach(item => item.classList.remove('drag-over'));
    });

    list.addEventListener('dragover', (event) => {
      if (!draggedItem) return;

      event.preventDefault();
      const target = event.target.closest('[data-group-display-item]');
      if (!target || target === draggedItem) return;

      const rect = target.getBoundingClientRect();
      const shouldPlaceAfter = event.clientY > rect.top + rect.height / 2;
      target.classList.add('drag-over');

      if (shouldPlaceAfter) {
        target.after(draggedItem);
      } else {
        target.before(draggedItem);
      }
    });

    list.addEventListener('dragleave', (event) => {
      const item = event.target.closest('[data-group-display-item]');
      if (item) item.classList.remove('drag-over');
    });
  }

  function applyGroupDisplayOrder(groupOrder) {
    const orderMap = new Map(groupOrder.map((id, index) => [id, index]));
    config.groups.sort((a, b) => {
      const aOrder = orderMap.has(a.id) ? orderMap.get(a.id) : Number.MAX_SAFE_INTEGER;
      const bOrder = orderMap.has(b.id) ? orderMap.get(b.id) : Number.MAX_SAFE_INTEGER;
      return aOrder - bOrder || a.order - b.order;
    });
    config.groups.forEach((group, index) => {
      group.order = index;
    });
  }

  function addVisibleGroup(groupId) {
    const groupDisplay = ensureGroupDisplaySettings();
    if (groupDisplay.visibleGroupIds.length === 0) {
      groupDisplay.visibleGroupIds = config.groups.map(group => group.id);
    }
    if (!groupDisplay.visibleGroupIds.includes(groupId)) {
      groupDisplay.visibleGroupIds.push(groupId);
    }
  }

  function removeVisibleGroup(groupId) {
    const groupDisplay = ensureGroupDisplaySettings();
    groupDisplay.visibleGroupIds = groupDisplay.visibleGroupIds.filter(id => id !== groupId);
  }

  function ensureGroupDisplaySettings() {
    config.settings.groupDisplay = config.settings.groupDisplay || { visibleGroupIds: [] };
    if (!Array.isArray(config.settings.groupDisplay.visibleGroupIds)) {
      config.settings.groupDisplay.visibleGroupIds = [];
    }
    return config.settings.groupDisplay;
  }

  function getWorldClockCountries() {
    if (worldClockCountries) return worldClockCountries;

    const displayNames = typeof Intl.DisplayNames === 'function'
      ? new Intl.DisplayNames(['zh-CN'], { type: 'region' })
      : null;

    worldClockCountries = COUNTRY_REGION_CODES
      .map(code => ({
        code,
        name: displayNames?.of(code) || code
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

    return worldClockCountries;
  }

  function normalizeCountryCodes(countryCodes) {
    const validCodes = new Set(getWorldClockCountries().map(country => country.code));
    return [...new Set(countryCodes)]
      .map(code => String(code || '').toUpperCase())
      .filter(code => validCodes.has(code));
  }

  function renderWorldClockCountryOptions(countries, selectedCodes) {
    const selectedSet = new Set(selectedCodes);
    return countries.map(country => {
      const searchText = `${country.name} ${country.code}`.toLowerCase();
      return `
        <label class="world-clock-country-option" data-country-option data-search="${Icons.escapeHtml(searchText)}">
          <input type="checkbox" name="worldClockCountries[]" value="${country.code}" ${selectedSet.has(country.code) ? 'checked' : ''}>
          <span class="world-clock-country-name">${Icons.escapeHtml(country.name)}</span>
          <span class="world-clock-country-code">${country.code}</span>
        </label>
      `;
    }).join('');
  }

  function bindWorldClockCountrySearch() {
    const searchInput = document.getElementById('worldClockCountrySearch');
    const list = document.getElementById('worldClockCountryList');
    const countEl = document.getElementById('worldClockSelectedCount');
    const emptyEl = document.getElementById('worldClockNoResults');
    const chipsEl = document.getElementById('worldClockSelectedChips');
    if (!searchInput || !list || !countEl || !emptyEl || !chipsEl) return;

    const countryMap = new Map(getWorldClockCountries().map(country => [country.code, country]));

    function getSelectedCodes() {
      return Array.from(list.querySelectorAll('input[type="checkbox"]:checked'))
        .map(input => input.value);
    }

    function renderSelectedChips() {
      const selectedCodes = getSelectedCodes();
      chipsEl.innerHTML = selectedCodes.map(code => {
        const country = countryMap.get(code);
        if (!country) return '';
        return `
          <span class="world-clock-chip" data-country-chip="${code}">
            <span class="world-clock-chip-label">${Icons.escapeHtml(country.name)}</span>
            <button type="button" class="world-clock-chip-remove" data-remove-country="${code}" title="移除${Icons.escapeHtml(country.name)}">x</button>
          </span>
        `;
      }).join('');
    }

    function updateSelectedCount() {
      countEl.textContent = `已选 ${getSelectedCodes().length} 个`;
    }

    function filterCountries() {
      const keyword = searchInput.value.trim().toLowerCase();
      let visibleCount = 0;

      list.querySelectorAll('[data-country-option]').forEach(option => {
        const matched = !keyword || option.dataset.search.includes(keyword);
        option.classList.toggle('hidden', !matched);
        if (matched) visibleCount += 1;
      });

      emptyEl.classList.toggle('hidden', visibleCount > 0);
    }

    searchInput.addEventListener('input', filterCountries);
    list.addEventListener('change', () => {
      searchInput.value = '';
      updateSelectedCount();
      renderSelectedChips();
      filterCountries();
    });
    chipsEl.addEventListener('click', (event) => {
      const removeButton = event.target.closest('[data-remove-country]');
      if (!removeButton) return;

      const checkbox = list.querySelector(`input[value="${removeButton.dataset.removeCountry}"]`);
      if (checkbox) checkbox.checked = false;
      updateSelectedCount();
      renderSelectedChips();
    });
    updateSelectedCount();
    renderSelectedChips();
    filterCountries();
  }

  function formatWorldClockTime(date, countryCode) {
    const timeZone = getWorldClockTimeZone(countryCode);
    try {
      return date.toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone
      });
    } catch {
      return date.toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
    }
  }

  function getWorldClockTimeZone(countryCode) {
    if (COUNTRY_TIME_ZONES[countryCode]) return COUNTRY_TIME_ZONES[countryCode];

    try {
      return new Intl.Locale(`und-${countryCode}`).timeZones?.[0] || Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    }
  }

  function getTimeZoneOffsetMinutes(date, timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
      }).formatToParts(date).reduce((acc, part) => {
        if (part.type !== 'literal') acc[part.type] = part.value;
        return acc;
      }, {});

      const zonedTimeAsUtc = Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        Number(parts.hour),
        Number(parts.minute),
        Number(parts.second)
      );

      return Math.round((zonedTimeAsUtc - date.getTime()) / 60000);
    } catch {
      return 0;
    }
  }

  const COUNTRY_REGION_CODES = [
    'AF', 'AX', 'AL', 'DZ', 'AS', 'AD', 'AO', 'AI', 'AQ', 'AG',
    'AR', 'AM', 'AW', 'AU', 'AT', 'AZ', 'BS', 'BH', 'BD', 'BB',
    'BY', 'BE', 'BZ', 'BJ', 'BM', 'BT', 'BO', 'BQ', 'BA', 'BW',
    'BV', 'BR', 'IO', 'BN', 'BG', 'BF', 'BI', 'CV', 'KH', 'CM',
    'CA', 'KY', 'CF', 'TD', 'CL', 'CN', 'CX', 'CC', 'CO', 'KM',
    'CG', 'CD', 'CK', 'CR', 'CI', 'HR', 'CU', 'CW', 'CY', 'CZ',
    'DK', 'DJ', 'DM', 'DO', 'EC', 'EG', 'SV', 'GQ', 'ER', 'EE',
    'SZ', 'ET', 'FK', 'FO', 'FJ', 'FI', 'FR', 'GF', 'PF', 'TF',
    'GA', 'GM', 'GE', 'DE', 'GH', 'GI', 'GR', 'GL', 'GD', 'GP',
    'GU', 'GT', 'GG', 'GN', 'GW', 'GY', 'HT', 'HM', 'VA', 'HN',
    'HK', 'HU', 'IS', 'IN', 'ID', 'IR', 'IQ', 'IE', 'IM', 'IL',
    'IT', 'JM', 'JP', 'JE', 'JO', 'KZ', 'KE', 'KI', 'KP', 'KR',
    'KW', 'KG', 'LA', 'LV', 'LB', 'LS', 'LR', 'LY', 'LI', 'LT',
    'LU', 'MO', 'MG', 'MW', 'MY', 'MV', 'ML', 'MT', 'MH', 'MQ',
    'MR', 'MU', 'YT', 'MX', 'FM', 'MD', 'MC', 'MN', 'ME', 'MS',
    'MA', 'MZ', 'MM', 'NA', 'NR', 'NP', 'NL', 'NC', 'NZ', 'NI',
    'NE', 'NG', 'NU', 'NF', 'MK', 'MP', 'NO', 'OM', 'PK', 'PW',
    'PS', 'PA', 'PG', 'PY', 'PE', 'PH', 'PN', 'PL', 'PT', 'PR',
    'QA', 'RE', 'RO', 'RU', 'RW', 'BL', 'SH', 'KN', 'LC', 'MF',
    'PM', 'VC', 'WS', 'SM', 'ST', 'SA', 'SN', 'RS', 'SC', 'SL',
    'SG', 'SX', 'SK', 'SI', 'SB', 'SO', 'ZA', 'GS', 'SS', 'ES',
    'LK', 'SD', 'SR', 'SJ', 'SE', 'CH', 'SY', 'TW', 'TJ', 'TZ',
    'TH', 'TL', 'TG', 'TK', 'TO', 'TT', 'TN', 'TR', 'TM', 'TC',
    'TV', 'UG', 'UA', 'AE', 'GB', 'UM', 'US', 'UY', 'UZ', 'VU',
    'VE', 'VN', 'VG', 'VI', 'WF', 'EH', 'YE', 'ZM', 'ZW', 'XK'
  ];

  const COUNTRY_TIME_ZONES = {
    AD: 'Europe/Andorra',
    AE: 'Asia/Dubai',
    AF: 'Asia/Kabul',
    AG: 'America/Antigua',
    AI: 'America/Anguilla',
    AL: 'Europe/Tirane',
    AM: 'Asia/Yerevan',
    AO: 'Africa/Luanda',
    AR: 'America/Argentina/Buenos_Aires',
    AS: 'Pacific/Pago_Pago',
    AT: 'Europe/Vienna',
    AU: 'Australia/Sydney',
    AW: 'America/Aruba',
    AX: 'Europe/Mariehamn',
    AZ: 'Asia/Baku',
    BA: 'Europe/Sarajevo',
    BB: 'America/Barbados',
    BD: 'Asia/Dhaka',
    BE: 'Europe/Brussels',
    BF: 'Africa/Ouagadougou',
    BG: 'Europe/Sofia',
    BH: 'Asia/Bahrain',
    BI: 'Africa/Bujumbura',
    BJ: 'Africa/Porto-Novo',
    BL: 'America/St_Barthelemy',
    BM: 'Atlantic/Bermuda',
    BN: 'Asia/Brunei',
    BO: 'America/La_Paz',
    BQ: 'America/Kralendijk',
    BR: 'America/Sao_Paulo',
    BS: 'America/Nassau',
    BT: 'Asia/Thimphu',
    BW: 'Africa/Gaborone',
    BY: 'Europe/Minsk',
    BZ: 'America/Belize',
    CA: 'America/Toronto',
    CC: 'Indian/Cocos',
    CD: 'Africa/Kinshasa',
    CF: 'Africa/Bangui',
    CG: 'Africa/Brazzaville',
    CH: 'Europe/Zurich',
    CI: 'Africa/Abidjan',
    CK: 'Pacific/Rarotonga',
    CL: 'America/Santiago',
    CM: 'Africa/Douala',
    CN: 'Asia/Shanghai',
    CO: 'America/Bogota',
    CR: 'America/Costa_Rica',
    CU: 'America/Havana',
    CV: 'Atlantic/Cape_Verde',
    CW: 'America/Curacao',
    CX: 'Indian/Christmas',
    CY: 'Asia/Nicosia',
    CZ: 'Europe/Prague',
    DE: 'Europe/Berlin',
    DJ: 'Africa/Djibouti',
    DK: 'Europe/Copenhagen',
    DM: 'America/Dominica',
    DO: 'America/Santo_Domingo',
    DZ: 'Africa/Algiers',
    EC: 'America/Guayaquil',
    EE: 'Europe/Tallinn',
    EG: 'Africa/Cairo',
    ER: 'Africa/Asmara',
    ES: 'Europe/Madrid',
    ET: 'Africa/Addis_Ababa',
    FI: 'Europe/Helsinki',
    FJ: 'Pacific/Fiji',
    FK: 'Atlantic/Stanley',
    FM: 'Pacific/Pohnpei',
    FO: 'Atlantic/Faroe',
    FR: 'Europe/Paris',
    GA: 'Africa/Libreville',
    GB: 'Europe/London',
    GD: 'America/Grenada',
    GE: 'Asia/Tbilisi',
    GF: 'America/Cayenne',
    GG: 'Europe/Guernsey',
    GH: 'Africa/Accra',
    GI: 'Europe/Gibraltar',
    GL: 'America/Nuuk',
    GM: 'Africa/Banjul',
    GN: 'Africa/Conakry',
    GP: 'America/Guadeloupe',
    GQ: 'Africa/Malabo',
    GR: 'Europe/Athens',
    GT: 'America/Guatemala',
    GU: 'Pacific/Guam',
    GW: 'Africa/Bissau',
    GY: 'America/Guyana',
    HK: 'Asia/Hong_Kong',
    HN: 'America/Tegucigalpa',
    HR: 'Europe/Zagreb',
    HT: 'America/Port-au-Prince',
    HU: 'Europe/Budapest',
    ID: 'Asia/Jakarta',
    IE: 'Europe/Dublin',
    IL: 'Asia/Jerusalem',
    IM: 'Europe/Isle_of_Man',
    IN: 'Asia/Kolkata',
    IO: 'Indian/Chagos',
    IQ: 'Asia/Baghdad',
    IR: 'Asia/Tehran',
    IS: 'Atlantic/Reykjavik',
    IT: 'Europe/Rome',
    JE: 'Europe/Jersey',
    JM: 'America/Jamaica',
    JO: 'Asia/Amman',
    JP: 'Asia/Tokyo',
    KE: 'Africa/Nairobi',
    KG: 'Asia/Bishkek',
    KH: 'Asia/Phnom_Penh',
    KI: 'Pacific/Tarawa',
    KM: 'Indian/Comoro',
    KN: 'America/St_Kitts',
    KP: 'Asia/Pyongyang',
    KR: 'Asia/Seoul',
    KW: 'Asia/Kuwait',
    KY: 'America/Cayman',
    KZ: 'Asia/Almaty',
    LA: 'Asia/Vientiane',
    LB: 'Asia/Beirut',
    LC: 'America/St_Lucia',
    LI: 'Europe/Vaduz',
    LK: 'Asia/Colombo',
    LR: 'Africa/Monrovia',
    LS: 'Africa/Maseru',
    LT: 'Europe/Vilnius',
    LU: 'Europe/Luxembourg',
    LV: 'Europe/Riga',
    LY: 'Africa/Tripoli',
    MA: 'Africa/Casablanca',
    MC: 'Europe/Monaco',
    MD: 'Europe/Chisinau',
    ME: 'Europe/Podgorica',
    MF: 'America/Marigot',
    MG: 'Indian/Antananarivo',
    MH: 'Pacific/Majuro',
    MK: 'Europe/Skopje',
    ML: 'Africa/Bamako',
    MM: 'Asia/Yangon',
    MN: 'Asia/Ulaanbaatar',
    MO: 'Asia/Macau',
    MP: 'Pacific/Saipan',
    MQ: 'America/Martinique',
    MR: 'Africa/Nouakchott',
    MS: 'America/Montserrat',
    MT: 'Europe/Malta',
    MU: 'Indian/Mauritius',
    MV: 'Indian/Maldives',
    MW: 'Africa/Blantyre',
    MX: 'America/Mexico_City',
    MY: 'Asia/Kuala_Lumpur',
    MZ: 'Africa/Maputo',
    NA: 'Africa/Windhoek',
    NC: 'Pacific/Noumea',
    NE: 'Africa/Niamey',
    NF: 'Pacific/Norfolk',
    NG: 'Africa/Lagos',
    NI: 'America/Managua',
    NL: 'Europe/Amsterdam',
    NO: 'Europe/Oslo',
    NP: 'Asia/Kathmandu',
    NR: 'Pacific/Nauru',
    NU: 'Pacific/Niue',
    NZ: 'Pacific/Auckland',
    OM: 'Asia/Muscat',
    PA: 'America/Panama',
    PE: 'America/Lima',
    PF: 'Pacific/Tahiti',
    PG: 'Pacific/Port_Moresby',
    PH: 'Asia/Manila',
    PK: 'Asia/Karachi',
    PL: 'Europe/Warsaw',
    PM: 'America/Miquelon',
    PN: 'Pacific/Pitcairn',
    PR: 'America/Puerto_Rico',
    PS: 'Asia/Gaza',
    PT: 'Europe/Lisbon',
    PW: 'Pacific/Palau',
    PY: 'America/Asuncion',
    QA: 'Asia/Qatar',
    RE: 'Indian/Reunion',
    RO: 'Europe/Bucharest',
    RS: 'Europe/Belgrade',
    RU: 'Europe/Moscow',
    RW: 'Africa/Kigali',
    SA: 'Asia/Riyadh',
    SB: 'Pacific/Guadalcanal',
    SC: 'Indian/Mahe',
    SD: 'Africa/Khartoum',
    SE: 'Europe/Stockholm',
    SG: 'Asia/Singapore',
    SH: 'Atlantic/St_Helena',
    SI: 'Europe/Ljubljana',
    SJ: 'Arctic/Longyearbyen',
    SK: 'Europe/Bratislava',
    SL: 'Africa/Freetown',
    SM: 'Europe/San_Marino',
    SN: 'Africa/Dakar',
    SO: 'Africa/Mogadishu',
    SR: 'America/Paramaribo',
    SS: 'Africa/Juba',
    ST: 'Africa/Sao_Tome',
    SV: 'America/El_Salvador',
    SX: 'America/Lower_Princes',
    SY: 'Asia/Damascus',
    SZ: 'Africa/Mbabane',
    TC: 'America/Grand_Turk',
    TD: 'Africa/Ndjamena',
    TG: 'Africa/Lome',
    TH: 'Asia/Bangkok',
    TJ: 'Asia/Dushanbe',
    TK: 'Pacific/Fakaofo',
    TL: 'Asia/Dili',
    TM: 'Asia/Ashgabat',
    TN: 'Africa/Tunis',
    TO: 'Pacific/Tongatapu',
    TR: 'Europe/Istanbul',
    TT: 'America/Port_of_Spain',
    TV: 'Pacific/Funafuti',
    TW: 'Asia/Taipei',
    TZ: 'Africa/Dar_es_Salaam',
    UA: 'Europe/Kyiv',
    UG: 'Africa/Kampala',
    US: 'America/New_York',
    UY: 'America/Montevideo',
    UZ: 'Asia/Tashkent',
    VA: 'Europe/Vatican',
    VC: 'America/St_Vincent',
    VE: 'America/Caracas',
    VG: 'America/Tortola',
    VI: 'America/St_Thomas',
    VN: 'Asia/Ho_Chi_Minh',
    VU: 'Pacific/Efate',
    WF: 'Pacific/Wallis',
    WS: 'Pacific/Apia',
    XK: 'Europe/Belgrade',
    YE: 'Asia/Aden',
    YT: 'Indian/Mayotte',
    ZA: 'Africa/Johannesburg',
    ZM: 'Africa/Lusaka',
    ZW: 'Africa/Harare'
  };

  // ========== 云同步配置 ==========

  async function openSettingsModal() {
    const settings = await GistSync.loadSettings();
    const modalPromise = Editor.showModal('配置', renderSettingsModal(settings));
    const confirmBtn = document.getElementById('modalConfirm');
    const cancelBtn = document.getElementById('modalCancel');
    const oldConfirmText = confirmBtn.textContent;

    confirmBtn.textContent = '关闭';
    cancelBtn.classList.add('hidden');
    bindSettingsModalEvents();

    await modalPromise;
    if (activeSyncAbort) {
      activeSyncAbort.abort();
      activeSyncAbort = null;
    }

    confirmBtn.textContent = oldConfirmText;
    cancelBtn.classList.remove('hidden');
  }

  function renderSettingsModal(settings) {
    const accountName = settings.account?.name || settings.account?.login || '未授权';
    const gistLabel = settings.gistId ? `Gist：${settings.gistId}` : '首次同步会自动创建私有 Gist';
    const versionLabel = `同步版本：${Number(settings.syncVersion || 0)}`;

    return `
      <div class="settings-panel">
        <section class="settings-section">
          <div class="settings-section-header">
            <div>
              <div class="settings-section-title">GitHub Gist 同步</div>
              <div class="settings-section-desc">点击同步后生成随机码，打开 GitHub 填入随机码授权。</div>
            </div>
            <span class="sync-file-badge">JSON</span>
          </div>

          <div id="syncAccountInfo" class="sync-account">
            ${settings.account?.avatarUrl ? `<img class="sync-avatar" src="${Icons.escapeHtml(settings.account.avatarUrl)}" alt="">` : '<div class="sync-avatar sync-avatar-placeholder">GH</div>'}
            <div class="sync-account-meta">
              <div class="sync-account-name">${Icons.escapeHtml(accountName)}</div>
              <div class="sync-account-detail">${Icons.escapeHtml(versionLabel)} · ${Icons.escapeHtml(gistLabel)}</div>
            </div>
          </div>

          <div id="deviceFlowPanel" class="device-flow-panel hidden">
            <div class="device-flow-label">GitHub 授权码</div>
            <div id="githubUserCode" class="device-flow-code"></div>
            <div class="device-flow-actions">
              <button id="copyGitHubCodeBtn" class="btn btn-secondary" type="button">复制随机码</button>
              <button id="openGitHubAuthBtn" class="btn btn-secondary" type="button">打开 GitHub</button>
            </div>
          </div>

          <div class="settings-actions">
            <button id="disconnectGistBtn" class="btn btn-secondary" type="button" ${settings.connected ? '' : 'style="display:none"'}>断开连接</button>
            <button id="syncGistBtn" class="btn btn-primary" type="button">同步</button>
          </div>

          <div id="gistSyncStatus" class="sync-status">
            上次同步：${GistSync.formatSyncTime(settings.lastSyncedAt)}。只同步配置数据，不同步 Token。
          </div>
        </section>
      </div>
    `;
  }

  function bindSettingsModalEvents() {
    const statusEl = document.getElementById('gistSyncStatus');
    const deviceFlowPanel = document.getElementById('deviceFlowPanel');
    const githubUserCode = document.getElementById('githubUserCode');
    const copyGitHubCodeBtn = document.getElementById('copyGitHubCodeBtn');
    const openGitHubAuthBtn = document.getElementById('openGitHubAuthBtn');
    const syncBtn = document.getElementById('syncGistBtn');
    const disconnectBtn = document.getElementById('disconnectGistBtn');
    const actionButtons = Array.from(document.querySelectorAll('.settings-actions .btn'));
    let deviceFlow = null;

    function setBusy(isBusy) {
      actionButtons.forEach(button => {
        button.disabled = isBusy;
      });
      if (!isBusy) {
        GistSync.loadSettings().then(settings => {
          if (settings.connected) {
            disconnectBtn.style.display = '';
            disconnectBtn.disabled = false;
          } else {
            disconnectBtn.style.display = 'none';
          }
        });
      }
    }

    function setStatus(message, state = '') {
      statusEl.className = `sync-status${state ? ` sync-status-${state}` : ''}`;
      statusEl.textContent = message;
    }

    async function runSync() {
      try {
        setBusy(true);
        activeSyncAbort = new AbortController();

        let settings = await GistSync.loadSettings();
        if (!settings.connected || !settings.token) {
          setStatus('正在生成 GitHub 授权随机码...', 'loading');
          deviceFlow = await GistSync.startDeviceFlow();
          deviceFlowPanel.classList.remove('hidden');
          githubUserCode.textContent = deviceFlow.userCode;
          openGitHubAuthBtn.dataset.authUrl = deviceFlow.verificationUri;

          setStatus('请点击下方按钮打开 GitHub 页面并输入随机码，授权后会自动继续同步。', 'loading');

          settings = await GistSync.authorize(
            deviceFlow,
            () => setStatus('等待 GitHub 授权完成...', 'loading'),
            activeSyncAbort.signal
          );
          deviceFlowPanel.classList.add('hidden');
          setStatus(`已授权 GitHub：${settings.account?.login || settings.account?.name || ''}，正在同步...`, 'loading');
        } else {
          setStatus('正在同步配置...', 'loading');
        }

        const result = await GistSync.syncConfig(config, { signal: activeSyncAbort.signal });
        config = result.config;
        await Storage.saveConfig(config, { markDirty: false });
        applyTheme(config.settings.theme);
        updateThemeButtonIcon(config.settings.theme);
        updateToolbarClock();
        Renderer.renderAll(config);

        const actionLabels = {
          created: '已创建私有 Gist 并上传配置',
          pushed: '已上传本地配置到 Gist',
          pulled: '已从 Gist 拉取较新的配置',
          noop: '本地和服务器配置已一致'
        };
        setStatus(`${actionLabels[result.action] || '同步完成'}。同步版本：${result.settings.syncVersion}。上次同步：${GistSync.formatSyncTime(result.settings.lastSyncedAt)}`, 'success');

        // 同步成功后刷新账户信息显示
        const accountInfoEl = document.getElementById('syncAccountInfo');
        if (accountInfoEl) {
          const acct = result.settings.account || {};
          const acctName = acct.name || acct.login || '未授权';
          const gistId = result.settings.gistId || '';
          const gistLabel = gistId ? `Gist：${gistId}` : '首次同步会自动创建私有 Gist';
          const versionLabel = `同步版本：${Number(result.settings.syncVersion || 0)}`;
          accountInfoEl.innerHTML = `
            ${acct.avatarUrl ? `<img class="sync-avatar" src="${Icons.escapeHtml(acct.avatarUrl)}" alt="">` : '<div class="sync-avatar sync-avatar-placeholder">GH</div>'}
            <div class="sync-account-meta">
              <div class="sync-account-name">${Icons.escapeHtml(acctName)}</div>
              <div class="sync-account-detail">${Icons.escapeHtml(versionLabel)} · ${Icons.escapeHtml(gistLabel)}</div>
            </div>
          `;
        }
        // 显示断开连接按钮
        disconnectBtn.style.display = '';
        disconnectBtn.disabled = false;

        showToast('Gist 同步完成');
      } catch (error) {
        if (error.name === 'AbortError') {
          setStatus('同步已取消', 'error');
        } else {
          setStatus(`同步失败：${error.message}`, 'error');
          showToast('同步失败：' + error.message, 4000);
        }
      } finally {
        activeSyncAbort = null;
        setBusy(false);
      }
    }

    syncBtn.addEventListener('click', runSync);

    disconnectBtn.addEventListener('click', async () => {
      if (!confirm('断开后会删除本机保存的 GitHub 授权信息，远端 Gist 不会删除。是否继续？')) {
        return;
      }

      if (activeSyncAbort) {
        activeSyncAbort.abort();
        activeSyncAbort = null;
      }
      await GistSync.disconnect();
      deviceFlowPanel.classList.add('hidden');

      // 重置账户显示为未授权初始状态
      const accountInfoEl = document.getElementById('syncAccountInfo');
      if (accountInfoEl) {
        accountInfoEl.innerHTML = `
          <div class="sync-avatar sync-avatar-placeholder">GH</div>
          <div class="sync-account-meta">
            <div class="sync-account-name">未授权</div>
            <div class="sync-account-detail">同步版本：0 · 首次同步会自动创建私有 Gist</div>
          </div>
        `;
      }

      // 隐藏断开连接按钮
      disconnectBtn.style.display = 'none';

      // 更新同步状态提示
      statusEl.textContent = '尚未同步。只同步配置数据，不同步 Token。';
      setStatus('已断开 GitHub Gist 同步', 'success');
      showToast('已断开 Gist 同步');
    });

    copyGitHubCodeBtn.addEventListener('click', () => {
      if (!deviceFlow?.userCode) return;
      navigator.clipboard.writeText(deviceFlow.userCode).then(() => {
        setStatus('随机码已复制，请在 GitHub 页面粘贴。', 'success');
      }).catch(() => {
        setStatus('复制失败，请手动复制随机码。', 'error');
      });
    });

    openGitHubAuthBtn.addEventListener('click', () => {
      const url = openGitHubAuthBtn.dataset.authUrl;
      if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    });
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
