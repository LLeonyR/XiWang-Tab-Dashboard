/**
 * 编辑模式控制器 - 增/删/改/弹窗管理
 */
const Editor = (() => {
  let modalResolve = null;
  let currentConfig = null;
  let _capturedFormData = null; // 在关闭弹窗前同步捕获的表单数据
  let _fetchedFaviconBase64 = null; // 弹窗中实时获取的 favicon base64

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

  // ========== 类别编辑 ==========

  /**
   * 添加类别
   */
  async function addGroup() {
    const result = await showModal('添加类别', `
      <div class="form-group">
        <label class="form-label">类别名称</label>
        <input class="form-input" name="name" placeholder="输入类别名称" value="">
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
        name: data.name || '新类别',
        icon: data._selectedEmoji || '📂',
        order: currentConfig.groups.length
      });
      currentConfig.groups.push(group);
      return group;
    }
    return null;
  }

  /**
   * 编辑类别
   */
  async function editGroup(group) {
    const result = await showModal('编辑类别', `
      <div class="form-group">
        <label class="form-label">类别名称</label>
        <input class="form-input" name="name" placeholder="输入类别名称" value="${Icons.escapeHtml(group.name)}">
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

  // ========== 分组编辑 ==========

  /**
   * 添加分组
   */
  async function addSubgroup(groupId) {
    const result = await showModal('添加分组', `
      <div class="form-group">
        <label class="form-label">分组名称</label>
        <input class="form-input" name="name" placeholder="输入分组名称" value="">
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
          name: data.name || '新分组',
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
   * 编辑分组
   */
  async function editSubgroup(groupId, subgroupId) {
    const group = findGroup(currentConfig, groupId);
    const subgroup = group ? findSubgroup(group, subgroupId) : null;
    if (!subgroup) return null;

    const result = await showModal('编辑分组', `
      <div class="form-group">
        <label class="form-label">分组名称</label>
        <input class="form-input" name="name" placeholder="输入分组名称" value="${Icons.escapeHtml(subgroup.name)}">
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

  /**
   * 移动分组到其他类别
   */
  async function moveSubgroup(groupId, subgroupId) {
    const sourceGroup = findGroup(currentConfig, groupId);
    const subgroup = sourceGroup ? findSubgroup(sourceGroup, subgroupId) : null;
    if (!sourceGroup || !subgroup) return null;

    const targetGroups = currentConfig.groups.filter(group => group.id !== groupId);
    if (targetGroups.length === 0) {
      if (typeof showToast === 'function') showToast('没有可移动到的其他类别');
      return null;
    }

    const defaultTargetGroup = targetGroups[0];
    const renderTargetLabel = (group) => `${Icons.escapeHtml(group.icon || '')} ${Icons.escapeHtml(group.name)}`;

    const result = await showModal('移动分组', `
      <div class="form-group">
        <label class="form-label">分组</label>
        <input class="form-input" value="${Icons.escapeHtml(subgroup.name)}" disabled>
      </div>
      <div class="form-group">
        <label class="form-label">移动到类别</label>
        <div class="form-choice" data-choice>
          <button type="button" class="form-choice-trigger" data-choice-trigger aria-haspopup="listbox" aria-expanded="false">
            <span data-choice-label>${renderTargetLabel(defaultTargetGroup)}</span>
          </button>
          <input type="hidden" name="targetGroupId" value="${defaultTargetGroup.id}">
          <div class="form-choice-menu" data-choice-menu role="listbox">
            ${targetGroups.map((group, index) => `
              <button type="button"
                      class="form-choice-option ${index === 0 ? 'selected' : ''}"
                      data-choice-option
                      data-value="${group.id}"
                      role="option"
                      aria-selected="${index === 0 ? 'true' : 'false'}">
                <span class="form-choice-check">✓</span>
                <span class="form-choice-option-label">${renderTargetLabel(group)}</span>
              </button>
            `).join('')}
          </div>
        </div>
      </div>
    `);

    if (!result) return null;

    const data = getCapturedFormData();
    return data.targetGroupId || null;
  }

  // ========== 卡片编辑 ==========

  /**
   * 添加卡片
   */
  async function addCard(groupId, subgroupId) {
    const result = await showModal('添加卡片', `
      <div class="form-group">
        <label class="form-label">卡片名称</label>
        <input class="form-input" name="name" placeholder="输入卡片名称" value="">
      </div>
      <div class="form-group">
        <label class="form-label">URL 地址</label>
        <input class="form-input" name="url" id="cardUrlInput" placeholder="https://example.com" value="">
        <span class="form-hint">请输入完整的网址，包含 http:// 或 https://</span>
      </div>
      <div class="form-group">
        <label class="form-label">图标类型</label>
        <div style="display:flex;gap:12px;padding:4px 0;">
          <label style="display:flex;align-items:center;gap:4px;cursor:pointer;">
            <input type="radio" name="iconType" value="emoji" checked> Emoji
          </label>
          <label style="display:flex;align-items:center;gap:4px;cursor:pointer;">
            <input type="radio" name="iconType" value="favicon"> 自动获取图标
          </label>
        </div>
        <div id="faviconPreviewContainer" style="display:none;margin-top:8px;"></div>
        <input type="hidden" name="_fetchedFavicon" id="fetchedFaviconInput" value="">
        <div id="emojiPickerContainer">
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
        const iconType = data.iconType || 'emoji';
        let iconValue;
        if (iconType === 'emoji') {
          iconValue = data._selectedEmoji || '🌐';
        } else if (iconType === 'custom') {
          iconValue = data.customIconUrl || '';
        } else {
          iconValue = data._fetchedFavicon || getCachedFavicon(data.url) || '';
        }
        const card = createCard({
          name: data.name || '新卡片',
          url: data.url || '',
          iconType: iconType,
          iconValue: iconValue,
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

    const isEmoji = card.iconType === 'emoji';
    const isFavicon = card.iconType === 'favicon';
    const isCustom = card.iconType === 'custom';

    const result = await showModal('编辑卡片', `
      <div class="form-group">
        <label class="form-label">卡片名称</label>
        <input class="form-input" name="name" placeholder="输入卡片名称" value="${Icons.escapeHtml(card.name)}">
      </div>
      <div class="form-group">
        <label class="form-label">URL 地址</label>
        <input class="form-input" name="url" id="cardUrlInput" placeholder="https://example.com" value="${Icons.escapeHtml(card.url || '')}">
        <span class="form-hint">请输入完整的网址，包含 http:// 或 https://</span>
      </div>
      <div class="form-group">
        <label class="form-label">图标类型</label>
        <div style="display:flex;gap:12px;padding:4px 0;">
          <label style="display:flex;align-items:center;gap:4px;cursor:pointer;">
            <input type="radio" name="iconType" value="emoji" ${isEmoji ? 'checked' : ''}> Emoji
          </label>
          <label style="display:flex;align-items:center;gap:4px;cursor:pointer;">
            <input type="radio" name="iconType" value="favicon" ${isFavicon ? 'checked' : ''}> 自动获取图标
          </label>
        </div>
        <div id="faviconPreviewContainer" style="display:none;margin-top:8px;"></div>
        <input type="hidden" name="_fetchedFavicon" id="fetchedFaviconInput" value="${isFavicon ? Icons.escapeHtml(card.iconValue || '') : ''}">
        <div id="emojiPickerContainer" style="display:${isEmoji ? 'block' : 'none'};">
          ${renderEmojiPicker(isEmoji ? card.iconValue : '🌐')}
          <input type="hidden" name="iconValue" value="${Icons.escapeHtml(card.iconValue || '')}">
        </div>
        <div class="form-group" id="customIconGroup" style="display:${isCustom ? 'block' : 'none'};">
          <label class="form-label">自定义图片 URL</label>
          <input class="form-input" name="customIconUrl" placeholder="https://..." value="${Icons.escapeHtml(isCustom ? card.iconValue : '')}">
        </div>
      </div>
    `);

    if (result) {
      const data = getCapturedFormData();
      const iconType = data.iconType || 'emoji';
      const previousIconType = card.iconType;
      const previousIconValue = card.iconValue;
      card.name = data.name || card.name;
      card.url = data.url || card.url;
      card.iconType = iconType;
      if (iconType === 'emoji') {
        card.iconValue = data._selectedEmoji || '🌐';
      } else if (iconType === 'custom') {
        card.iconValue = data.customIconUrl || '';
      } else {
        // favicon: 优先使用本次获取的，否则保留原有值
        card.iconValue = data._fetchedFavicon || getCachedFavicon(data.url) || (previousIconType === 'favicon' ? previousIconValue : '') || '';
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
    const faviconPreviewContainer = document.getElementById('faviconPreviewContainer');
    const urlInput = document.getElementById('cardUrlInput');
    let faviconFetchToken = 0;
    let faviconDebounceTimer = null;

    function toggle() {
      const selected = document.querySelector('input[name="iconType"]:checked');
      if (emojiContainer) emojiContainer.style.display = selected?.value === 'emoji' ? 'block' : 'none';
      if (customIconGroup) customIconGroup.style.display = selected?.value === 'custom' ? 'block' : 'none';

      if (faviconPreviewContainer) {
        faviconPreviewContainer.style.display = selected?.value === 'favicon' ? 'block' : 'none';
      }

      if (selected?.value === 'favicon') {
        updateFaviconPreview();
      }
    }

    radios.forEach(radio => {
      radio.addEventListener('change', toggle);
    });

    if (urlInput) {
      urlInput.addEventListener('input', () => {
        const selected = document.querySelector('input[name="iconType"]:checked');
        if (selected?.value !== 'favicon') return;

        clearTimeout(faviconDebounceTimer);
        faviconDebounceTimer = setTimeout(updateFaviconPreview, 350);
      });
    }

    toggle();

    function updateFaviconPreview() {
      if (!faviconPreviewContainer || !urlInput) return;

      const url = urlInput.value.trim();
      const hiddenInput = document.getElementById('fetchedFaviconInput');
      if (hiddenInput) hiddenInput.value = '';

      if (!isUsableHttpUrl(url)) {
        faviconPreviewContainer.innerHTML = renderFaviconPreview({
          status: '请输入可访问的 http:// 或 https:// URL',
          state: 'error',
          iconHtml: '<span class="favicon-placeholder">🌐</span>',
          loading: false
        });
        return;
      }

      const token = ++faviconFetchToken;
      faviconPreviewContainer.innerHTML = renderFaviconPreview({
        status: '正在获取网站图标...',
        state: '',
        iconHtml: '<span class="favicon-placeholder">🌐</span>',
        loading: true
      });

      Favicons.fetchForDomain(url, currentConfig).then((favicon) => {
        if (token !== faviconFetchToken) return;

        if (favicon) {
          if (hiddenInput) hiddenInput.value = favicon;
          faviconPreviewContainer.innerHTML = renderFaviconPreview({
            status: '图标获取成功',
            state: 'success',
            iconHtml: `<img src="${Icons.escapeHtml(favicon)}" alt="">`,
            loading: false
          });
        } else {
          faviconPreviewContainer.innerHTML = renderFaviconPreview({
            status: '未能获取图标，请检查 URL 或稍后重试',
            state: 'error',
            iconHtml: '<span class="favicon-placeholder">🌐</span>',
            loading: false
          });
        }
      });
    }
  }

  function renderFaviconPreview({ status, state, iconHtml, loading }) {
    return `
      <div class="favicon-preview-panel">
        <div class="favicon-preview-icon">${iconHtml}</div>
        <div class="favicon-preview-meta">
          <div class="favicon-preview-status ${state || ''}">${Icons.escapeHtml(status)}</div>
          ${loading ? '<div class="favicon-progress"><div class="favicon-progress-bar"></div></div>' : ''}
        </div>
      </div>
    `;
  }

  function isUsableHttpUrl(value) {
    try {
      const url = new URL(value);
      return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname);
    } catch {
      return false;
    }
  }

  function getCachedFavicon(urlValue) {
    try {
      if (!currentConfig || !urlValue) return '';
      const domain = new URL(urlValue).hostname;
      const entry = currentConfig._faviconCache?.[domain];
      if (typeof entry === 'string') return entry;
      if (entry && entry.value) return entry.value;
    } catch {
      // 忽略无效 URL
    }
    return '';
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

    const choiceTrigger = e.target.closest('[data-choice-trigger]');
    if (choiceTrigger) {
      const choice = choiceTrigger.closest('[data-choice]');
      document.querySelectorAll('#modalBody [data-choice].open').forEach(item => {
        if (item !== choice) {
          item.classList.remove('open', 'open-up');
          item.querySelector('[data-choice-trigger]')?.setAttribute('aria-expanded', 'false');
        }
      });
      const isOpen = choice.classList.toggle('open');
      choiceTrigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      if (isOpen) {
        updateChoiceMenuPlacement(choice);
      } else {
        choice.classList.remove('open-up');
      }
      return;
    }

    const choiceOption = e.target.closest('[data-choice-option]');
    if (choiceOption) {
      const choice = choiceOption.closest('[data-choice]');
      const hiddenInput = choice.querySelector('input[type="hidden"]');
      const label = choice.querySelector('[data-choice-label]');
      const trigger = choice.querySelector('[data-choice-trigger]');
      const optionLabel = choiceOption.querySelector('.form-choice-option-label');

      choice.querySelectorAll('[data-choice-option]').forEach(item => {
        item.classList.remove('selected');
        item.setAttribute('aria-selected', 'false');
      });
      choiceOption.classList.add('selected');
      choiceOption.setAttribute('aria-selected', 'true');

      if (hiddenInput) hiddenInput.value = choiceOption.dataset.value || '';
      if (label && optionLabel) label.textContent = optionLabel.textContent;
      choice.classList.remove('open');
      choice.classList.remove('open-up');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
    }
  });

  function updateChoiceMenuPlacement(choice) {
    const menu = choice.querySelector('[data-choice-menu]');
    const trigger = choice.querySelector('[data-choice-trigger]');
    const modalBox = document.getElementById('modalBox');
    if (!menu || !trigger || !modalBox) return;

    const gap = 8;
    const minHeight = 72;
    const triggerRect = trigger.getBoundingClientRect();
    const modalRect = modalBox.getBoundingClientRect();
    const spaceBelow = modalRect.bottom - triggerRect.bottom - gap;
    const spaceAbove = triggerRect.top - modalRect.top - gap;
    const openUp = spaceBelow < minHeight && spaceAbove > spaceBelow;
    const availableHeight = Math.max(minHeight, Math.floor((openUp ? spaceAbove : spaceBelow) - gap));

    choice.classList.toggle('open-up', openUp);
    menu.style.maxHeight = `${Math.min(180, availableHeight)}px`;
  }

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
    moveSubgroup,
    addCard,
    editCard,
    deleteItem,
    restoreDelete,
    setConfig
  };
})();
