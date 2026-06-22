/**
 * 编辑模式控制器 - 增/删/改/弹窗管理
 */
const Editor = (() => {
  let modalResolve = null;
  let currentConfig = null;
  let _capturedFormData = null; // 在关闭弹窗前同步捕获的表单数据

  const emojiList = Icons.getEmojiList();

  /**
   * 显示编辑弹窗
   */
  function showModal(title, bodyHtml) {
    _capturedFormData = null;
    return new Promise((resolve) => {
      modalResolve = resolve;

      document.getElementById('modalTitle').textContent = title;
      document.getElementById('modalBody').innerHTML = bodyHtml;
      document.getElementById('modalOverlay').classList.remove('hidden');

      // 弹窗打开后立即绑定图标类型切换事件
      setupIconTypeToggle();

      // 聚焦第一个输入框
      setTimeout(() => {
        const firstInput = document.querySelector('#modalBody input');
        if (firstInput) firstInput.focus();
      }, 100);
    });
  }

  /**
   * 关闭弹窗
   * 必须在清空 HTML 前同步捕获表单数据，因为 await 后续代码是微任务，
   * 会在同步代码完成后才执行（此时 HTML 已清空）。
   */
  function closeModal(result = null) {
    document.getElementById('modalOverlay').classList.add('hidden');

    // 在清空 HTML 前同步捕获表单数据 + emoji 选中值
    if (result) {
      const formData = getFormData('#modalBody');
      // 同时捕获 emoji 选择器的选中值
      const emojiPicker = document.querySelector('#modalBody .emoji-picker');
      if (emojiPicker) {
        const selectedEmoji = emojiPicker.querySelector('.emoji-option.selected');
        formData._selectedEmoji = selectedEmoji ? selectedEmoji.dataset.emoji : null;
      }
      _capturedFormData = formData;
    }

    // 清空 HTML
    document.getElementById('modalBody').innerHTML = '';

    if (modalResolve) {
      modalResolve(result);
      modalResolve = null;
    }
  }

  /**
   * 获取上次关闭弹窗时捕获的表单数据
   */
  function getCapturedFormData() {
    const data = _capturedFormData || {};
    _capturedFormData = null;
    return data;
  }

  /**
   * 获取表单数据
   */
  function getFormData(formSelector) {
    const form = document.querySelector(formSelector);
    if (!form) return {};
    const data = {};
    form.querySelectorAll('input, textarea, select').forEach(el => {
      if (el.type === 'radio') {
        if (el.checked) data[el.name] = el.value;
      } else {
        data[el.name] = el.value;
      }
    });
    return data;
  }

  /**
   * Emoji 选择器 HTML
   */
  function renderEmojiPicker(selectedEmoji) {
    return `
      <div class="emoji-picker" id="emojiPicker">
        ${emojiList.map(emoji => `
          <span class="emoji-option ${emoji === selectedEmoji ? 'selected' : ''}"
                data-emoji="${emoji}">${emoji}</span>
        `).join('')}
      </div>`;
  }

  // ========== 分组编辑 ==========

  /**
   * 添加分组
   */
  async function addGroup() {
    const result = await showModal('添加分组', `
      <div class="form-group">
        <label class="form-label">分组名称</label>
        <input class="form-input" name="name" placeholder="输入分组名称" value="新分组">
      </div>
      <div class="form-group">
        <label class="form-label">选择图标</label>
        ${renderEmojiPicker('📂')}
        <input type="hidden" name="icon" value="📂">
      </div>
    `);

    if (result) {
      const data = getCapturedFormData();
      const group = createGroup({
        name: data.name || '新分组',
        icon: data._selectedEmoji || '📂',
        order: currentConfig.groups.length
      });
      currentConfig.groups.push(group);
      return group;
    }
    return null;
  }

  /**
   * 编辑分组
   */
  async function editGroup(group) {
    const result = await showModal('编辑分组', `
      <div class="form-group">
        <label class="form-label">分组名称</label>
        <input class="form-input" name="name" placeholder="输入分组名称" value="${Icons.escapeHtml(group.name)}">
      </div>
      <div class="form-group">
        <label class="form-label">选择图标</label>
        ${renderEmojiPicker(group.icon)}
        <input type="hidden" name="icon" value="${group.icon}">
      </div>
    `);

    if (result) {
      const data = getCapturedFormData();
      group.name = data.name || group.name;
      group.icon = data._selectedEmoji || group.icon;
      group.updatedAt = now();
      return group;
    }
    return null;
  }

  /**
   * 更新分组激活状态
   */
  function setActiveGroup(config, groupId) {
    config.settings.activeGroupId = groupId;
  }

  // ========== 小分组编辑 ==========

  /**
   * 添加小分组
   */
  async function addSubgroup(groupId) {
    const result = await showModal('添加小分组', `
      <div class="form-group">
        <label class="form-label">小分组名称</label>
        <input class="form-input" name="name" placeholder="输入小分组名称" value="新文件夹">
      </div>
      <div class="form-group">
        <label class="form-label">选择图标</label>
        ${renderEmojiPicker('📁')}
        <input type="hidden" name="icon" value="📁">
      </div>
    `);

    if (result) {
      const data = getCapturedFormData();
      const group = findGroup(currentConfig, groupId);
      if (group) {
        const subgroup = createSubgroup({
          name: data.name || '新文件夹',
          icon: data._selectedEmoji || '📁',
          order: group.subgroups.length
        });
        group.subgroups.push(subgroup);
        group.updatedAt = now();
        return subgroup;
      }
    }
    return null;
  }

  /**
   * 编辑小分组
   */
  async function editSubgroup(groupId, subgroupId) {
    const group = findGroup(currentConfig, groupId);
    const subgroup = group ? findSubgroup(group, subgroupId) : null;
    if (!subgroup) return null;

    const result = await showModal('编辑小分组', `
      <div class="form-group">
        <label class="form-label">小分组名称</label>
        <input class="form-input" name="name" placeholder="输入小分组名称" value="${Icons.escapeHtml(subgroup.name)}">
      </div>
      <div class="form-group">
        <label class="form-label">选择图标</label>
        ${renderEmojiPicker(subgroup.icon)}
        <input type="hidden" name="icon" value="${subgroup.icon}">
      </div>
    `);

    if (result) {
      const data = getCapturedFormData();
      subgroup.name = data.name || subgroup.name;
      subgroup.icon = data._selectedEmoji || subgroup.icon;
      subgroup.updatedAt = now();
      return subgroup;
    }
    return null;
  }

  // ========== 卡片编辑 ==========

  /**
   * 添加卡片
   */
  async function addCard(groupId, subgroupId) {
    const result = await showModal('添加卡片', `
      <div class="form-group">
        <label class="form-label">卡片名称</label>
        <input class="form-input" name="name" placeholder="输入卡片名称" value="新卡片">
      </div>
      <div class="form-group">
        <label class="form-label">URL 地址</label>
        <input class="form-input" name="url" placeholder="https://example.com" value="">
        <span class="form-hint">请输入完整的网址，包含 http:// 或 https://</span>
      </div>
      <div class="form-group">
        <label class="form-label">图标类型</label>
        <div style="display:flex;gap:12px;padding:4px 0;">
          <label style="display:flex;align-items:center;gap:4px;cursor:pointer;">
            <input type="radio" name="iconType" value="favicon" checked> 自动获取图标
          </label>
          <label style="display:flex;align-items:center;gap:4px;cursor:pointer;">
            <input type="radio" name="iconType" value="emoji"> Emoji
          </label>
        </div>
        <div id="emojiPickerContainer" style="display:none;">
          ${renderEmojiPicker('🌐')}
          <input type="hidden" name="iconValue" value="🌐">
        </div>
        <div class="form-group" id="customIconGroup" style="display:none;">
          <label class="form-label">自定义图片 URL</label>
          <input class="form-input" name="customIconUrl" placeholder="https://...">
        </div>
      </div>
    `);

    if (result) {
      const data = getCapturedFormData();
      const group = findGroup(currentConfig, groupId);
      const subgroup = group ? findSubgroup(group, subgroupId) : null;
      if (subgroup && subgroup.cards.length < 8) {
        const iconType = data.iconType || 'favicon';
        const card = createCard({
          name: data.name || '新卡片',
          url: data.url || '',
          iconType: iconType,
          iconValue: iconType === 'emoji'
            ? (data._selectedEmoji || '🌐')
            : (iconType === 'custom' ? (data.customIconUrl || '') : ''),
          order: subgroup.cards.length
        });
        subgroup.cards.push(card);
        subgroup.updatedAt = now();
        return card;
      }
    }
    return null;
  }

  /**
   * 编辑卡片
   */
  async function editCard(groupId, subgroupId, cardId) {
    const group = findGroup(currentConfig, groupId);
    const subgroup = group ? findSubgroup(group, subgroupId) : null;
    const card = subgroup ? findCard(subgroup, cardId) : null;
    if (!card) return null;

    const result = await showModal('编辑卡片', `
      <div class="form-group">
        <label class="form-label">卡片名称</label>
        <input class="form-input" name="name" placeholder="输入卡片名称" value="${Icons.escapeHtml(card.name)}">
      </div>
      <div class="form-group">
        <label class="form-label">URL 地址</label>
        <input class="form-input" name="url" placeholder="https://example.com" value="${Icons.escapeHtml(card.url || '')}">
        <span class="form-hint">请输入完整的网址，包含 http:// 或 https://</span>
      </div>
      <div class="form-group">
        <label class="form-label">图标类型</label>
        <div style="display:flex;gap:12px;padding:4px 0;">
          <label style="display:flex;align-items:center;gap:4px;cursor:pointer;">
            <input type="radio" name="iconType" value="favicon" ${card.iconType === 'favicon' ? 'checked' : ''}> 自动获取图标
          </label>
          <label style="display:flex;align-items:center;gap:4px;cursor:pointer;">
            <input type="radio" name="iconType" value="emoji" ${card.iconType === 'emoji' ? 'checked' : ''}> Emoji
          </label>
        </div>
        <div id="emojiPickerContainer" style="display:${card.iconType === 'emoji' ? 'block' : 'none'};">
          ${renderEmojiPicker(card.iconType === 'emoji' ? card.iconValue : '🌐')}
          <input type="hidden" name="iconValue" value="${Icons.escapeHtml(card.iconValue || '')}">
        </div>
        <div class="form-group" id="customIconGroup" style="display:${card.iconType === 'custom' ? 'block' : 'none'};">
          <label class="form-label">自定义图片 URL</label>
          <input class="form-input" name="customIconUrl" placeholder="https://..." value="${Icons.escapeHtml(card.iconType === 'custom' ? card.iconValue : '')}">
        </div>
      </div>
    `);

    if (result) {
      const data = getCapturedFormData();
      const iconType = data.iconType || 'favicon';
      card.name = data.name || card.name;
      card.url = data.url || card.url;
      card.iconType = iconType;
      if (iconType === 'emoji') {
        card.iconValue = data._selectedEmoji || '🌐';
      } else if (iconType === 'custom') {
        card.iconValue = data.customIconUrl || '';
      } else {
        card.iconValue = ''; // favicon 类型将由 Favicons 模块自动获取
      }
      card.updatedAt = now();
      return card;
    }
    return null;
  }

  /**
   * 设置图标类型切换事件
   */
  function setupIconTypeToggle() {
    const radios = document.querySelectorAll('input[name="iconType"]');
    const emojiContainer = document.getElementById('emojiPickerContainer');
    const customIconGroup = document.getElementById('customIconGroup');

    function toggle() {
      const selected = document.querySelector('input[name="iconType"]:checked');
      if (emojiContainer) emojiContainer.style.display = selected?.value === 'emoji' ? 'block' : 'none';
      if (customIconGroup) customIconGroup.style.display = selected?.value === 'custom' ? 'block' : 'none';
    }

    radios.forEach(radio => {
      radio.addEventListener('change', toggle);
    });
  }

  // ========== 删除操作 ==========

  /**
   * 删除（带撤销支持）
   */
  function deleteItem(config, type, groupId, subgroupId, itemId) {
    let deleted = null;

    switch (type) {
      case 'group': {
        const idx = config.groups.findIndex(g => g.id === itemId);
        if (idx !== -1) {
          deleted = config.groups.splice(idx, 1)[0];
        }
        break;
      }
      case 'subgroup': {
        const group = findGroup(config, groupId);
        if (group) {
          const idx = group.subgroups.findIndex(sg => sg.id === itemId);
          if (idx !== -1) {
            deleted = group.subgroups.splice(idx, 1)[0];
          }
        }
        break;
      }
      case 'card': {
        const group = findGroup(config, groupId);
        const subgroup = group ? findSubgroup(group, subgroupId) : null;
        if (subgroup) {
          const idx = subgroup.cards.findIndex(c => c.id === itemId);
          if (idx !== -1) {
            deleted = subgroup.cards.splice(idx, 1)[0];
          }
        }
        break;
      }
    }

    return deleted;
  }

  /**
   * 恢复删除
   */
  function restoreDelete(config, type, groupId, subgroupId, deleted) {
    if (!deleted) return false;

    switch (type) {
      case 'group': {
        config.groups.push(deleted);
        config.groups.sort((a, b) => a.order - b.order);
        break;
      }
      case 'subgroup': {
        const group = findGroup(config, groupId);
        if (group) {
          group.subgroups.push(deleted);
          group.subgroups.sort((a, b) => a.order - b.order);
        }
        break;
      }
      case 'card': {
        const group = findGroup(config, groupId);
        const subgroup = group ? findSubgroup(group, subgroupId) : null;
        if (subgroup) {
          subgroup.cards.push(deleted);
          subgroup.cards.sort((a, b) => a.order - b.order);
        }
        break;
      }
    }
    return true;
  }

  /**
   * 设置当前配置引用
   */
  function setConfig(config) {
    currentConfig = config;
  }

  // 弹窗事件绑定
  document.getElementById('modalClose').addEventListener('click', () => closeModal(null));
  document.getElementById('modalCancel').addEventListener('click', () => closeModal(null));
  document.getElementById('modalConfirm').addEventListener('click', () => closeModal(true));

  document.getElementById('modalOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal(null);
  });

  // Emoji 选择器事件委托
  document.getElementById('modalBody').addEventListener('click', (e) => {
    const option = e.target.closest('.emoji-option');
    if (option) {
      const picker = option.parentElement;
      picker.querySelectorAll('.emoji-option').forEach(o => o.classList.remove('selected'));
      option.classList.add('selected');
      const hiddenInput = picker.nextElementSibling;
      if (hiddenInput && hiddenInput.type === 'hidden') {
        hiddenInput.value = option.dataset.emoji;
      }
    }
  });

  // 键盘 Esc 关闭弹窗
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('modalOverlay').classList.contains('hidden')) {
      closeModal(null);
    }
  });

  return {
    showModal,
    closeModal,
    addGroup,
    editGroup,
    setActiveGroup,
    addSubgroup,
    editSubgroup,
    addCard,
    editCard,
    deleteItem,
    restoreDelete,
    setConfig
  };
})();
