(function () {
  const storageKey = 'usenetstreamer.adminToken';
  const tokenInput = document.getElementById('tokenInput');
  const loadButton = document.getElementById('loadConfig');
  const authError = document.getElementById('authError');
  const configSection = document.getElementById('configSection');
  const configForm = document.getElementById('configForm');
  const manifestDescription = document.getElementById('manifestDescription');
  const saveStatus = document.getElementById('saveStatus');
  const copyManifestButton = document.getElementById('copyManifest');
  const copyManifestStatus = document.getElementById('copyManifestStatus');
  const stremioWebButton = document.getElementById('installStremioWeb');
  const stremioAppButton = document.getElementById('installStremioApp');
  const healthPaidWarning = document.getElementById('healthPaidWarning');
  const saveButton = configForm.querySelector('button[type="submit"]');
  const sourceGuardNotice = document.getElementById('sourceGuardNotice');
  const qualityHiddenInput = configForm.querySelector('input[name="NZB_ALLOWED_RESOLUTIONS"]');
  const qualityCheckboxes = Array.from(configForm.querySelectorAll('[data-quality-option]'));
  const languageHiddenInput = configForm.querySelector('[data-language-hidden]');
  const languageCheckboxes = Array.from(configForm.querySelectorAll('input[data-language-option]'));
  const languageSelector = configForm.querySelector('[data-language-selector]');
  const tmdbLanguageHiddenInput = configForm.querySelector('[data-tmdb-language-hidden]');
  const tmdbLanguageCheckboxes = Array.from(configForm.querySelectorAll('input[data-tmdb-language-option]'));
  const tmdbLanguageSelector = configForm.querySelector('[data-tmdb-language-selector]');
  const tmdbEnabledToggle = configForm.querySelector('input[name="TMDB_ENABLED"]');
  const tmdbApiInput = configForm.querySelector('input[name="TMDB_API_KEY"]');
  const tmdbTestButton = configForm.querySelector('button[data-test="tmdb"]');
  const tvdbEnabledToggle = configForm.querySelector('input[name="TVDB_ENABLED"]');
  const tvdbApiInput = configForm.querySelector('input[name="TVDB_API_KEY"]');
  const tvdbTestButton = configForm.querySelector('button[data-test="tvdb"]');
  const versionBadge = document.getElementById('addonVersionBadge');
  const streamingModeSelect = document.getElementById('streamingModeSelect');
  const nativeModeNotice = document.getElementById('nativeModeNotice');
  const indexerManagerGroup = document.getElementById('indexerManagerGroup');
  const nzbdavGroup = document.getElementById('nzbdavGroup');
  const easynewsHttpsWarning = document.getElementById('easynewsHttpsWarning');

  let currentManifestUrl = '';
  let copyStatusTimer = null;

  let runtimeEnvPath = null;
  let allowNewznabTestSearch = false;
  let newznabPresets = [];

  const MAX_NEWZNAB_INDEXERS = 20;
  const NEWZNAB_SUFFIXES = ['ENDPOINT', 'API_KEY', 'API_PATH', 'NAME', 'INDEXER_ENABLED', 'PAID', 'PAID_LIMIT', 'ZYCLOPS'];

  const managerSelect = configForm.querySelector('select[name="INDEXER_MANAGER"]');
  const newznabList = document.getElementById('newznab-indexers-list');
  const newznabPresetSelect = document.getElementById('newznabPreset');
  const addPresetButton = document.getElementById('addPresetIndexer');
  const addNewznabButton = document.getElementById('addNewznabIndexer');
  const newznabTestSearchBlock = document.getElementById('newznab-test-search');
  const newznabTestButton = configForm.querySelector('button[data-test="newznab"]');
  const easynewsToggle = configForm.querySelector('input[name="EASYNEWS_ENABLED"]');
  const easynewsUserInput = configForm.querySelector('input[name="EASYNEWS_USERNAME"]');
  const easynewsPassInput = configForm.querySelector('input[name="EASYNEWS_PASSWORD"]');
  let saveInProgress = false;

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
    saveInProgress = isSaving;
    if (!saveButton) return;
    saveButton.textContent = isSaving ? 'Saving...' : 'Save Changes';
    if (isSaving) {
      saveButton.disabled = true;
    } else {
      syncSaveGuard();
    }
  }

  function parseBool(value) {
    if (typeof value === 'boolean') return value;
    if (value === null || value === undefined) return false;
    const normalized = String(value).trim().toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(normalized);
  }

  function normalizeEndpointForMatch(value) {
    if (!value) return '';
    let normalized = value.trim().toLowerCase();
    normalized = normalized.replace(/^https?:\/\//, '');
    normalized = normalized.replace(/\/+/g, '/');
    normalized = normalized.replace(/\/+$/, '');
    return normalized;
  }

  function setDisabledState(targets, disabled) {
    if (!Array.isArray(targets)) return;
    targets.forEach((target) => {
      if (!target) return;
      target.disabled = disabled;
    });
  }

  function populateForm(values) {
    const elements = configForm.querySelectorAll('input[name], select[name], textarea[name]');
    elements.forEach((element) => {
      const key = element.name;
      const rawValue = Object.prototype.hasOwnProperty.call(values, key) ? values[key] : '';
      if (element.type === 'checkbox') {
        if (key === 'TMDB_ENABLED' && rawValue === '') {
          element.checked = false;
        } else {
          element.checked = parseBool(rawValue);
        }
      } else if (element.multiple) {
        const selectedValues = rawValue ? rawValue.split(',').map(v => v.trim()).filter(v => v) : [];
        Array.from(element.options).forEach(option => {
          option.selected = selectedValues.includes(option.value);
        });
      } else if (element.type === 'number' && rawValue === '') {
        element.value = '';
      } else {
        element.value = rawValue ?? '';
      }
    });
  }

  function collectFormValues() {
    const payload = {};
    const elements = configForm.querySelectorAll('input[name], select[name], textarea[name]');
    elements.forEach((element) => {
      const key = element.name;
      if (!key) return;
      if (element.type === 'checkbox') {
        payload[key] = element.checked ? 'true' : 'false';
      } else if (element.multiple) {
        const selected = Array.from(element.selectedOptions).map(opt => opt.value);
        payload[key] = selected.join(',');
      } else {
        payload[key] = element.value != null ? element.value.toString() : '';
      }
    });
    payload.NEWZNAB_ENABLED = hasEnabledNewznabRows() ? 'true' : 'false';
    return payload;
  }

  function padNewznabIndex(idx) {
    return String(idx).padStart(2, '0');
  }

  function getNewznabRows() {
    if (!newznabList) return [];
    return Array.from(newznabList.querySelectorAll('.newznab-row'));
  }

  function hasEnabledNewznabRows() {
    return getNewznabRows().some((row) => {
      const toggle = row.querySelector('[data-field="INDEXER_ENABLED"]');
      return Boolean(toggle?.checked);
    });
  }

  function hasPaidNewznabRows() {
    return getNewznabRows().some((row) => {
      const paidToggle = row.querySelector('[data-field="PAID"]');
      return Boolean(paidToggle?.checked);
    });
  }

  function hasPaidManagerIndexers() {
    const fields = ['NZB_TRIAGE_PRIORITY_INDEXERS', 'NZB_TRIAGE_HEALTH_INDEXERS'];
    return fields.some((name) => {
      const input = configForm.querySelector(`[name="${name}"]`);
      return Boolean(input && input.value && input.value.trim().length > 0);
    });
  }

  function hasAnyPaidSource() {
    return hasPaidManagerIndexers() || hasPaidNewznabRows();
  }

  function updateHealthPaidWarning() {
    if (!healthPaidWarning) return;
    const shouldShow = Boolean(healthToggle?.checked) && !hasAnyPaidSource();
    healthPaidWarning.classList.toggle('hidden', !shouldShow);
  }

  function normalizeQualityToken(value) {
    if (value === undefined || value === null) return null;
    let token = String(value).trim().toLowerCase();
    if (!token) return null;
    if (token === '8k') return '4320p';
    if (token === '4k') return '2160p';
    if (token === 'uhd') return '2160p';
    return token;
  }

  function syncQualityHiddenInput() {
    if (!qualityHiddenInput || qualityCheckboxes.length === 0) return;
    const selected = qualityCheckboxes
      .filter((checkbox) => checkbox.checked)
      .map((checkbox) => normalizeQualityToken(checkbox.value))
      .filter(Boolean);
    qualityHiddenInput.value = selected.join(',');
  }

  function applyQualitySelectionsFromHidden() {
    if (!qualityHiddenInput || qualityCheckboxes.length === 0) return;
    const stored = (qualityHiddenInput.value || '').trim();
    if (!stored) {
      qualityCheckboxes.forEach((checkbox) => {
        checkbox.checked = true;
      });
      syncQualityHiddenInput();
      return;
    }
    const tokens = stored
      .split(',')
      .map((value) => normalizeQualityToken(value))
      .filter(Boolean);
    const allowed = new Set(tokens);
    const matchesAllowed = (checkboxValue) => {
      const value = (checkboxValue || '').toLowerCase();
      if (allowed.has(value)) return true;
      if (value === '8k' && allowed.has('4320p')) return true;
      if (value === '4k' && allowed.has('2160p')) return true;
      if (value === '4320p' && allowed.has('8k')) return true;
      if (value === '2160p' && allowed.has('4k')) return true;
      return false;
    };
    if (allowed.size === 0) {
      qualityCheckboxes.forEach((checkbox) => {
        checkbox.checked = true;
      });
    } else {
      qualityCheckboxes.forEach((checkbox) => {
        checkbox.checked = matchesAllowed(checkbox.value);
      });
    }
    syncQualityHiddenInput();
  }

  function getSelectedLanguages() {
    return languageCheckboxes
      .filter((checkbox) => checkbox.checked)
      .map((checkbox) => checkbox.value)
      .filter((value) => value && value.trim().length > 0);
  }

  function syncLanguageHiddenInput() {
    if (!languageHiddenInput) return;
    languageHiddenInput.value = getSelectedLanguages().join(',');
  }

  function applyLanguageSelectionsFromHidden() {
    if (!languageHiddenInput || languageCheckboxes.length === 0) return;
    const stored = (languageHiddenInput.value || '').trim();
    const tokens = stored
      ? stored.split(',').map((value) => value.trim()).filter((value) => value.length > 0)
      : [];
    const selectedSet = new Set(tokens);
    languageCheckboxes.forEach((checkbox) => {
      checkbox.checked = selectedSet.has(checkbox.value);
    });
    syncLanguageHiddenInput();
  }

  function hasManagerConfigured() {
    if (!managerSelect) return false;
    const value = (managerSelect.value || 'none').toLowerCase();
    return value !== 'none';
  }

  function hasEasynewsConfigured() {
    if (!easynewsToggle || !easynewsToggle.checked) return false;
    const user = easynewsUserInput?.value?.trim();
    const pass = easynewsPassInput?.value?.trim();
    return Boolean(user && pass);
  }

  function hasActiveIndexerSource() {
    return hasManagerConfigured() || hasEnabledNewznabRows() || hasEasynewsConfigured();
  }

  function syncSaveGuard() {
    const hasSource = hasActiveIndexerSource();
    if (sourceGuardNotice) {
      sourceGuardNotice.classList.toggle('hidden', hasSource);
    }
    if (saveButton && !saveInProgress) {
      saveButton.disabled = !hasSource;
    }
  }

  function updateVersionBadge(version) {
    if (!versionBadge) return;
    if (!version) {
      versionBadge.classList.add('hidden');
      versionBadge.textContent = '';
      return;
    }
    versionBadge.textContent = `Version ${version}`;
    versionBadge.classList.remove('hidden');
  }

  function assignRowFieldNames(row, ordinal) {
    const key = padNewznabIndex(ordinal);
    row.dataset.index = key;
    const labelEl = row.querySelector('[data-row-label]');
    if (labelEl) {
      labelEl.textContent = `Indexer ${ordinal}`;
    }
    row.querySelectorAll('[data-field]').forEach((input) => {
      const suffix = input.dataset.field;
      if (!suffix) return;
      input.name = `NEWZNAB_${suffix}_${key}`;
    });
  }

  function refreshNewznabFieldNames() {
    const rows = getNewznabRows();
    rows.forEach((row, idx) => assignRowFieldNames(row, idx + 1));
  }

  function hasNewznabDataForIndex(values, ordinal) {
    const key = padNewznabIndex(ordinal);
    const meaningfulFields = ['ENDPOINT', 'API_KEY', 'NAME'];
    return meaningfulFields.some((suffix) => {
      const fieldName = `NEWZNAB_${suffix}_${key}`;
      if (!Object.prototype.hasOwnProperty.call(values, fieldName)) return false;
      const raw = values[fieldName];
      return raw !== undefined && raw !== null && String(raw).trim() !== '';
    });
  }

  function getNewznabValuesForIndex(values, ordinal) {
    const key = padNewznabIndex(ordinal);
    const rowValues = {};
    NEWZNAB_SUFFIXES.forEach((suffix) => {
      const fieldName = `NEWZNAB_${suffix}_${key}`;
      if (Object.prototype.hasOwnProperty.call(values, fieldName)) {
        rowValues[suffix] = values[fieldName];
      }
    });
    return rowValues;
  }

  function setRowStatus(row, message, isError = false) {
    const statusEl = row?.querySelector('[data-row-status]');
    if (!statusEl) return;
    statusEl.textContent = message || '';
    statusEl.classList.toggle('error', Boolean(message && isError));
    statusEl.classList.toggle('success', Boolean(message && !isError));
  }

  function collectRowValues(row) {
    const payload = {};
    row.querySelectorAll('[data-field]').forEach((input) => {
      const key = input.name;
      if (!key) return;
      if (input.type === 'checkbox') {
        payload[key] = input.checked ? 'true' : 'false';
      } else {
        payload[key] = input.value || '';
      }
    });
    return payload;
  }

  function moveNewznabRow(row, direction) {
    const rows = getNewznabRows();
    const index = rows.indexOf(row);
    if (index === -1) return;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= rows.length) return;
    if (direction < 0) {
      newznabList.insertBefore(row, rows[targetIndex]);
    } else {
      const reference = rows[targetIndex].nextSibling;
      newznabList.insertBefore(row, reference);
    }
    refreshNewznabFieldNames();
    syncNewznabControls();
  }

  function removeNewznabRow(row) {
    if (!row) return;
    row.remove();
    refreshNewznabFieldNames();
    syncNewznabControls();
  }

  function applyNewznabRowValues(row, initialValues = {}) {
    Object.entries(initialValues).forEach(([suffix, value]) => {
      const input = row.querySelector(`[data-field="${suffix}"]`);
      if (!input) return;
      if (input.type === 'checkbox') {
        input.checked = parseBool(value);
      } else if (value !== undefined && value !== null) {
        input.value = value;
      }
    });
  }

  function buildNewznabRowElement() {
    const row = document.createElement('div');
    row.className = 'newznab-row';
    row.innerHTML = `
      <div class="row-header">
        <div class="row-title">
          <span class="row-handle" aria-hidden="true">⋮⋮</span>
          <span class="row-label" data-row-label>Indexer</span>
          <label class="checkbox">
            <input type="checkbox" data-field="INDEXER_ENABLED" checked />
            <span>Enabled</span>
          </label>
          <label class="checkbox">
            <input type="checkbox" data-field="PAID" />
            <span>I have a paid subscription with this indexer (use for health checks)</span>
          </label>
          <label class="inline-select">
            <span>Grab limit</span>
            <select data-field="PAID_LIMIT" class="small-select" disabled>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="4">4</option>
              <option value="5">5</option>
              <option value="6" selected>6</option>
            </select>
          </label>
          <label class="checkbox">
            <input type="checkbox" data-field="ZYCLOPS" />
            <span>Zyclops Proxy</span>
          </label>
        </div>
        <div class="row-controls">
          <button type="button" class="ghost" data-row-action="move-up">Move Up</button>
          <button type="button" class="ghost" data-row-action="move-down">Move Down</button>
          <button type="button" class="ghost danger" data-row-action="remove">Remove</button>
        </div>
      </div>
      <div class="field-grid">
        <label>Display Name
          <input type="text" data-field="NAME" placeholder="My Indexer" />
        </label>
        <label>Endpoint URL
          <input type="url" data-field="ENDPOINT" placeholder="https://example.com" />
        </label>
        <label>API Path
          <input type="text" data-field="API_PATH" placeholder="/api" />
        </label>
        <label class="wide-field">
          <div class="field-label-with-link">
            <span>API Key</span>
            <span class="api-key-link-wrapper hidden" data-role="api-key-link-wrapper">
              (<a href="#" target="_blank" rel="noopener" class="api-key-link hidden" data-role="api-key-link">Find my API key</a>)
            </span>
          </div>
          <div class="input-with-toggle">
            <input type="password" data-field="API_KEY" placeholder="Paste API key" autocomplete="off" />
            <button type="button" class="mask-toggle" data-role="api-key-toggle" aria-pressed="false">Show</button>
          </div>
        </label>
      </div>
      <div class="inline-actions row-inline">
        <button type="button" class="secondary" data-row-action="test">Test Indexer</button>
        <span class="status-message row-status" data-row-status></span>
      </div>
      <p class="warning hidden" data-zyclops-warning>Zyclops is against the TOS of all indexers. All requests will be routed through Zyclops servers, so the indexer will see their IP address, not yours. Only use it if this particular indexer has blocked your IP range (e.g. Oracle VPS IP range).</p>
    `;

    const moveUpButton = row.querySelector('[data-row-action="move-up"]');
    const moveDownButton = row.querySelector('[data-row-action="move-down"]');
    const removeButton = row.querySelector('[data-row-action="remove"]');
    const testButton = row.querySelector('[data-row-action="test"]');
    const enabledToggle = row.querySelector('[data-field="INDEXER_ENABLED"]');
    const paidToggle = row.querySelector('[data-field="PAID"]');
    const apiKeyInput = row.querySelector('[data-field="API_KEY"]');
    const apiKeyToggle = row.querySelector('[data-role="api-key-toggle"]');
    const endpointInput = row.querySelector('[data-field="ENDPOINT"]');
    const paidLimitSelect = row.querySelector('[data-field="PAID_LIMIT"]');
    const zyclopsToggle = row.querySelector('[data-field="ZYCLOPS"]');
    const zyclopsRowWarning = row.querySelector('[data-zyclops-warning]');

    if (moveUpButton) moveUpButton.addEventListener('click', () => moveNewznabRow(row, -1));
    if (moveDownButton) moveDownButton.addEventListener('click', () => moveNewznabRow(row, 1));
    if (removeButton) removeButton.addEventListener('click', () => { removeNewznabRow(row); });
    if (enabledToggle) enabledToggle.addEventListener('change', () => syncNewznabControls());
    if (zyclopsToggle) zyclopsToggle.addEventListener('change', () => {
      if (zyclopsRowWarning) zyclopsRowWarning.classList.toggle('hidden', !zyclopsToggle.checked);
    });
    if (paidToggle) {
      paidToggle.addEventListener('change', () => {
        updateHealthPaidWarning();
        if (paidLimitSelect) {
          const isPaid = paidToggle.checked;
          paidLimitSelect.disabled = !isPaid;
          if (isPaid && !paidLimitSelect.value) {
            paidLimitSelect.value = '6';
          }
        }
      });
    }
    if (testButton) testButton.addEventListener('click', () => runNewznabRowTest(row));
    if (apiKeyToggle && apiKeyInput) {
      apiKeyToggle.addEventListener('click', () => {
        const isMasked = apiKeyInput.type === 'password';
        apiKeyInput.type = isMasked ? 'text' : 'password';
        apiKeyToggle.textContent = isMasked ? 'Hide' : 'Show';
        apiKeyToggle.setAttribute('aria-pressed', String(isMasked));
      });
    }
    if (endpointInput) {
      endpointInput.addEventListener('input', () => refreshRowApiKeyLink(row));
      endpointInput.addEventListener('blur', () => refreshRowApiKeyLink(row));
    }

    if (paidLimitSelect && paidToggle && paidToggle.checked) {
      paidLimitSelect.disabled = false;
    }

    return row;
  }

  function addNewznabRow(initialValues = {}, options = {}) {
    if (!newznabList) return null;
    const existing = getNewznabRows();
    if (existing.length >= MAX_NEWZNAB_INDEXERS) {
      saveStatus.textContent = 'You can configure up to 20 direct Newznab indexers.';
      return null;
    }
    const row = buildNewznabRowElement();
    const hint = newznabList.querySelector('[data-empty-hint]');
    if (hint) {
      newznabList.insertBefore(row, hint);
    } else {
      newznabList.appendChild(row);
    }
    refreshNewznabFieldNames();
    applyNewznabRowValues(row, initialValues);
    const zyclopsCheck = row.querySelector('[data-field="ZYCLOPS"]');
    const zyclopsWarn = row.querySelector('[data-zyclops-warning]');
    if (zyclopsCheck && zyclopsWarn) zyclopsWarn.classList.toggle('hidden', !zyclopsCheck.checked);
    if (options.preset) {
      setRowApiKeyLink(row, options.preset);
    } else {
      refreshRowApiKeyLink(row);
    }
    syncNewznabControls();
    if (options.autoFocus !== false) {
      const focusTarget = row.querySelector('[data-field="NAME"]') || row.querySelector('input');
      if (focusTarget) focusTarget.focus();
    }
    return row;
  }

  function clearNewznabRows() {
    getNewznabRows().forEach((row) => row.remove());
    syncNewznabControls();
  }

  function setupNewznabRowsFromValues(values = {}) {
    if (!newznabList) return;
    clearNewznabRows();
    let created = false;
    for (let i = 1; i <= MAX_NEWZNAB_INDEXERS; i += 1) {
      if (hasNewznabDataForIndex(values, i)) {
        const rowValues = getNewznabValuesForIndex(values, i);
        const preset = findPresetByEndpoint(rowValues?.ENDPOINT || '');
        addNewznabRow(rowValues, { autoFocus: false, preset });
        created = true;
      }
    }
    if (!created) {
      syncNewznabControls();
    }
  }

  async function runNewznabRowTest(row) {
    const button = row.querySelector('[data-row-action="test"]');
    if (!button) return;
    const values = collectRowValues(row);
    const endpointKey = Object.keys(values).find((key) => key.includes('_ENDPOINT_'));
    const apiKeyKey = Object.keys(values).find((key) => key.includes('_API_KEY_'));
    const endpointValue = endpointKey ? values[endpointKey] : '';
    const apiKeyValue = apiKeyKey ? values[apiKeyKey] : '';
    if (!endpointValue) {
      setRowStatus(row, 'Endpoint is required before testing.', true);
      return;
    }
    if (!apiKeyValue) {
      setRowStatus(row, 'API key is required before testing.', true);
      return;
    }
    const original = button.textContent;
    setRowStatus(row, '', false);
    button.disabled = true;
    button.textContent = 'Testing...';
    try {
      const response = await apiRequest('/admin/api/test-connections', {
        method: 'POST',
        body: JSON.stringify({ type: 'newznab', values }),
      });
      if (response?.status === 'ok') {
        setRowStatus(row, response.message || 'Connection succeeded', false);
      } else {
        setRowStatus(row, response?.message || 'Connection failed', true);
      }
    } catch (error) {
      setRowStatus(row, error.message || 'Request failed', true);
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  function sanitizePresetEntry(entry, index) {
    if (!entry || typeof entry !== 'object') return null;
    const endpoint = (entry.endpoint || '').trim();
    if (!endpoint) return null;
    const label = (entry.label || entry.name || endpoint).trim();
    const apiPath = (entry.apiPath || entry.api_path || '/api').trim() || '/api';
    const apiKeyUrl = (entry.apiKeyUrl || entry.api_key_url || '').trim();
    return {
      id: entry.id || `preset-${index + 1}`,
      label,
      endpoint,
      apiPath,
      description: entry.description || entry.note || '',
      apiKeyUrl,
      matchEndpoint: normalizeEndpointForMatch(endpoint),
    };
  }

  function setAvailableNewznabPresets(presets = []) {
    if (!Array.isArray(presets)) {
      newznabPresets = [];
    } else {
      newznabPresets = presets
        .map((entry, index) => sanitizePresetEntry(entry, index))
        .filter(Boolean);
    }
    renderNewznabPresets();
  }

  function renderNewznabPresets() {
    if (!newznabPresetSelect) return;
    newznabPresetSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Choose a preset…';
    placeholder.selected = true;
    placeholder.disabled = true;
    newznabPresetSelect.appendChild(placeholder);
    newznabPresets.forEach((preset) => {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = preset.label;
      newznabPresetSelect.appendChild(option);
    });
  }

  function findPresetByEndpoint(endpoint) {
    const normalized = normalizeEndpointForMatch(endpoint || '');
    if (!normalized) return null;
    return newznabPresets.find((preset) => normalizeEndpointForMatch(preset.matchEndpoint || preset.endpoint) === normalized) || null;
  }

  function setRowApiKeyLink(row, preset) {
    const link = row?.querySelector('[data-role="api-key-link"]');
    const wrapper = row?.querySelector('[data-role="api-key-link-wrapper"]');
    if (!link || !wrapper) return;
    if (preset?.apiKeyUrl) {
      link.href = preset.apiKeyUrl;
      link.classList.remove('hidden');
      wrapper.classList.remove('hidden');
      row.dataset.presetId = preset.id;
    } else {
      link.removeAttribute('href');
      link.classList.add('hidden');
      wrapper.classList.add('hidden');
      delete row.dataset.presetId;
    }
  }

  function refreshRowApiKeyLink(row) {
    if (!row) return;
    const endpointInput = row.querySelector('[data-field="ENDPOINT"]');
    const preset = findPresetByEndpoint(endpointInput?.value || '');
    setRowApiKeyLink(row, preset);
  }

  function handleAddPresetIndexer() {
    if (!newznabPresetSelect) return;
    const presetId = newznabPresetSelect.value;
    if (!presetId) return;
    const preset = newznabPresets.find((entry) => entry.id === presetId);
    if (!preset) return;
    const row = addNewznabRow({
      NAME: preset.label.replace(/\s*\(.+?\)\s*/g, '').trim(),
      ENDPOINT: preset.endpoint,
      API_PATH: preset.apiPath || '/api',
    }, { preset });
    if (row) {
      const apiKeyInput = row.querySelector('[data-field="API_KEY"]');
      if (apiKeyInput) {
        apiKeyInput.focus();
      }
      setRowStatus(row, preset.description || 'Preset added — paste your API key to finish.', false);
    }
    if (newznabPresetSelect) {
      newznabPresetSelect.selectedIndex = 0;
      newznabPresetSelect.value = '';
    }
  }

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
    const headers = Object.assign({}, options.headers || {});
    if (token) {
      headers['X-Addon-Token'] = token;
    }

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
      const values = data.values || {};
      setAvailableNewznabPresets(data?.newznabPresets || []);
      updateVersionBadge(data?.addonVersion);
      allowNewznabTestSearch = Boolean(data?.debugNewznabSearch);
      setupNewznabRowsFromValues(values);
      populateForm(values);
      setupPatternPreview(); // Initialize preview with loaded values
      applyLanguageSelectionsFromHidden();
      applyQualitySelectionsFromHidden();
      applyTmdbLanguageSelectionsFromHidden();
      refreshNewznabFieldNames();
      syncHealthControls();
      syncSortingControls();
      syncStreamingModeControls();
      syncManagerControls();
      syncNewznabControls();
      configSection.classList.remove('hidden');
      updateManifestLink(data.manifestUrl || '');
      runtimeEnvPath = data.runtimeEnvPath || null;
      const baseMessage = 'Use the install buttons once HTTPS and your shared token are set.';
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
    currentManifestUrl = url || '';
    const hasUrl = Boolean(currentManifestUrl);
    setCopyButtonState(hasUrl);
    setInstallButtonsState(hasUrl);
    if (copyManifestStatus) {
      copyManifestStatus.textContent = '';
    }
  }

  // ... (existing functions)


  // Initialization
  function init() {
    const storedToken = getStoredToken();
    if (storedToken) {
      tokenInput.value = storedToken;
    }

    if (loadButton) {
      loadButton.addEventListener('click', () => {
        setStoredToken(tokenInput.value);
        loadConfiguration().then(() => {
          setupPatternPreview(); // Init preview after load
        });
      });
    }

    // ... other listeners ...
    if (saveButton) saveButton.addEventListener('click', handleSave);

    // If we have token, auto-load? No, explicit action is better for security awareness (or per existing logic).
    // The existing logic doesn't auto-load.
  }

  // Hook into init
  // To avoid rewriting init completely, I will just call init() at the end wrapped in existing logic?
  // Wait, the file ends with `init(); })();`.
  // I need to find the `init` function definition and append `setupPatternPreview` call inside `loadConfiguration` success path, OR just append `setupPatternPreview` elsewhere.
  // Actually, I can just append `setupPatternPreview` logic and hook it up.

  // Let's modify `loadConfiguration` to call `setupPatternPreview`?
  // Or just call it.
  // The easiest way is to rewrite `init` at the end of the file.
  // Or better, since `loadConfiguration` populates the form, I should call it there.

  // Actually, I will replace the end of the file.

  // Let's find where `init` is defined. It is likely near the end.

  function setCopyButtonState(enabled) {
    if (!copyManifestButton) return;
    copyManifestButton.disabled = !enabled;
    if (!enabled) {
      if (copyStatusTimer) {
        clearTimeout(copyStatusTimer);
        copyStatusTimer = null;
      }
      if (copyManifestStatus) copyManifestStatus.textContent = '';
    }
  }

  function setInstallButtonsState(enabled) {
    if (stremioWebButton) {
      stremioWebButton.disabled = !enabled;
    }
    if (stremioAppButton) {
      stremioAppButton.disabled = !enabled;
    }
  }

  async function copyManifestUrl() {
    if (!currentManifestUrl || copyManifestButton.disabled) return;
    const url = currentManifestUrl;
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

  function getStremioProtocolUrl(url) {
    if (!url) return '';
    if (url.startsWith('stremio://')) return url;
    if (/^https?:\/\//i.test(url)) {
      return url.replace(/^https?:\/\//i, 'stremio://');
    }
    return `stremio://${url.replace(/^stremio:\/\//i, '')}`;
  }

  function openStremioWebInstall() {
    if (!currentManifestUrl) return;
    const encoded = encodeURIComponent(currentManifestUrl);
    const url = `https://web.stremio.com/#/addons?addon=${encoded}`;
    const newWindow = window.open(url, '_blank', 'noopener,noreferrer');
    if (!newWindow) {
      window.location.href = url;
    }
  }

  function openStremioAppInstall() {
    if (!currentManifestUrl) return;
    const deeplink = getStremioProtocolUrl(currentManifestUrl);
    const newWindow = window.open(deeplink, '_blank');
    if (!newWindow) {
      window.location.href = deeplink;
    }
  }

  const healthToggle = configForm.querySelector('input[name="NZB_TRIAGE_ENABLED"]');
  const prefetchFirstVerifiedToggle = configForm.querySelector('input[name="NZB_TRIAGE_PREFETCH_FIRST_VERIFIED"]');
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
    updateHealthPaidWarning();
  }

  function syncSortingControls() {
    if (!sortingModeSelect || !languageHiddenInput) return;
    const requiresLanguage = sortingModeSelect.value === 'language_quality_size';
    if (requiresLanguage) {
      languageHiddenInput.setAttribute('required', 'required');
    } else {
      languageHiddenInput.removeAttribute('required');
    }
    if (languageSelector) {
      languageSelector.classList.toggle('language-required', requiresLanguage);
    }
  }

  function syncManagerControls() {
    if (!managerSelect) return;
    const streamingMode = streamingModeSelect?.value || 'nzbdav';
    const managerValue = managerSelect.value || 'none';
    const managerFields = configForm.querySelectorAll('[data-manager-field]');

    // In native mode, force manager to 'none' and hide manager options
    if (streamingMode === 'native') {
      managerFields.forEach((field) => field.classList.add('hidden'));
    } else {
      managerFields.forEach((field) => field.classList.toggle('hidden', managerValue === 'none'));
    }
    syncSaveGuard();
  }

  function syncPrefetchToggle() {
    // Currently no dependencies; placeholder for future state-based enabling/disabling
    return Boolean(prefetchFirstVerifiedToggle);
  }

  function syncStreamingModeControls() {
    const mode = streamingModeSelect?.value || 'nzbdav';
    const isNativeMode = mode === 'native';

    // Show/hide native mode notice
    if (nativeModeNotice) {
      nativeModeNotice.classList.toggle('hidden', !isNativeMode);
    }

    if (easynewsHttpsWarning) {
      easynewsHttpsWarning.classList.toggle('hidden', !isNativeMode);
    }

    // Hide NZBDav section in native mode
    if (nzbdavGroup) {
      nzbdavGroup.classList.toggle('hidden', isNativeMode);
    }

    // In native mode, force manager to 'none' and disable the select
    if (indexerManagerGroup && managerSelect) {
      if (isNativeMode) {
        // Force to newznab only in native mode
        managerSelect.value = 'none';
        managerSelect.disabled = true;
        // Add a hint that manager is disabled
        const existingHint = indexerManagerGroup.querySelector('.native-mode-hint');
        if (!existingHint) {
          const hint = document.createElement('p');
          hint.className = 'hint native-mode-hint';
          hint.textContent = 'Prowlarr/NZBHydra disabled in Windows Native mode. Use direct Newznab indexers below.';
          const h3 = indexerManagerGroup.querySelector('h3');
          if (h3) h3.after(hint);
        }
      } else {
        managerSelect.disabled = false;
        const existingHint = indexerManagerGroup.querySelector('.native-mode-hint');
        if (existingHint) existingHint.remove();
      }
    }

    syncManagerControls();
  }

  function getSelectedTmdbLanguages() {
    return tmdbLanguageCheckboxes
      .filter((checkbox) => checkbox.checked)
      .map((checkbox) => checkbox.value)
      .filter((value) => value && value.trim().length > 0);
  }

  function syncTmdbLanguageHiddenInput() {
    if (!tmdbLanguageHiddenInput) return;
    tmdbLanguageHiddenInput.value = getSelectedTmdbLanguages().join(',');
  }

  function applyTmdbLanguageSelectionsFromHidden() {
    if (!tmdbLanguageHiddenInput || tmdbLanguageCheckboxes.length === 0) return;
    const stored = (tmdbLanguageHiddenInput.value || '').trim();
    const tokens = stored
      ? stored.split(',').map((value) => value.trim()).filter((value) => value.length > 0)
      : [];
    const selectedSet = new Set(tokens);
    tmdbLanguageCheckboxes.forEach((checkbox) => {
      checkbox.checked = selectedSet.has(checkbox.value);
    });
    syncTmdbLanguageHiddenInput();
  }

  function syncTmdbLanguageControls() {
    const enabled = Boolean(tmdbEnabledToggle?.checked);
    setDisabledState([tmdbApiInput], !enabled);
    setDisabledState([tmdbTestButton], false);
    tmdbLanguageCheckboxes.forEach((checkbox) => {
      checkbox.disabled = !enabled;
    });
    if (tmdbLanguageSelector) {
      tmdbLanguageSelector.classList.toggle('disabled', !enabled);
    }
  }

  function syncTvdbControls() {
    if (!tvdbEnabledToggle) return;
    const enabled = Boolean(tvdbEnabledToggle.checked);
    setDisabledState([tvdbApiInput], !enabled);
    setDisabledState([tvdbTestButton], false);
  }

  function syncNewznabControls() {
    const rows = getNewznabRows();
    const hasRows = rows.length > 0;
    const hasEnabledRows = hasEnabledNewznabRows();
    if (newznabList) {
      const hint = newznabList.querySelector('[data-empty-hint]');
      if (hint) hint.classList.toggle('hidden', hasRows);
    }
    if (newznabTestButton) {
      newznabTestButton.disabled = !hasEnabledRows;
    }
    if (newznabTestSearchBlock) {
      const allowTest = hasRows && (allowNewznabTestSearch || hasEnabledRows);
      newznabTestSearchBlock.classList.toggle('hidden', !allowTest);
    }
    syncSaveGuard();
    updateHealthPaidWarning();
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
      const manifestUrl = result?.manifestUrl || currentManifestUrl || '';
      if (manifestUrl) updateManifestLink(manifestUrl);
      const portChanged = Boolean(result?.portChanged);
      const manifestNote = manifestUrl ? `Manifest URL: ${manifestUrl}. ` : '';
      const reloadNote = portChanged
        ? 'Settings applied and the addon restarted on the new port.'
        : 'Settings applied instantly — no restart needed.';
      saveStatus.textContent = `${manifestNote}${reloadNote}`.trim();
    } catch (error) {
      saveStatus.textContent = `Error: ${error.message}`;
    } finally {
      markSaving(false);
    }
  }

  loadButton.addEventListener('click', () => {
    setStoredToken(getToken());
    loadConfiguration();
  });

  configForm.addEventListener('submit', saveConfiguration);

  const testButtons = configForm.querySelectorAll('button[data-test]');
  const sortingModeSelect = configForm.querySelector('select[name="NZB_SORT_MODE"]');
  testButtons.forEach((button) => {
    button.addEventListener('click', () => runConnectionTest(button));
  });

  if (copyManifestButton) {
    copyManifestButton.addEventListener('click', copyManifestUrl);
  }
  if (stremioWebButton) {
    stremioWebButton.addEventListener('click', openStremioWebInstall);
  }
  if (stremioAppButton) {
    stremioAppButton.addEventListener('click', openStremioAppInstall);
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
  languageCheckboxes.forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      syncLanguageHiddenInput();
      syncSortingControls();
      syncSaveGuard();
    });
  });

  const languageSearch = configForm.querySelector('input[data-search-target="nzb"]');
  const tmdbLanguageSearch = configForm.querySelector('input[data-search-target="tmdb"]');

  function setupLanguageSearch(searchInput, checkboxList) {
    if (!searchInput || !checkboxList) return;
    searchInput.addEventListener('input', () => {
      const query = (searchInput.value || '').trim().toLowerCase();
      checkboxList.forEach((input) => {
        const label = input.closest('label');
        if (!label) return;
        const text = (label.textContent || '').trim().toLowerCase();
        if (!query) {
          label.style.display = '';
        } else {
          label.style.display = text.includes(query) ? '' : 'none';
        }
      });
    });
  }

  setupLanguageSearch(languageSearch, languageCheckboxes);
  setupLanguageSearch(tmdbLanguageSearch, tmdbLanguageCheckboxes);

  const managerPaidInputs = configForm.querySelectorAll('[name="NZB_TRIAGE_PRIORITY_INDEXERS"], [name="NZB_TRIAGE_HEALTH_INDEXERS"]');
  managerPaidInputs.forEach((input) => {
    input.addEventListener('input', updateHealthPaidWarning);
  });

  if (qualityCheckboxes.length > 0) {
    qualityCheckboxes.forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        syncQualityHiddenInput();
        syncResolutionLimitDisabledStates();
        syncSaveGuard();
      });
    });
  }

  if (addNewznabButton) {
    addNewznabButton.addEventListener('click', () => {
      addNewznabRow();
    });
  }

  if (addPresetButton) {
    addPresetButton.addEventListener('click', handleAddPresetIndexer);
  }

  if (managerSelect) {
    managerSelect.addEventListener('change', () => {
      syncManagerControls();
    });
  }

  if (streamingModeSelect) {
    streamingModeSelect.addEventListener('change', () => {
      syncStreamingModeControls();
    });
  }

  tmdbLanguageCheckboxes.forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      syncTmdbLanguageHiddenInput();
    });
  });

  if (tmdbEnabledToggle) {
    tmdbEnabledToggle.addEventListener('change', () => {
      syncTmdbLanguageControls();
      syncSaveGuard();
    });
  }

  if (easynewsToggle) {
    easynewsToggle.addEventListener('change', syncSaveGuard);
  }
  if (tvdbEnabledToggle) {
    tvdbEnabledToggle.addEventListener('change', () => {
      syncTvdbControls();
      syncSaveGuard();
    });
  }
  if (tvdbApiInput) {
    tvdbApiInput.addEventListener('input', syncSaveGuard);
  }
  if (easynewsUserInput) {
    easynewsUserInput.addEventListener('input', syncSaveGuard);
  }
  if (easynewsPassInput) {
    easynewsPassInput.addEventListener('input', syncSaveGuard);
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
  function setupReleaseExclusions() {
    const textarea = configForm.querySelector('textarea[name="NZB_RELEASE_EXCLUSIONS"]');
    const exampleCategories = document.querySelectorAll('.example-category');

    if (!textarea || exampleCategories.length === 0) return;

    exampleCategories.forEach((category) => {
      const codeBlock = category.querySelector('code');
      if (!codeBlock) return;

      const rawText = codeBlock.textContent || '';
      const items = rawText.split(',').map((s) => s.trim()).filter((s) => s.length > 0);

      // clear the code block and replace with clickable spans
      codeBlock.innerHTML = '';
      codeBlock.style.display = 'block'; // ensure it behaves like a container

      items.forEach((item) => {
        const span = document.createElement('span');
        span.className = 'clickable-example';
        span.textContent = item;
        span.title = 'Click to add to exclusions';
        span.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation(); // prevent closing details if inside one

          const currentVal = textarea.value;
          const currentItems = currentVal.split(',').map((s) => s.trim()).filter((s) => s.length > 0);

          if (!currentItems.includes(item)) {
            currentItems.push(item);
            textarea.value = currentItems.join(', ');
            // Trigger a visual feedback or flash the textarea
            textarea.focus();
            textarea.style.transition = 'box-shadow 0.2s ease';
            textarea.style.boxShadow = '0 0 0 4px rgba(62, 180, 255, 0.3)';
            setTimeout(() => {
              textarea.style.boxShadow = '';
            }, 300);
          }
        });
        codeBlock.appendChild(span);
      });
    });
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {
        // ignore service worker registration errors
      });
    });
  }


  function setupPatternPreview() {
    const previewShortEl = document.getElementById('previewShortName');
    const previewDescEl = document.getElementById('previewDescription');
    const shortInput = configForm.querySelector('[name="NZB_DISPLAY_NAME_PATTERN"]');
    const descInput = configForm.querySelector('textarea[name="NZB_NAMING_PATTERN"]');

    if (!previewShortEl || !previewDescEl) return;

    // Mixed Context: Flat keys + Nested objects
    const mockData = {
      // Nested (AIOStreams)
      stream: {
        title: 'Dune Part Two',
        proxied: true,
        private: false,
        resolution: '2160p',
        upscaled: false,
        quality: '4K',
        encode: 'x265',
        type: 'movie',
        visualTags: ['HDR', 'DV'],
        audioTags: ['Atmos', 'DDP5.1'],
        audioChannels: ['5.1'],
        seeders: 0,
        size: 16535624089.6, // 15.4 GB in bytes
        folderSize: 0,
        indexer: 'NZBGeek',
        languages: ['English'],
        network: '',
        filename: 'Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR10.H.265-FLUX.mkv',
        message: 'I like turtles',
        releaseGroup: 'FLUX',
        shortName: 'NZBGeek',
        cached: true,
        instant: true,
        health: '✅'
      },
      service: {
        shortName: 'Usenet',
        cached: true
      },
      addon: {
        name: 'UsenetStreamer'
      }
    };

    const defaultShortPattern = 'addon, health, instant, quality';
    const defaultDescPattern = 'title,\nsource,\ncodec,\nvisual,\naudio,\ngroup,\nsize,\nlanguages,\nindexer';
    const legacyDescPattern = 'filename,\nsource,\ncodec,\nvisual,\naudio,\ngroup,\nsize,\nlanguages,\nindexer';

    if (shortInput && !shortInput.value.trim()) {
      shortInput.value = defaultShortPattern;
    }
    if (descInput) {
      const currentDesc = descInput.value.trim();
      if (!currentDesc || currentDesc === legacyDescPattern) {
        descInput.value = defaultDescPattern;
      }
    }

    function buildPatternFromTokenList(rawPattern, variant, fallbackPattern) {
      if (rawPattern && rawPattern.includes('{')) return rawPattern;
      const hasLineBreaks = /[\r\n]/.test(String(rawPattern || ''));
      const lineParts = [];
      if (hasLineBreaks) {
        const lines = String(rawPattern || '').split(/\r?\n/);
        lines.forEach((line) => {
          const normalizedLine = String(line || '')
            .replace(/\band\b/gi, ',')
            .replace(/[;|]/g, ',');
          const tokens = normalizedLine
            .split(',')
            .map((token) => token.trim())
            .filter(Boolean);

          const shortTokenMap = {
            addon: '{addon.name}',
            title: '{stream.title::exists["{stream.title}"||""]}',
            instant: '{stream.instant::istrue["⚡"||""]}',
            health: '{stream.health::exists["{stream.health}"||""]}',
            quality: '{stream.quality::exists["{stream.quality}"||""]}',
            resolution: '{stream.resolution::exists["{stream.resolution}"||""]}',
            source: '{stream.source::exists["{stream.source}"||""]}',
            codec: '{stream.encode::exists["{stream.encode}"||""]}',
            group: '{stream.releaseGroup::exists["{stream.releaseGroup}"||""]}',
            size: '{stream.size::>0["{stream.size::bytes}"||""]}',
            languages: '{stream.languages::join(" ")::exists["{stream.languages::join(\" \")}"||""]}',
            indexer: '{stream.indexer::exists["{stream.indexer}"||""]}',
            filename: '{stream.filename::exists["{stream.filename}"||""]}',
            tags: '{tags::exists["{tags}"||""]}',
          };

          const longTokenMap = {
            title: '{stream.title::exists["🎬 {stream.title}"||""]}',
            filename: '{stream.filename::exists["📄 {stream.filename}"||""]}',
            source: '{stream.source::exists["🎥 {stream.source}"||""]}',
            codec: '{stream.encode::exists["🎞️ {stream.encode}"||""]}',
            resolution: '{stream.resolution::exists["🖥️ {stream.resolution}"||""]}',
            visual: '{stream.visualTags::join(" | ")::exists["📺 {stream.visualTags::join(\" | \")}"||""]}',
            audio: '{stream.audioTags::join(" ")::exists["🎧 {stream.audioTags::join(\" \")}"||""]}',
            group: '{stream.releaseGroup::exists["👥 {stream.releaseGroup}"||""]}',
            size: '{stream.size::>0["📦 {stream.size::bytes}"||""]}',
            languages: '{stream.languages::join(" ")::exists["🌎 {stream.languages::join(\" \")}"||""]}',
            indexer: '{stream.indexer::exists["🔎 {stream.indexer}"||""]}',
            health: '{stream.health::exists["🧪 {stream.health}"||""]}',
            instant: '{stream.instant::istrue["⚡ Instant"||""]}',
            quality: '{stream.quality::exists["✨ {stream.quality}"||""]}',
            tags: '{tags::exists["🏷️ {tags}"||""]}',
          };

          const map = variant === 'long' ? longTokenMap : shortTokenMap;
          const parts = tokens.map((token) => map[token.toLowerCase()] || null).filter(Boolean);
          lineParts.push(parts.join(' '));
        });

        const separator = variant === 'long' ? '\n' : ' ';
        const joined = lineParts.join(separator);
        if (joined.replace(/\s/g, '') === '') return fallbackPattern;
        return joined;
      }
      const normalizedList = String(rawPattern || '')
        .replace(/\band\b/gi, ',')
        .replace(/[;|]/g, ',');
      const tokens = normalizedList
        .split(',')
        .map((token) => token.trim())
        .filter(Boolean);
      if (tokens.length === 0) return fallbackPattern;

      const shortTokenMap = {
        addon: '{addon.name}',
        title: '{stream.title::exists["{stream.title}"||""]}',
        instant: '{stream.instant::istrue["⚡"||""]}',
        health: '{stream.health::exists["{stream.health}"||""]}',
        quality: '{stream.quality::exists["{stream.quality}"||""]}',
        resolution: '{stream.resolution::exists["{stream.resolution}"||""]}',
        source: '{stream.source::exists["{stream.source}"||""]}',
        codec: '{stream.encode::exists["{stream.encode}"||""]}',
        group: '{stream.releaseGroup::exists["{stream.releaseGroup}"||""]}',
        size: '{stream.size::>0["{stream.size::bytes}"||""]}',
        languages: '{stream.languages::join(" ")::exists["{stream.languages::join(\" \")}"||""]}',
        indexer: '{stream.indexer::exists["{stream.indexer}"||""]}',
        filename: '{stream.filename::exists["{stream.filename}"||""]}',
        tags: '{tags::exists["{tags}"||""]}',
      };

      const longTokenMap = {
        title: '{stream.title::exists["🎬 {stream.title}"||""]}',
        filename: '{stream.filename::exists["📄 {stream.filename}"||""]}',
        source: '{stream.source::exists["🎥 {stream.source}"||""]}',
        codec: '{stream.encode::exists["🎞️ {stream.encode}"||""]}',
        resolution: '{stream.resolution::exists["🖥️ {stream.resolution}"||""]}',
        visual: '{stream.visualTags::join(" | ")::exists["📺 {stream.visualTags::join(\" | \")}"||""]}',
        audio: '{stream.audioTags::join(" ")::exists["🎧 {stream.audioTags::join(\" \")}"||""]}',
        group: '{stream.releaseGroup::exists["👥 {stream.releaseGroup}"||""]}',
        size: '{stream.size::>0["📦 {stream.size::bytes}"||""]}',
        languages: '{stream.languages::join(" ")::exists["🌎 {stream.languages::join(\" \")}"||""]}',
        indexer: '{stream.indexer::exists["🔎 {stream.indexer}"||""]}',
        health: '{stream.health::exists["🧪 {stream.health}"||""]}',
        instant: '{stream.instant::istrue["⚡ Instant"||""]}',
        quality: '{stream.quality::exists["✨ {stream.quality}"||""]}',
        tags: '{tags::exists["🏷️ {tags}"||""]}',
      };

      const map = variant === 'long' ? longTokenMap : shortTokenMap;
      const parts = tokens.map((token) => map[token.toLowerCase()] || null).filter(Boolean);
      if (parts.length === 0) return fallbackPattern;
      return parts.join(' ');
    }

    function runPreview(pattern, defaultPattern) {
      let effective = (pattern && typeof pattern === 'string' && pattern.trim().length > 0) ? pattern : defaultPattern;

      // Use the advanced TemplateEngine for all patterns
      const engine = new TemplateEngine(mockData);
      return engine.render(effective);
    }

    function updatePreview() {
      const shortPatternRaw = shortInput?.value || defaultShortPattern;
      const descPatternRaw = descInput?.value || defaultDescPattern;
      const shortPattern = buildPatternFromTokenList(shortPatternRaw, 'short', defaultShortPattern);
      const descPattern = buildPatternFromTokenList(descPatternRaw, 'long', defaultDescPattern);

      previewShortEl.textContent = runPreview(shortPattern, defaultShortPattern);
      previewDescEl.textContent = runPreview(descPattern, defaultDescPattern);
    }

    if (shortInput) shortInput.addEventListener('input', updatePreview);
    if (descInput) descInput.addEventListener('input', updatePreview);
    updatePreview();
  }

  // Final Init Call
  setupReleaseExclusions();
  syncHealthControls();
  syncSortingControls();
  syncStreamingModeControls();
  syncTmdbLanguageControls();
  syncTvdbControls();
  syncManagerControls();
  syncNewznabControls();
  applyQualitySelectionsFromHidden();
  applyTmdbLanguageSelectionsFromHidden();
  syncSaveGuard();
})();
