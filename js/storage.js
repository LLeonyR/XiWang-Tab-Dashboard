/**
 * 数据持久化层 - chrome.storage.local 读写封装
 */
const Storage = (() => {
  const STORAGE_KEY = 'dashboard_config';

  /**
   * 获取默认配置（用于首次使用或数据损坏时的回退）
   */
  function getDefaultConfig() {
    return {
      version: 1,
      settings: {
        theme: 'auto',
        activeGroupId: null,
        language: 'zh_CN'
      },
      groups: [],
      _faviconCache: {}
    };
  }

  /**
   * 加载配置
   */
  async function loadConfig() {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      if (result[STORAGE_KEY]) {
        // 合并默认配置以确保兼容性
        return mergeDefaults(result[STORAGE_KEY], getDefaultConfig());
      }
      const defaults = getDefaultConfig();
      await saveConfig(defaults, { markDirty: false });
      return defaults;
    } catch (error) {
      console.error('Storage.loadConfig error:', error);
      return getDefaultConfig();
    }
  }

  /**
   * 保存配置
   */
  async function saveConfig(config, options = {}) {
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: config });
      if (options.markDirty !== false && typeof GistSync !== 'undefined') {
        await GistSync.markLocalUpdated(config);
      }
    } catch (error) {
      console.error('Storage.saveConfig error:', error);
      throw error;
    }
  }

  /**
   * 监听配置变化（用于多标签页同步）
   */
  function onConfigChanged(callback) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes[STORAGE_KEY]) {
        callback(changes[STORAGE_KEY].newValue);
      }
    });
  }

  /**
   * 导出配置为 JSON 文件
   */
  async function exportConfig() {
    const config = await loadConfig();
    const jsonStr = JSON.stringify(config, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `dashboard-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * 从 JSON 文件导入配置
   */
  function importConfig(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const config = JSON.parse(e.target.result);
          if (!config.groups || !Array.isArray(config.groups)) {
            throw new Error('配置文件格式不正确');
          }
          await saveConfig(config);
          resolve(config);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsText(file);
    });
  }

  /**
   * 合并默认配置，确保版本兼容
   */
  function mergeDefaults(config, defaults) {
    const merged = { ...defaults, ...config };
    merged.settings = { ...defaults.settings, ...(config.settings || {}) };
    if (!merged._faviconCache) merged._faviconCache = {};
    return merged;
  }

  /**
   * 深拷贝配置（避免直接修改引用）
   */
  function cloneConfig(config) {
    return JSON.parse(JSON.stringify(config));
  }

  return {
    STORAGE_KEY,
    getDefaultConfig,
    loadConfig,
    saveConfig,
    onConfigChanged,
    exportConfig,
    importConfig,
    cloneConfig
  };
})();
