/**
 * 主渲染引擎 - 统一渲染入口，协调各组件
 * 修复：事件只绑定一次，防止重复触发导致多开空白页
 */
const Renderer = (() => {
  let config = null;
  let currentGroup = null;
  let _eventsBound = false;

  /**
   * 全量渲染页面
   */
  function renderAll(_config) {
    config = _config;
    Editor.setConfig(config);

    const visibleGroups = getVisibleGroups(config);
    const activeGroup = getActiveVisibleGroup(config, visibleGroups);

    if (!activeGroup && visibleGroups.length > 0) {
      config.settings.activeGroupId = visibleGroups[0].id;
      renderAll(config);
      return;
    }

    if (config.settings.activeGroupId && !activeGroup) {
      if (visibleGroups.length > 0) {
        config.settings.activeGroupId = visibleGroups[0].id;
        renderAll(config);
      }
      return;
    }

    currentGroup = activeGroup;

    SidebarComponent.render(visibleGroups, config.settings.activeGroupId);
    renderContent(activeGroup);
  }

  /**
   * 渲染右侧内容区（只更新 DOM，不绑定事件）
   */
  function renderContent(group) {
    const grid = document.getElementById('subgroupGrid');
    if (!grid) return;

    if (!group || group.subgroups.length === 0) {
      grid.innerHTML = `
        <div style="padding:40px;text-align:center;color:var(--text-tertiary);width:100%;">
          <div style="font-size:48px;margin-bottom:12px;">📂</div>
          <div style="font-size:14px;">点击下方按钮添加分组</div>
        </div>`;
      return;
    }

    const sorted = [...group.subgroups].sort((a, b) => a.order - b.order);
    grid.innerHTML = sorted.map(sg => SubgroupComponent.render(sg, config)).join('');

    // 绑定分组拖拽事件（这些是针对新元素的，需要每次绑定）
    sorted.forEach(sg => {
      const el = grid.querySelector(`[data-subgroup-id="${sg.id}"]`);
      if (el) {
        SubgroupComponent.setupDragEvents(el, sg);
      }
    });

    // 绑定卡片拖拽事件
    sorted.forEach(sg => {
      sg.cards.forEach(card => {
        const cardEl = grid.querySelector(`.card[data-card-id="${card.id}"]`);
        if (cardEl) {
          CardComponent.setupDragEvents(cardEl, card);
        }
      });
    });

    // 首次渲染时绑定全局事件委托
    if (!_eventsBound) {
      bindGlobalGridEvents();
      _eventsBound = true;
    }
  }

  /**
   * 刷新内容区
   */
  function refreshContent() {
    if (currentGroup) {
      renderContent(currentGroup);
    }
  }

  /**
   * 切换分组（只更新高亮和内容，不重渲染侧边栏）
   */
  function switchGroup(groupId) {
    if (!getVisibleGroups(config).some(group => group.id === groupId)) return;

    config.settings.activeGroupId = groupId;
    SidebarComponent.highlightGroup(groupId);
    currentGroup = findGroup(config, groupId);
    renderContent(currentGroup);
    Storage.saveConfig(config);
  }

  /**
   * 绑定全局事件委托（只在 init 时调用一次）
   */
  function bindGlobalGridEvents() {
    const grid = document.getElementById('subgroupGrid');
    if (!grid) return;

    let clickTimer = null; // 用于延迟单击，避免与双击冲突

    // 单击卡片 - 延迟执行（让双击有机会取消单击）
    grid.addEventListener('click', (e) => {
      // 操作按钮优先处理（不延迟）
      const actionBtn = e.target.closest('[data-action]');
      if (actionBtn) {
        if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
        handleAction(actionBtn.dataset);
        return;
      }

      // 卡片点击 - 延迟执行
      const cardEl = e.target.closest('.card');
      if (cardEl) {
        const cardId = cardEl.dataset.cardId;
        const card = findCardInCurrentGroup(cardId);
        if (card) {
          // 延迟执行，给双击留出取消窗口
          if (clickTimer) clearTimeout(clickTimer);
          clickTimer = setTimeout(() => {
            clickTimer = null;
            CardComponent.handleClick(card);
          }, 250);
        }
        return;
      }
    });

    // 双击 - 取消单击，内联编辑卡片名称
    grid.addEventListener('dblclick', (e) => {
      // 取消待执行的单击
      if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = null;
      }

      const cardEl = e.target.closest('.card');
      if (cardEl) {
        const cardId = cardEl.dataset.cardId;
        const card = findCardInCurrentGroup(cardId);
        if (card) {
          startInlineEdit(cardEl, card);
        }
        return;
      }

      // 双击分组名称 - 内联编辑
      const nameEl = e.target.closest('.subgroup-name');
      if (nameEl) {
        const subgroupId = nameEl.dataset.subgroupName;
        const subgroup = findSubgroupInCurrentGroup(subgroupId);
        if (subgroup) {
          startSubgroupNameEdit(nameEl, subgroup);
        }
      }
    });

    // 中键点击 - 后台打开
    grid.addEventListener('mousedown', (e) => {
      if (e.button !== 1) return;
      const cardEl = e.target.closest('.card');
      if (cardEl) {
        const cardId = cardEl.dataset.cardId;
        const card = findCardInCurrentGroup(cardId);
        if (card) {
          CardComponent.handleMiddleClick(e, card);
        }
      }
    });

    // 拖拽排序
    setupDragDelegation(grid);
  }

  /**
   * 处理操作按钮（模式切换、编辑、添加等）
   */
  async function handleAction(dataset) {
    const { action, subgroupId } = dataset;

    switch (action) {
      case 'toggle-mode': {
        const subgroup = findSubgroupInCurrentGroup(subgroupId);
        if (subgroup) {
          subgroup.displayMode = subgroup.displayMode === 'compact' ? 'comfortable' : 'compact';
          subgroup.updatedAt = now();
          refreshContent();
          Storage.saveConfig(config);
        }
        break;
      }

      case 'edit-subgroup': {
        const subgroup = findSubgroupInCurrentGroup(subgroupId);
        if (subgroup) {
          const result = await Editor.editSubgroup(currentGroup.id, subgroupId);
          if (result) {
            refreshContent();
            Storage.saveConfig(config);
          }
        }
        break;
      }

      case 'move-subgroup': {
        const subgroup = findSubgroupInCurrentGroup(subgroupId);
        if (subgroup) {
          const targetGroupId = await Editor.moveSubgroup(currentGroup.id, subgroupId);
          if (targetGroupId && moveSubgroupToGroup(currentGroup.id, subgroupId, targetGroupId)) {
            config.settings.activeGroupId = targetGroupId;
            renderAll(config);
            Storage.saveConfig(config);
            showToast('分组已移动');
          }
        }
        break;
      }

      case 'add-card': {
        const subgroup = findSubgroupInCurrentGroup(subgroupId);
        if (subgroup && subgroup.cards.length < 8) {
          const card = await Editor.addCard(currentGroup.id, subgroupId);
          if (card) {
            refreshContent();
            Storage.saveConfig(config);
            if (card.iconType === 'favicon') {
              Favicons.fetchAndCache(config, card).then(() => {
                refreshContent();
                Storage.saveConfig(config, { markDirty: false });
              });
            }
          }
        }
        break;
      }
    }
  }

  /**
   * 内联编辑卡片名称
   */
  function startInlineEdit(cardEl, card) {
    if (cardEl.querySelector('.card-name-input')) return;

    const nameEl = cardEl.querySelector('.card-name');
    if (!nameEl) return;

    const currentName = nameEl.textContent;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'card-name-input';
    input.value = currentName;

    nameEl.replaceWith(input);
    input.focus();
    input.select();

    const finish = () => {
      const newName = input.value.trim() || card.name;
      card.name = newName;
      card.updatedAt = now();
      refreshContent();
      Storage.saveConfig(config);
    };

    input.addEventListener('blur', finish);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        input.blur();
      } else if (e.key === 'Escape') {
        input.value = currentName;
        input.blur();
      }
    });
  }

  /**
   * 内联编辑分组名称
   */
  function startSubgroupNameEdit(nameEl, subgroup) {
    if (nameEl.querySelector('input')) return;

    const currentName = nameEl.textContent;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'subgroup-name-input';
    input.value = currentName;

    nameEl.replaceWith(input);
    input.focus();
    input.select();

    const finish = () => {
      const newName = input.value.trim() || subgroup.name;
      subgroup.name = newName;
      subgroup.updatedAt = now();
      refreshContent();
      Storage.saveConfig(config);
    };

    input.addEventListener('blur', finish);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        input.blur();
      } else if (e.key === 'Escape') {
        input.value = currentName;
        input.blur();
      }
    });
  }

  /**
   * 设置拖拽事件委托（只调用一次）
   */
  function setupDragDelegation(grid) {
    grid.addEventListener('dragover', (e) => {
      e.preventDefault();
    });

    grid.addEventListener('drop', (e) => {
      e.preventDefault();

      let dragData;
      try {
        dragData = JSON.parse(e.dataTransfer.getData('text/plain'));
      } catch {
        return;
      }

      if (!dragData) return;

      // 处理卡片拖拽（可以拖到另一个卡片或分组容器上）
      if (dragData.type === 'card') {
        const draggedCardId = dragData.cardId;
        const draggedCard = findCardInCurrentGroup(draggedCardId);
        if (!draggedCard) return;

        const draggedSG = findSubgroupContainingCard(draggedCardId);
        if (!draggedSG) return;

        // 尝试找到目标卡片
        const cardEl = e.target.closest('.card');
        if (cardEl) {
          // 拖到另一个卡片上
          const targetCardId = cardEl.dataset.cardId;
          const targetCard = findCardInCurrentGroup(targetCardId);
          if (!targetCard) return;

          const targetSG = findSubgroupContainingCard(targetCardId);
          if (!targetSG) return;

          if (targetCardId === draggedCardId) return;

          if (draggedSG.id === targetSG.id) {
            // 同一个分组内移动
            const fromIdx = draggedSG.cards.indexOf(draggedCard);
            const toIdx = targetSG.cards.indexOf(targetCard);
            draggedSG.cards = reorderArray(draggedSG.cards, fromIdx, toIdx);
          } else {
            // 跨分组移动
            if (targetSG.cards.length >= 8) {
              showToast('目标分组已满（最多 8 个卡片）');
              return;
            }
            const fromIdx = draggedSG.cards.indexOf(draggedCard);
            draggedSG.cards.splice(fromIdx, 1);
            const toIdx = targetSG.cards.indexOf(targetCard);
            targetSG.cards.splice(toIdx, 0, draggedCard);
            targetSG.cards.forEach((c, i) => { c.order = i; });
            draggedSG.cards.forEach((c, i) => { c.order = i; });
          }
        } else {
          // 拖到分组容器上（不是卡片）
          const subgroupEl = e.target.closest('.subgroup');
          if (!subgroupEl) return;

          const targetSG = findSubgroupInCurrentGroup(subgroupEl.dataset.subgroupId);
          if (!targetSG || targetSG.id === draggedSG.id) return;

          if (targetSG.cards.length >= 8) {
            showToast('目标分组已满（最多 8 个卡片）');
            return;
          }

          // 从原分组移除，添加到目标分组末尾
          const fromIdx = draggedSG.cards.indexOf(draggedCard);
          draggedSG.cards.splice(fromIdx, 1);
          targetSG.cards.push(draggedCard);
          targetSG.cards.forEach((c, i) => { c.order = i; });
          draggedSG.cards.forEach((c, i) => { c.order = i; });
        }

        refreshContent();
        Storage.saveConfig(config);
      }
    });
  }

  // ========== 查询函数 ==========

  function findCardInCurrentGroup(cardId) {
    if (!currentGroup) return null;
    for (const sg of currentGroup.subgroups) {
      const card = sg.cards.find(c => c.id === cardId);
      if (card) return card;
    }
    return null;
  }

  function findSubgroupContainingCard(cardId) {
    if (!currentGroup) return null;
    for (const sg of currentGroup.subgroups) {
      if (sg.cards.find(c => c.id === cardId)) return sg;
    }
    return null;
  }

  function findSubgroupInCurrentGroup(subgroupId) {
    if (!currentGroup) return null;
    return currentGroup.subgroups.find(sg => sg.id === subgroupId);
  }

  function moveSubgroupToGroup(sourceGroupId, subgroupId, targetGroupId) {
    if (sourceGroupId === targetGroupId) return false;

    const sourceGroup = findGroup(config, sourceGroupId);
    const targetGroup = findGroup(config, targetGroupId);
    if (!sourceGroup || !targetGroup) return false;

    const subgroupIndex = sourceGroup.subgroups.findIndex(sg => sg.id === subgroupId);
    if (subgroupIndex === -1) return false;

    const [subgroup] = sourceGroup.subgroups.splice(subgroupIndex, 1);
    subgroup.order = targetGroup.subgroups.length;
    subgroup.updatedAt = now();
    targetGroup.subgroups.push(subgroup);

    sourceGroup.subgroups.forEach((item, index) => { item.order = index; });
    targetGroup.subgroups.forEach((item, index) => { item.order = index; });
    sourceGroup.updatedAt = now();
    targetGroup.updatedAt = now();
    return true;
  }

  function getVisibleGroups(config) {
    const visibleIds = config.settings?.groupDisplay?.visibleGroupIds;
    if (!Array.isArray(visibleIds) || visibleIds.length === 0) {
      return config.groups || [];
    }

    const visibleSet = new Set(visibleIds);
    return (config.groups || []).filter(group => visibleSet.has(group.id));
  }

  function getActiveVisibleGroup(config, visibleGroups) {
    const activeId = config.settings.activeGroupId;
    if (activeId) {
      const group = visibleGroups.find(item => item.id === activeId);
      if (group) return group;
    }
    return visibleGroups[0] || null;
  }

  return {
    renderAll,
    refreshContent,
    switchGroup,
    getCurrentGroup: () => currentGroup
  };
})();
