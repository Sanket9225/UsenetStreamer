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
      if (key.startsWith('NEWZNAB_ENDPOINT_') || key.startsWith('NEWZNAB_API_KEY_') || key.startsWith('NEWZNAB_API_PATH_')) {
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
        apiPath: values[`NEWZNAB_API_PATH_${String(i).padStart(2, '0')}`] || ''
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
      if (key.startsWith('NEWZNAB_ENDPOINT_') || key.startsWith('NEWZNAB_API_KEY_') || key.startsWith('NEWZNAB_API_PATH_')) {
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
      if (endpoint) {
        const idx = String(i).padStart(2, '0');
        payload[`NEWZNAB_ENDPOINT_${idx}`] = endpoint;
        payload[`NEWZNAB_API_KEY_${idx}`] = apiKey;
        payload[`NEWZNAB_API_PATH_${idx}`] = apiPath;
        i++;
      }
    });
    return payload;
  }

  function renderNewznabIndexers(indexers) {
    const container = document.getElementById('newznab-indexers-list');
    if (!container) return;
    container.innerHTML = '';
    (indexers && indexers.length ? indexers : [{}]).forEach((row, idx) => {
      const i = String(idx + 1).padStart(2, '0');
      const div = document.createElement('div');
      div.className = 'newznab-indexer-row';
      div.innerHTML = `
        <label>Endpoint
          <input name="NEWZNAB_ENDPOINT_${i}" type="text" placeholder="https://indexer.example" value="${row.endpoint || ''}" />
        </label>
        <label>API Key
          <input name="NEWZNAB_API_KEY_${i}" type="text" placeholder="apikey" value="${row.apiKey || ''}" />
        </label>
        <label>API Path
          <input name="NEWZNAB_API_PATH_${i}" type="text" placeholder="/api" value="${row.apiPath || ''}" />
        </label>
        <button type="button" class="remove-indexer" title="Remove this indexer">&times;</button>
      `;
      div.querySelector('.remove-indexer').addEventListener('click', () => {
        const newList = (indexers || [{}]).slice();
        newList.splice(idx, 1);
        renderNewznabIndexers(newList);
      });
      container.appendChild(div);
    });
  }

  // Add Newznab indexer row
  document.getElementById('addNewznabIndexer')?.addEventListener('click', () => {
    const container = document.getElementById('newznab-indexers-list');
    const rows = Array.from(container.querySelectorAll('.newznab-indexer-row'));
    const indexers = rows.map((row) => ({
      endpoint: row.querySelector('input[name^="NEWZNAB_ENDPOINT_"]')?.value || '',
      apiKey: row.querySelector('input[name^="NEWZNAB_API_KEY_"]')?.value || '',
      apiPath: row.querySelector('input[name^="NEWZNAB_API_PATH_"]')?.value || ''
    }));
    indexers.push({ endpoint: '', apiKey: '', apiPath: '' });
    renderNewznabIndexers(indexers);
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
