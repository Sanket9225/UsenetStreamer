(function () {
  const storageKey = 'usenetstreamer.adminToken';
  const tokenInput = document.getElementById('tokenInput');
  const loadButton = document.getElementById('loadConfig');
  const authError = document.getElementById('authError');
  const configSection = document.getElementById('configSection');
  const configForm = document.getElementById('configForm');
  const manifestLink = document.getElementById('manifestLink');
  const manifestDescription = document.getElementById('manifestDescription');
  const saveStatus = document.getElementById('saveStatus');
  const copyManifestButton = document.getElementById('copyManifest');
  const copyManifestStatus = document.getElementById('copyManifestStatus');

  let copyStatusTimer = null;

  let runtimeEnvPath = null;

  function getStoredToken() {
    return localStorage.getItem(storageKey) || '';
  }

  function extractTokenFromPath() {
    const match = window.location.pathname.match(/^\/([^/]+)\/admin(?:\/|$)/i);
    return match ? decodeURIComponent(match[1]) : '';
  }

  function setStoredToken(token) {
    if (!token) {
      localStorage.removeItem(storageKey);
      return;
    }
    localStorage.setItem(storageKey, token);
  }

  function getToken() {
    return tokenInput.value.trim();
  }

  function setToken(token) {
    tokenInput.value = token;
    setStoredToken(token);
  }

  function markLoading(isLoading) {
    loadButton.disabled = isLoading;
    loadButton.textContent = isLoading ? 'Loading...' : 'Load Configuration';
  }

  function markSaving(isSaving) {
    const submitButton = configForm.querySelector('button[type="submit"]');
    if (submitButton) {
      submitButton.disabled = isSaving;
      submitButton.textContent = isSaving ? 'Saving...' : 'Save & Restart';
    }
  }

  function parseBool(value) {
    if (typeof value === 'boolean') return value;
    if (value === null || value === undefined) return false;
    const normalized = String(value).trim().toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(normalized);
  }

  function populateForm(values) {
    const elements = configForm.querySelectorAll('input[name], select[name], textarea[name]');
    elements.forEach((element) => {
      const key = element.name;
      if (key.startsWith('NEWZNAB_ENDPOINT_') || key.startsWith('NEWZNAB_API_KEY_') || key.startsWith('NEWZNAB_API_PATH_') || key.startsWith('NEWZNAB_NAME_')) {
        // handled below
        return;
      }
      const rawValue = Object.prototype.hasOwnProperty.call(values, key) ? values[key] : '';
      if (element.type === 'checkbox') {
        element.checked = parseBool(rawValue);
      } else if (element.type === 'number' && rawValue === '') {
        element.value = '';
      } else {
        element.value = rawValue ?? '';
      }
    });
    // Populate dynamic Newznab indexers
    const indexerRows = [];
    let i = 1;
    while (values[`NEWZNAB_ENDPOINT_${String(i).padStart(2, '0')}`]) {
      indexerRows.push({
        endpoint: values[`NEWZNAB_ENDPOINT_${String(i).padStart(2, '0')}`] || '',
        apiKey: values[`NEWZNAB_API_KEY_${String(i).padStart(2, '0')}`] || '',
        apiPath: values[`NEWZNAB_API_PATH_${String(i).padStart(2, '0')}`] || '',
        name: values[`NEWZNAB_NAME_${String(i).padStart(2, '0')}`] || '',
        enabled: parseBool(values[`NEWZNAB_INDEXER_ENABLED_${String(i).padStart(2, '0')}`] ?? 'true')
      });
      i++;
    }
    renderNewznabIndexers(indexerRows);
  }

  function collectFormValues() {
    const payload = {};
    const elements = configForm.querySelectorAll('input[name], select[name], textarea[name]');
    elements.forEach((element) => {
      const key = element.name;
      if (!key) return;
      if (key.startsWith('NEWZNAB_ENDPOINT_') || key.startsWith('NEWZNAB_API_KEY_') || key.startsWith('NEWZNAB_API_PATH_') || key.startsWith('NEWZNAB_NAME_')) {
        // handled below
        return;
      }
      if (element.type === 'checkbox') {
        payload[key] = element.checked ? 'true' : 'false';
      } else {
        payload[key] = element.value != null ? element.value.toString() : '';
      }
    });
    // Gather dynamic Newznab indexers
    const rows = document.querySelectorAll('.newznab-indexer-row');
    let i = 1;
    rows.forEach((row) => {
      const endpoint = row.querySelector('input[name^="NEWZNAB_ENDPOINT_"]')?.value || '';
      const apiKey = row.querySelector('input[name^="NEWZNAB_API_KEY_"]')?.value || '';
      const apiPath = row.querySelector('input[name^="NEWZNAB_API_PATH_"]')?.value || '';
      const name = row.querySelector('input[name^="NEWZNAB_NAME_"]')?.value || '';
      const enabled = !!row.querySelector('input[name^="NEWZNAB_INDEXER_ENABLED_"]')?.checked;
      if (endpoint) {
        const idx = String(i).padStart(2, '0');
        payload[`NEWZNAB_ENDPOINT_${idx}`] = endpoint;
        payload[`NEWZNAB_API_KEY_${idx}`] = apiKey;
        payload[`NEWZNAB_API_PATH_${idx}`] = apiPath;
        payload[`NEWZNAB_NAME_${idx}`] = name;
        payload[`NEWZNAB_INDEXER_ENABLED_${idx}`] = enabled ? 'true' : 'false';
        i++;
      }
    });
    return payload;
  }

  const KNOWN_NEWZNAB_INDEXERS = [
    { id: 'custom', label: 'Custom', endpoint: '', apiPath: '', name: '' },
    { id: 'althub', label: 'AltHUB', endpoint: 'https://api.althub.co.za', apiPath: '/api', name: 'AltHUB' },
    { id: 'nzbgeek', label: 'NZBGeek', endpoint: 'https://api.nzbgeek.info', apiPath: '/api', name: 'NZBGeek' },
    { id: 'drunkenslug', label: 'DrunkenSlug', endpoint: 'https://api.drunkenslug.com', apiPath: '/api', name: 'DrunkenSlug' },
    { id: 'nzbplanet', label: 'NZBPlanet', endpoint: 'https://api.nzbplanet.net', apiPath: '/api', name: 'NZBPlanet' },
    { id: 'dognzb', label: 'DOGnzb', endpoint: 'https://api.dognzb.cr', apiPath: '/api', name: 'DOGnzb' },
    { id: 'usenet_crawler', label: 'Usenet-Crawler', endpoint: 'https://www.usenet-crawler.com', apiPath: '/api', name: 'Usenet-Crawler' },
    { id: 'nzb_su', label: 'NZB.su', endpoint: 'https://nzb.su', apiPath: '/api', name: 'NZB.su' },
    { id: 'oznzb', label: 'OZnzb', endpoint: 'https://api.oznzb.com', apiPath: '/api', name: 'OZnzb' },
    { id: 'nzbfinder', label: 'NZBFinder', endpoint: 'https://api.nzbfinder.ws', apiPath: '/api', name: 'NZBFinder' },
  ];

  function renderNewznabIndexers(indexers) {
    const container = document.getElementById('newznab-indexers-list');
    if (!container) return;
    container.innerHTML = '';
    (indexers && indexers.length ? indexers : []).forEach((row, idx) => {
      const i = String(idx + 1).padStart(2, '0');
      const div = document.createElement('div');
      div.className = 'newznab-indexer-row';
  const expanded = row.expanded !== false; // default expanded unless explicitly collapsed
      div.innerHTML = `
        <div class="row-header">
          <span class="index-badge">#${i}</span>
          <button type="button" class="tiny-btn toggle-details" aria-expanded="${expanded ? 'true' : 'false'}">${expanded ? 'Hide details' : 'Show details'}</button>
        </div>
        <div class="row-details ${expanded ? '' : 'collapsed'}">
          <div class="row-grid">
          <label class="checkbox"><input name="NEWZNAB_INDEXER_ENABLED_${i}" type="checkbox" ${row.enabled !== false ? 'checked' : ''}/> <span>Enabled</span></label>
          <label>Name
            <input name="NEWZNAB_NAME_${i}" type="text" placeholder="AltHUB" value="${row.name || ''}" />
          </label>
          <label>Endpoint
            <input name="NEWZNAB_ENDPOINT_${i}" type="url" placeholder="https://indexer.example" value="${row.endpoint || ''}" />
          </label>
          <label>API Path
            <input class="api-path-input" name="NEWZNAB_API_PATH_${i}" type="text" placeholder="/api" value="${row.apiPath || '/api'}" />
          </label>
          <label>API Key
            <div class="input-inline">
              <input class="api-key-input" name="NEWZNAB_API_KEY_${i}" type="password" placeholder="apikey" value="${row.apiKey || ''}" />
              <button type="button" class="tiny-btn toggle-secret" data-target="NEWZNAB_API_KEY_${i}">Show</button>
            </div>
          </label>
            <div class="row-actions">
              <button type="button" class="tiny-btn test-indexer">Test</button>
              <span class="status-inline" data-status="row"></span>
              <button type="button" class="tiny-btn move-up" title="Move up">▲</button>
              <button type="button" class="tiny-btn move-down" title="Move down">▼</button>
              <button type="button" class="tiny-btn remove-indexer" title="Remove">Remove</button>
            </div>
          </div>
        </div>
      `;
      div.querySelector('.remove-indexer').addEventListener('click', () => {
        const newList = (indexers || []).slice();
        newList.splice(idx, 1);
        renderNewznabIndexers(newList);
      });
      // Toggle row details expand/collapse
      const toggleBtn = div.querySelector('.toggle-details');
      const detailsEl = div.querySelector('.row-details');
      toggleBtn?.addEventListener('click', () => {
        const isCollapsed = detailsEl.classList.toggle('collapsed');
        toggleBtn.setAttribute('aria-expanded', String(!isCollapsed));
        toggleBtn.textContent = isCollapsed ? 'Show details' : 'Hide details';
      });
      // No per-row preset anymore; preset is managed at the top bar
      // Toggle API key visibility
      div.querySelector('.toggle-secret')?.addEventListener('click', (ev) => {
        const btn = ev.currentTarget;
        const target = div.querySelector(`input[name="${btn.dataset.target}"]`);
        if (!target) return;
        const nextType = target.type === 'password' ? 'text' : 'password';
        target.type = nextType;
        btn.textContent = nextType === 'password' ? 'Show' : 'Hide';
      });
      // Normalize inputs
      const endpointEl = div.querySelector(`input[name="NEWZNAB_ENDPOINT_${i}"]`);
      const pathEl = div.querySelector(`input[name="NEWZNAB_API_PATH_${i}"]`);
      endpointEl?.addEventListener('blur', () => {
        if (!endpointEl.value) return;
        endpointEl.value = endpointEl.value.replace(/\/+$/, '');
      });
      pathEl?.addEventListener('blur', () => {
        let v = (pathEl.value || '').trim();
        if (!v) v = '/api';
        if (!v.startsWith('/')) v = `/${v}`;
        v = v.replace(/\/+$/, '');
        pathEl.value = v || '/api';
      });
      // Row-level test button
      div.querySelector('.test-indexer')?.addEventListener('click', async () => {
        const statusEl = div.querySelector('[data-status="row"]');
        const nameVal = div.querySelector(`input[name="NEWZNAB_NAME_${i}"]`)?.value || '';
        const epVal = endpointEl?.value || '';
        const pathVal = pathEl?.value || '/api';
        const keyVal = div.querySelector(`input[name="NEWZNAB_API_KEY_${i}"]`)?.value || '';
        if (!epVal) {
          statusEl.textContent = 'Endpoint is required';
          statusEl.classList.remove('success');
          statusEl.classList.add('error');
          return;
        }
        if (!keyVal) {
          statusEl.textContent = 'API key is required';
          statusEl.classList.remove('success');
          statusEl.classList.add('error');
          return;
        }
        statusEl.textContent = 'Testing...';
        statusEl.classList.remove('error', 'success');
        try {
          const testValues = {
            NEWZNAB_ENABLED: 'true',
            NEWZNAB_NAME_01: nameVal,
            NEWZNAB_ENDPOINT_01: epVal,
            NEWZNAB_API_PATH_01: pathVal,
            NEWZNAB_API_KEY_01: keyVal,
          };
          const result = await apiRequest('/admin/api/test-connections', {
            method: 'POST',
            body: JSON.stringify({ type: 'newznab', values: testValues }),
          });
          if (result?.status === 'ok') {
            statusEl.textContent = result.message || 'OK';
            statusEl.classList.remove('error');
            statusEl.classList.add('success');
          } else {
            statusEl.textContent = result?.message || 'Failed';
            statusEl.classList.remove('success');
            statusEl.classList.add('error');
          }
        } catch (err) {
          statusEl.textContent = err?.message || 'Request failed';
          statusEl.classList.remove('success');
          statusEl.classList.add('error');
        }
      });
      // Reordering
      div.querySelector('.move-up')?.addEventListener('click', () => {
        if (idx === 0) return;
        const newList = (indexers || []).slice();
        const tmp = newList[idx - 1];
        newList[idx - 1] = newList[idx];
        newList[idx] = tmp;
        renderNewznabIndexers(newList);
      });
      div.querySelector('.move-down')?.addEventListener('click', () => {
        const newList = (indexers || []).slice();
        if (idx >= newList.length - 1) return;
        const tmp = newList[idx + 1];
        newList[idx + 1] = newList[idx];
        newList[idx] = tmp;
        renderNewznabIndexers(newList);
      });
      container.appendChild(div);
    });
  }

  // Add Newznab indexer row (ensure DOM is ready)
  window.addEventListener('DOMContentLoaded', () => {
    const addBtn = document.getElementById('addNewznabIndexer');
    const presetSelect = document.getElementById('newznabPreset');
    const addPresetBtn = document.getElementById('addPresetIndexer');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        const container = document.getElementById('newznab-indexers-list');
        const rows = Array.from(container.querySelectorAll('.newznab-indexer-row'));
        const indexers = rows.map((row) => ({
          endpoint: row.querySelector('input[name^="NEWZNAB_ENDPOINT_"]')?.value || '',
          apiKey: row.querySelector('input[name^="NEWZNAB_API_KEY_"]')?.value || '',
          apiPath: row.querySelector('input[name^="NEWZNAB_API_PATH_"]')?.value || '',
          name: row.querySelector('input[name^="NEWZNAB_NAME_"]')?.value || '',
          enabled: !!row.querySelector('input[name^="NEWZNAB_INDEXER_ENABLED_"]')?.checked,
          expanded: !row.querySelector('.row-details')?.classList.contains('collapsed'),
        }));
        indexers.push({ endpoint: '', apiKey: '', apiPath: '/api', name: '', enabled: true, expanded: true });
        renderNewznabIndexers(indexers);
      });
    }
    // Populate preset dropdown
    if (presetSelect) {
      presetSelect.innerHTML = KNOWN_NEWZNAB_INDEXERS.map(p => `<option value="${p.id}">${p.label}</option>`).join('');
    }
    // Add from preset handler
    if (addPresetBtn) {
      addPresetBtn.addEventListener('click', () => {
        if (!presetSelect) return;
        const id = presetSelect.value;
        const preset = KNOWN_NEWZNAB_INDEXERS.find(p => p.id === id) || KNOWN_NEWZNAB_INDEXERS[0];
        const container = document.getElementById('newznab-indexers-list');
        const rows = Array.from(container.querySelectorAll('.newznab-indexer-row'));
        const indexers = rows.map((row) => ({
          endpoint: row.querySelector('input[name^="NEWZNAB_ENDPOINT_"]')?.value || '',
          apiKey: row.querySelector('input[name^="NEWZNAB_API_KEY_"]')?.value || '',
          apiPath: row.querySelector('input[name^="NEWZNAB_API_PATH_"]')?.value || '',
          name: row.querySelector('input[name^="NEWZNAB_NAME_"]')?.value || '',
          enabled: !!row.querySelector('input[name^="NEWZNAB_INDEXER_ENABLED_"]')?.checked,
          expanded: !row.querySelector('.row-details')?.classList.contains('collapsed'),
        }));
        if (preset && preset.id !== 'custom') {
          indexers.push({ endpoint: preset.endpoint || '', apiKey: '', apiPath: preset.apiPath || '/api', name: preset.name || preset.label || '', enabled: true, expanded: true });
        } else {
          indexers.push({ endpoint: '', apiKey: '', apiPath: '/api', name: '', enabled: true, expanded: true });
        }
        renderNewznabIndexers(indexers);
      });
    }
  });

  function setTestStatus(type, message, isError) {
    const el = configForm.querySelector(`[data-test-status="${type}"]`);
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('error', Boolean(message && isError));
    el.classList.toggle('success', Boolean(message && !isError));
  }

  async function runConnectionTest(button) {
    const type = button?.dataset?.test;
    if (!type) return;
    const originalText = button.textContent;
    setTestStatus(type, '', false);
    button.disabled = true;
    button.textContent = 'Testing...';
    try {
      const values = collectFormValues();
      // Enforce API key presence only if global NEWZNAB_ENABLED is true
      const enabledGlobal = configForm.querySelector('input[name="NEWZNAB_ENABLED"]')?.checked;
      if (enabledGlobal) {
        const rows = Array.from(document.querySelectorAll('.newznab-indexer-row'));
        for (const row of rows) {
          const enabled = !!row.querySelector('input[name^="NEWZNAB_INDEXER_ENABLED_"]')?.checked;
          const ep = row.querySelector('input[name^="NEWZNAB_ENDPOINT_"]')?.value?.trim();
          const key = row.querySelector('input[name^="NEWZNAB_API_KEY_"]')?.value?.trim();
          if (enabled && ep && !key) {
            throw new Error('API key is required for all enabled Newznab indexers when Direct Newznab Queries are enabled');
          }
        }
      }
      const result = await apiRequest('/admin/api/test-connections', {
        method: 'POST',
        body: JSON.stringify({ type, values }),
      });
      if (result?.status === 'ok') {
        setTestStatus(type, result.message || 'Connection succeeded.', false);
      } else {
        setTestStatus(type, result?.message || 'Connection failed.', true);
      }
    } catch (error) {
      setTestStatus(type, error.message || 'Request failed.', true);
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  async function apiRequest(path, options = {}) {
    const token = getToken();
    if (!token) throw new Error('Addon token is required');

    const headers = Object.assign({}, options.headers || {}, {
      'X-Addon-Token': token,
    });

    if (options.body) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(path, Object.assign({}, options, { headers }));
    if (!response.ok) {
      let message = response.statusText;
      try {
        const body = await response.json();
        if (body && body.error) message = body.error;
      } catch (err) {
        // ignore json parse errors
      }
      if (response.status === 401) {
        throw new Error('Unauthorized: check your addon token');
      }
      throw new Error(message || 'Request failed');
    }
    if (response.status === 204) return null;
    return response.json();
  }

  async function loadConfiguration() {
    authError.classList.add('hidden');
    markLoading(true);
    saveStatus.textContent = '';

    try {
      const data = await apiRequest('/admin/api/config');
      populateForm(data.values || {});
      syncHealthControls();
      syncSortingControls();
      configSection.classList.remove('hidden');
      updateManifestLink(data.manifestUrl || '');
      runtimeEnvPath = data.runtimeEnvPath || null;
      const baseMessage = 'Add this manifest to Stremio once HTTPS is set.';
      manifestDescription.textContent = baseMessage;
      const testSearchContainer = document.getElementById('newznab-test-search');
      if (testSearchContainer) {
        if (data.debugNewznabSearch) testSearchContainer.classList.remove('hidden');
        else testSearchContainer.classList.add('hidden');
      }
    } catch (error) {
      authError.textContent = error.message;
      authError.classList.remove('hidden');
      configSection.classList.add('hidden');
    } finally {
      markLoading(false);
    }
  }

  function updateManifestLink(url) {
    if (!url) {
      manifestLink.textContent = 'Not configured';
      manifestLink.removeAttribute('href');
      setCopyButtonState(false);
      if (copyManifestStatus) copyManifestStatus.textContent = '';
      return;
    }
    manifestLink.textContent = url;
    manifestLink.href = url;
    setCopyButtonState(true);
    if (copyManifestStatus) copyManifestStatus.textContent = '';
  }

  function setCopyButtonState(enabled) {
    if (!copyManifestButton) return;
    copyManifestButton.disabled = !enabled;
    if (!enabled) {
      if (copyStatusTimer) {
        clearTimeout(copyStatusTimer);
        copyStatusTimer = null;
      }
      copyManifestStatus.textContent = '';
    }
  }

  async function copyManifestUrl() {
    if (!manifestLink || !manifestLink.href || copyManifestButton.disabled) return;
    const url = manifestLink.href;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = url;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'absolute';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      showCopyFeedback('Copied!');
    } catch (error) {
      console.error('Failed to copy manifest URL', error);
      showCopyFeedback('Copy failed');
    }
  }

  function showCopyFeedback(message) {
    if (!copyManifestStatus) return;
    copyManifestStatus.textContent = message;
    if (copyStatusTimer) clearTimeout(copyStatusTimer);
    copyStatusTimer = setTimeout(() => {
      copyManifestStatus.textContent = '';
      copyStatusTimer = null;
    }, 2500);
  }

  const healthToggle = configForm.querySelector('input[name="NZB_TRIAGE_ENABLED"]');
  const healthRequiredFields = Array.from(configForm.querySelectorAll('[data-health-required]'));
  const triageCandidateSelect = configForm.querySelector('select[name="NZB_TRIAGE_MAX_CANDIDATES"]');
  const triageConnectionsInput = configForm.querySelector('input[name="NZB_TRIAGE_MAX_CONNECTIONS"]');

  function updateHealthFieldRequirements() {
    const enabled = Boolean(healthToggle?.checked);
    healthRequiredFields.forEach((field) => {
      if (!field) return;
      if (enabled) field.setAttribute('required', 'required');
      else field.removeAttribute('required');
    });
  }

  function getConnectionLimit() {
    const candidateCount = Number(triageCandidateSelect?.value) || 0;
    return candidateCount > 0 ? candidateCount * 2 : null;
  }

  function enforceConnectionLimit() {
    if (!triageConnectionsInput) return;
    const maxAllowed = getConnectionLimit();
    if (maxAllowed && Number.isFinite(maxAllowed)) {
      triageConnectionsInput.max = String(maxAllowed);
      const current = Number(triageConnectionsInput.value);
      if (Number.isFinite(current) && current > maxAllowed) {
        triageConnectionsInput.value = String(maxAllowed);
      }
    } else {
      triageConnectionsInput.removeAttribute('max');
    }
  }

  function syncHealthControls() {
    updateHealthFieldRequirements();
    enforceConnectionLimit();
  }

  function syncSortingControls() {
    if (!sortingModeSelect || !preferredLanguageSelect) return;
    const requiresLanguage = sortingModeSelect.value === 'language_quality_size';
    if (requiresLanguage) {
      preferredLanguageSelect.setAttribute('required', 'required');
    } else {
      preferredLanguageSelect.removeAttribute('required');
    }
  }

  async function saveConfiguration(event) {
    event.preventDefault();
    saveStatus.textContent = '';

    try {
      markSaving(true);
      const values = collectFormValues();
      const result = await apiRequest('/admin/api/config', {
        method: 'POST',
        body: JSON.stringify({ values }),
      });
      const manifestUrl = result?.manifestUrl || manifestLink?.href || '';
      if (manifestUrl) updateManifestLink(manifestUrl);
      const statusUrl = manifestUrl || manifestLink?.textContent || '';
      if (statusUrl) {
        saveStatus.textContent = `Manifest URL: ${statusUrl} — addon will restart in a few seconds...`;
      } else {
        saveStatus.textContent = 'Configuration saved. The addon will restart in a few seconds...';
      }
    } catch (error) {
      saveStatus.textContent = `Error: ${error.message}`;
    } finally {
      markSaving(false);
    }
  }

  loadButton.addEventListener('click', () => {
    const token = getToken();
    if (!token) {
      authError.textContent = 'Addon token is required to load settings.';
      authError.classList.remove('hidden');
      return;
    }
    setStoredToken(token);
    loadConfiguration();
  });

  configForm.addEventListener('submit', saveConfiguration);

  const testButtons = configForm.querySelectorAll('button[data-test]');
  const sortingModeSelect = configForm.querySelector('select[name="NZB_SORT_MODE"]');
  const preferredLanguageSelect = configForm.querySelector('select[name="NZB_PREFERRED_LANGUAGE"]');
  testButtons.forEach((button) => {
    button.addEventListener('click', () => runConnectionTest(button));
  });

  if (copyManifestButton) {
    copyManifestButton.addEventListener('click', copyManifestUrl);
  }

  if (healthToggle) {
    healthToggle.addEventListener('change', syncHealthControls);
  }
  if (triageCandidateSelect) {
    triageCandidateSelect.addEventListener('change', () => {
      enforceConnectionLimit();
    });
  }
  if (triageConnectionsInput) {
    triageConnectionsInput.addEventListener('input', enforceConnectionLimit);
  }
  if (sortingModeSelect) {
    sortingModeSelect.addEventListener('change', syncSortingControls);
  }

  const pathToken = extractTokenFromPath();
  if (pathToken) {
    setToken(pathToken);
    loadConfiguration();
  } else {
    const initialToken = getStoredToken();
    if (initialToken) {
      setToken(initialToken);
      loadConfiguration();
    }
  }
  syncHealthControls();
  syncSortingControls();
})();
