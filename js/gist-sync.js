/**
 * GitHub Gist 同步 - GitHub Device Flow 授权，只同步仪表盘配置数据
 */
const GistSync = (() => {
  const SETTINGS_KEY = 'dashboard_gist_sync_settings';
  const GIST_API = 'https://api.github.com/gists';
  const GITHUB_API = 'https://api.github.com';
  const DEVICE_CODE_URL = 'https://github.com/login/device/code';
  const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
  const FILE_NAME = 'new-tab-dashboard-config.json';
  const MIN_POLL_INTERVAL = 5;
  const GITHUB_CLIENT_ID = 'Ov23liXnavaDA54sEiCK';

  function getDefaultSettings() {
    return {
      connected: false,
      token: '',
      gistId: '',
      account: null,
      lastSyncedAt: null,
      syncVersion: 0,
      lastConfigHash: '',
      localDirty: false,
      pendingConfigHash: ''
    };
  }

  async function loadSettings() {
    try {
      const result = await chrome.storage.local.get(SETTINGS_KEY);
      return { ...getDefaultSettings(), ...(result[SETTINGS_KEY] || {}) };
    } catch (error) {
      console.error('GistSync.loadSettings error:', error);
      return getDefaultSettings();
    }
  }

  async function saveSettings(settings) {
    const normalized = {
      ...getDefaultSettings(),
      ...(settings || {}),
      token: (settings?.token || '').trim(),
      gistId: normalizeGistId(settings?.gistId || '')
    };
    await chrome.storage.local.set({ [SETTINGS_KEY]: normalized });
    return normalized;
  }

  async function markLocalUpdated(config = null) {
    const settings = await loadSettings();
    const configHash = config ? getConfigHash(config) : '';

    if (!configHash) {
      return settings;
    }

    const isBackToSyncedState = Boolean(settings.lastConfigHash)
      && configHash === settings.lastConfigHash;

    if (isBackToSyncedState) {
      if (!settings.localDirty && !settings.pendingConfigHash) {
        return settings;
      }

      return saveSettings({
        ...settings,
        localDirty: false,
        pendingConfigHash: ''
      });
    }

    if (settings.localDirty && settings.pendingConfigHash === configHash) {
      return settings;
    }

    return saveSettings({
      ...settings,
      localDirty: true,
      pendingConfigHash: configHash
    });
  }

  function normalizeGistId(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';

    const gistMatch = trimmed.match(/gist\.github\.com\/(?:[^/]+\/)?([a-f0-9]+)/i);
    if (gistMatch) return gistMatch[1];

    const rawMatch = trimmed.match(/gist\.githubusercontent\.com\/[^/]+\/([a-f0-9]+)/i);
    if (rawMatch) return rawMatch[1];

    return trimmed;
  }

  async function getClientId() {
    return GITHUB_CLIENT_ID;
  }

  async function startDeviceFlow() {
    const clientId = await getClientId();
    if (!clientId) {
      throw new Error('请先在 js/gist-sync.js 中配置 GitHub OAuth App Client ID');
    }

    const response = await fetchViaExtension(DEVICE_CODE_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: clientId,
        scope: 'gist read:user'
      }).toString()
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`GitHub 授权初始化失败：${message || response.status}`);
    }

    const data = await response.json();
    return {
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUri: data.verification_uri,
      expiresAt: Date.now() + data.expires_in * 1000,
      interval: Math.max(data.interval || MIN_POLL_INTERVAL, MIN_POLL_INTERVAL)
    };
  }

  async function pollForToken(deviceCode, interval, expiresAt, onPending, signal) {
    const clientId = await getClientId();
    let pollInterval = Math.max(interval || MIN_POLL_INTERVAL, MIN_POLL_INTERVAL);

    while (Date.now() < expiresAt) {
      await delay(pollInterval * 1000, signal);
      throwIfAborted(signal);

      const response = await fetchViaExtension(ACCESS_TOKEN_URL, {
        method: 'POST',
        signal,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          client_id: clientId,
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        }).toString()
      });
      const data = await response.json();

      if (data.access_token) {
        return {
          accessToken: data.access_token,
          tokenType: data.token_type || 'bearer',
          scope: data.scope || ''
        };
      }

      if (data.error === 'authorization_pending') {
        onPending?.();
        continue;
      }

      if (data.error === 'slow_down') {
        pollInterval += 5;
        continue;
      }

      if (data.error === 'expired_token') {
        throw new Error('授权码已过期，请重新同步');
      }

      if (data.error === 'access_denied') {
      throw new Error('GitHub 授权已取消');
      }

      if (data.error) {
        throw new Error(data.error_description || data.error);
      }
    }

    throw new Error('授权码已过期，请重新同步');
  }

  async function authorize(deviceFlow, onPending, signal) {
    const tokens = await pollForToken(
      deviceFlow.deviceCode,
      deviceFlow.interval,
      deviceFlow.expiresAt,
      onPending,
      signal
    );
    const account = await getUserInfo(tokens.accessToken, signal);
    const settings = await loadSettings();

    return saveSettings({
      ...settings,
      connected: true,
      token: tokens.accessToken,
      account
    });
  }

  async function getUserInfo(token, signal) {
    const user = await githubRequest('/user', {
      method: 'GET',
      token,
      signal
    });

    return {
      id: String(user.id || user.login || ''),
      login: user.login || '',
      name: user.name || user.login || '',
      avatarUrl: user.avatar_url || ''
    };
  }

  async function syncConfig(config, options = {}) {
    const settings = await loadSettings();
    const token = settings.token;

    if (!token) {
      throw new Error('请先完成 GitHub 授权');
    }

    const localConfigHash = getConfigHash(config);
    const localVersion = Number(settings.syncVersion || 0);
    const localDirty = hasPendingLocalChanges(settings, localConfigHash);
    const remote = await readRemoteEnvelope(settings, options.signal);

    if (!remote) {
      const uploadVersion = localVersion > 0
        ? (localDirty ? localVersion + 1 : localVersion)
        : 1;
      const localEnvelope = buildSyncEnvelope(config, settings, { syncVersion: uploadVersion });
      const gist = await createGist(token, localEnvelope, options.signal);
      return completeSync({
        settings,
        token,
        gistId: gist.id,
        account: settings.account,
        config,
        syncVersion: uploadVersion,
        action: 'created'
      });
    }

    const remoteVersion = Number(remote.syncVersion || 0);
    const remoteHash = remote.configHash || getConfigHash(remote.config);

    if (remoteVersion > localVersion) {
      if (localDirty) {
        throw new Error(`同步冲突：服务器版本 ${remoteVersion} 更新，但本地也有未同步改动。请先备份或手动处理后再同步。`);
      }

      return completeSync({
        settings,
        token,
        gistId: remote.gistId,
        account: settings.account,
        config: remote.config,
        syncVersion: remoteVersion,
        action: 'pulled'
      });
    }

    if (remoteVersion === localVersion) {
      if (remoteHash === localConfigHash) {
        return completeSync({
          settings,
          token,
          gistId: remote.gistId,
          account: settings.account,
          config,
          syncVersion: localVersion,
          action: 'noop'
        });
      }

      if (localDirty && settings.lastConfigHash && remoteHash === settings.lastConfigHash) {
        const uploadVersion = localVersion + 1;
        const localEnvelope = buildSyncEnvelope(config, settings, { syncVersion: uploadVersion });
        await updateGist(token, remote.gistId, localEnvelope, options.signal);
        return completeSync({
          settings,
          token,
          gistId: remote.gistId,
          account: settings.account,
          config,
          syncVersion: uploadVersion,
          action: 'pushed'
        });
      }

      throw new Error(`同步冲突：本地和服务器版本都是 ${localVersion}，但配置内容不同。`);
    }

    const uploadVersion = localDirty ? localVersion + 1 : localVersion;
    const localEnvelope = buildSyncEnvelope(config, settings, { syncVersion: uploadVersion });
    await updateGist(token, remote.gistId, localEnvelope, options.signal);
    return completeSync({
      settings,
      token,
      gistId: remote.gistId,
      account: settings.account,
      config,
      syncVersion: uploadVersion,
      action: 'pushed'
    });
  }

  async function disconnect() {
    return saveSettings(getDefaultSettings());
  }

  async function readRemoteEnvelope(settings, signal) {
    const token = settings.token;
    const gistId = normalizeGistId(settings.gistId);

    if (gistId) {
      const gist = await githubRequest(`/gists/${encodeURIComponent(gistId)}`, {
        method: 'GET',
        token,
        signal
      });
      return parseGistConfig(gist, token, signal);
    }

    const gists = await githubRequest('/gists?per_page=100', {
      method: 'GET',
      token,
      signal
    });
    const gist = (gists || []).find(item => item.files?.[FILE_NAME]);
    if (!gist) return null;

    const fullGist = await githubRequest(`/gists/${encodeURIComponent(gist.id)}`, {
      method: 'GET',
      token,
      signal
    });
    return parseGistConfig(fullGist, token, signal);
  }

  async function parseGistConfig(gist, token, signal) {
    const file = gist.files?.[FILE_NAME];
    if (!file) return null;

    const content = file.truncated
      ? await fetchRawContent(file.raw_url, token, signal)
      : (file.content || await fetchRawContent(file.raw_url, token, signal));
    const parsed = JSON.parse(content);
    const envelope = parsed && parsed.config ? parsed : {
      syncVersion: Number(parsed?.syncVersion || 0),
      config: parsed
    };

    return {
      gistId: gist.id,
      syncVersion: Number(envelope.syncVersion || 0),
      config: normalizeRemoteConfig(envelope.config),
      configHash: envelope.configHash || getConfigHash(envelope.config)
    };
  }

  async function createGist(token, envelope, signal) {
    return githubRequest('/gists', {
      method: 'POST',
      token,
      signal,
      body: JSON.stringify({
        description: 'New Tab Dashboard configuration backup',
        public: false,
        files: {
          [FILE_NAME]: {
            content: JSON.stringify(envelope, null, 2)
          }
        }
      })
    });
  }

  async function updateGist(token, gistId, envelope, signal) {
    return githubRequest(`/gists/${encodeURIComponent(gistId)}`, {
      method: 'PATCH',
      token,
      signal,
      body: JSON.stringify({
        files: {
          [FILE_NAME]: {
            content: JSON.stringify(envelope, null, 2)
          }
        }
      })
    });
  }

  async function completeSync({ settings, token, gistId, account, config, syncVersion, action }) {
    const nowTime = Date.now();
    const savedSettings = await saveSettings({
      ...settings,
      connected: true,
      token,
      gistId,
      account,
      lastSyncedAt: nowTime,
      syncVersion: Number(syncVersion ?? settings.syncVersion ?? 0),
      lastConfigHash: getConfigHash(config),
      localDirty: false,
      pendingConfigHash: ''
    });

    return {
      action,
      config,
      settings: savedSettings
    };
  }

  function buildSyncEnvelope(config, settings = {}, options = {}) {
    const syncVersion = Number(options.syncVersion ?? settings.syncVersion ?? config.syncVersion ?? 0);
    return {
      app: 'new-tab-dashboard',
      file: FILE_NAME,
      syncVersion,
      configHash: getConfigHash(config),
      config: buildSyncConfig(config)
    };
  }

  function buildSyncConfig(config) {
    return {
      version: config.version || 1,
      settings: { ...(config.settings || {}) },
      groups: sanitizeGroupsForSync(config.groups)
    };
  }

  function getConfigHash(config) {
    return JSON.stringify(buildSyncConfig(config));
  }

  function hasPendingLocalChanges(settings, configHash) {
    if (settings.lastConfigHash && configHash === settings.lastConfigHash) {
      return false;
    }

    return Boolean(settings.localDirty)
      || Boolean(settings.pendingConfigHash && settings.pendingConfigHash === configHash);
  }

  function normalizeRemoteConfig(config) {
    if (!config || !Array.isArray(config.groups)) {
      throw new Error('Gist 中的配置文件格式不正确');
    }

    const defaults = Storage.getDefaultConfig();
    const worldClock = {
      ...defaults.settings.worldClock,
      ...(config.settings?.worldClock || {})
    };
    if (!Array.isArray(worldClock.countryCodes)) {
      worldClock.countryCodes = worldClock.countryCode
        ? [worldClock.countryCode]
        : [...defaults.settings.worldClock.countryCodes];
    }
    const groupDisplay = {
      ...defaults.settings.groupDisplay,
      ...(config.settings?.groupDisplay || {})
    };
    if (!Array.isArray(groupDisplay.visibleGroupIds)) {
      groupDisplay.visibleGroupIds = [...defaults.settings.groupDisplay.visibleGroupIds];
    }

    return {
      ...defaults,
      ...config,
      settings: {
        ...defaults.settings,
        ...(config.settings || {}),
        worldClock,
        groupDisplay
      },
      groups: sanitizeGroupsForSync(config.groups),
      _faviconCache: {}
    };
  }

  function sanitizeGroupsForSync(groups) {
    const clonedGroups = Array.isArray(groups) ? Storage.cloneConfig(groups) : [];

    clonedGroups.forEach(group => {
      (group.subgroups || []).forEach(subgroup => {
        (subgroup.cards || []).forEach(card => {
          if (card.iconType === 'favicon') {
            card.iconValue = '';
          }
        });
      });
    });

    return clonedGroups;
  }

  async function githubRequest(path, options = {}) {
    const { token, ...fetchOptions } = options;
    if (!token) {
      throw new Error('请先完成 GitHub 授权');
    }

    const response = await fetchViaExtension(`${GITHUB_API}${path}`, {
      ...fetchOptions,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(fetchOptions.body ? { 'Content-Type': 'application/json' } : {}),
        ...(fetchOptions.headers || {})
      }
    });

    if (!response.ok) {
      let message = `GitHub 请求失败 (${response.status})`;
      try {
        const data = await response.json();
        if (data.message) message = data.message;
      } catch {
        // 使用默认错误信息
      }
      if (message === 'Resource not accessible by integration') {
        message = '当前授权 token 不能访问 Gist。你填的 Client ID 很可能来自 GitHub App，请改用 Developer settings > OAuth Apps 里创建的 OAuth App Client ID。';
      }
      throw new Error(message);
    }

    if (response.status === 204) return null;
    return response.json();
  }

  async function fetchRawContent(url, token = '', signal) {
    if (!url) {
      throw new Error('Gist 文件内容为空');
    }

    const headers = token ? { Authorization: `Bearer ${token.trim()}` } : {};
    const response = await fetchViaExtension(url, { headers, signal });
    if (!response.ok) {
      throw new Error(`读取 Gist 文件失败 (${response.status})`);
    }
    return response.text();
  }

  function delay(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(createAbortError());
        return;
      }

      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);

      const onAbort = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(createAbortError());
      };

      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  function throwIfAborted(signal) {
    if (signal?.aborted) {
      throw createAbortError();
    }
  }

  function createAbortError() {
    const error = new Error('GitHub 授权已取消');
    error.name = 'AbortError';
    return error;
  }

  async function fetchViaExtension(url, options = {}) {
    const { signal, ...fetchOptions } = options;
    throwIfAborted(signal);

    if (!canUseRuntimeBridge()) {
      return fetch(url, { ...fetchOptions, signal });
    }

    const response = await chrome.runtime.sendMessage({
      type: 'github-fetch',
      url,
      method: fetchOptions.method || 'GET',
      headers: normalizeHeaders(fetchOptions.headers),
      body: normalizeBody(fetchOptions.body)
    });
    throwIfAborted(signal);

    if (!response) {
      throw new Error('GitHub 请求失败：后台服务未响应');
    }

    return {
      ok: Boolean(response.ok),
      status: Number(response.status || 0),
      statusText: response.statusText || '',
      async text() {
        return response.body || '';
      },
      async json() {
        const body = response.body || '{}';
        return JSON.parse(body);
      }
    };
  }

  function canUseRuntimeBridge() {
    return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.sendMessage);
  }

  function normalizeHeaders(headers = {}) {
    if (headers instanceof Headers) {
      return Object.fromEntries(headers.entries());
    }

    return { ...(headers || {}) };
  }

  function normalizeBody(body) {
    if (body instanceof URLSearchParams) {
      return body.toString();
    }

    return body;
  }

  function formatSyncTime(timestamp) {
    if (!timestamp) return '尚未同步';
    try {
      return new Date(timestamp).toLocaleString('zh-CN');
    } catch {
      return '尚未同步';
    }
  }

  return {
    FILE_NAME,
    loadSettings,
    saveSettings,
    markLocalUpdated,
    disconnect,
    startDeviceFlow,
    authorize,
    syncConfig,
    buildSyncEnvelope,
    buildSyncConfig,
    normalizeGistId,
    formatSyncTime
  };
})();
