/**
 * 数据模型工厂 & 工具函数
 */

/**
 * 生成唯一 ID
 */
function generateId(prefix) {
  const hex = Math.random().toString(16).slice(2, 10);
  return `${prefix}_${hex}`;
}

/**
 * 获取当前时间戳
 */
function now() {
  return Date.now();
}

/**
 * 创建卡片
 */
function createCard(data = {}) {
  return {
    id: data.id || generateId('card'),
    type: 'card',
    name: data.name || '新卡片',
    url: data.url || '',
    iconType: data.iconType || 'favicon', // 'emoji' | 'favicon' | 'custom'
    iconValue: data.iconValue || '',
    order: data.order !== undefined ? data.order : 0,
    createdAt: data.createdAt || now(),
    updatedAt: now()
  };
}

/**
 * 创建分组
 */
function createSubgroup(data = {}) {
  return {
    id: data.id || generateId('sg'),
    type: 'subgroup',
    name: data.name || '新分组',
    icon: data.icon || '📁',
    order: data.order !== undefined ? data.order : 0,
    displayMode: data.displayMode || 'comfortable', // 'compact' | 'comfortable'
    collapsed: data.collapsed || false,
    cards: (data.cards || []).map(c => createCard(c)),
    createdAt: data.createdAt || now(),
    updatedAt: now()
  };
}

/**
 * 创建分组
 */
function createGroup(data = {}) {
  return {
    id: data.id || generateId('group'),
    type: 'group',
    name: data.name || '新分组',
    icon: data.icon || '📂',
    order: data.order !== undefined ? data.order : 0,
    subgroups: (data.subgroups || []).map(sg => createSubgroup(sg)),
    createdAt: data.createdAt || now(),
    updatedAt: now()
  };
}

/**
 * 获取默认配置数据（从 mtab_urls.json 导入）
 */
function getDefaultSampleConfig() {
  // 深拷贝以防止运行时修改
  return JSON.parse(JSON.stringify(MtabDefaultData));
}

/**
 * 在配置中查找分组
 */
function findGroup(config, groupId) {
  return config.groups.find(g => g.id === groupId);
}

/**
 * 获取当前激活的分组
 */
function getActiveGroup(config) {
  const activeId = config.settings.activeGroupId;
  if (activeId) {
    const group = findGroup(config, activeId);
    if (group) return group;
  }
  // 回退到第一个分组
  if (config.groups.length > 0) {
    return config.groups[0];
  }
  return null;
}

/**
 * 在分组中查找小分组
 */
function findSubgroup(group, subgroupId) {
  return group.subgroups.find(sg => sg.id === subgroupId);
}

/**
 * 在小分组中查找卡片
 */
function findCard(subgroup, cardId) {
  return subgroup.cards.find(c => c.id === cardId);
}

/**
 * 重新排序数组
 */
function reorderArray(arr, fromIndex, toIndex) {
  const result = [...arr];
  const [item] = result.splice(fromIndex, 1);
  result.splice(toIndex, 0, item);
  // 更新 order 字段
  result.forEach((item, index) => { item.order = index; });
  return result;
}
