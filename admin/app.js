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
  let currentProfileSlug = null; // null = Default/global; a slug = editing that profile (declared early so syncSaveGuard can read it)
  const sourceGuardNotice = document.getElementById('sourceGuardNotice');
  const qualityHiddenInput = configForm.querySelector('input[name="NZB_ALLOWED_RESOLUTIONS"]');
  const qualityCheckboxes = Array.from(configForm.querySelectorAll('[data-quality-option]'));
  const languageHiddenInput = configForm.querySelector('[data-language-hidden]');
  const languageCheckboxes = Array.from(configForm.querySelectorAll('input[data-language-option]'));
  const languageSelector = configForm.querySelector('[data-language-selector]');
  const tmdbLanguageHiddenInput = configForm.querySelector('[data-tmdb-language-hidden]');
  const tmdbLanguageCheckboxes = Array.from(configForm.querySelectorAll('input[data-tmdb-language-option]'));
  const tmdbLanguageSelector = configForm.querySelector('[data-tmdb-language-selector]');
  // Sort builder registry — one entry per scope (global, movies, series, anime).
  // Each builder owns its hidden input, its option checkboxes, and its activeOrder
  // state. Global is the legacy NZB_SORT_ORDER list; per-type lists fall back to
  // global at engine time when empty.
  const sortBuilders = {};
  Array.from(configForm.querySelectorAll('[data-sort-order-builder]')).forEach((container) => {
    const scope = container.dataset.sortOrderBuilder || 'global';
    sortBuilders[scope] = {
      scope,
      container,
      hiddenInput: container.querySelector('[data-sort-order-hidden]'),
      summaryEl: container.querySelector('[data-sort-order-current]'),
      options: Array.from(container.querySelectorAll('input[data-sort-order-option]')),
      activeOrder: [],
    };
  });
  const globalBuilder = sortBuilders.global || null;
  // Legacy aliases referenced by other UI controls (sorting hint, import preview).
  const sortOrderHiddenInput = globalBuilder ? globalBuilder.hiddenInput : null;
  const sortOrderOptions = globalBuilder ? globalBuilder.options : [];
  const sortOrderCurrentHint = globalBuilder ? globalBuilder.summaryEl : null;
  const tmdbEnabledToggle = configForm.querySelector('input[name="TMDB_ENABLED"]');
  const tmdbApiInput = configForm.querySelector('input[name="TMDB_API_KEY"]');
  const tmdbTestButton = configForm.querySelector('button[data-test="tmdb"]');
  const tvdbEnabledToggle = configForm.querySelector('input[name="TVDB_ENABLED"]');
  const tvdbApiInput = configForm.querySelector('input[name="TVDB_API_KEY"]');
  const tvdbTestButton = configForm.querySelector('button[data-test="tvdb"]');
  const versionBadge = document.getElementById('addonVersionBadge');
  const streamingModeSelect = document.getElementById('streamingModeSelect');
  const nativeModeNotice = document.getElementById('nativeModeNotice');
  const nativeHttpNotice = document.getElementById('nativeHttpNotice');
  const nativeHttpsNotice = document.getElementById('nativeHttpsNotice');
  const addonBaseUrlInput = document.querySelector('[name="ADDON_BASE_URL"]');
  const indexerManagerGroup = document.getElementById('indexerManagerGroup');
  const nzbdavGroup = document.getElementById('nzbdavGroup');
  const easynewsHttpsWarning = document.getElementById('easynewsHttpsWarning');

  let currentManifestUrl = '';
  let copyStatusTimer = null;

  let runtimeEnvPath = null;
  let allowNewznabTestSearch = false;
  let newznabPresets = [];
  let activeSortOrder = [];
  let loadedSortMode = 'quality_then_size';

  const MAX_NEWZNAB_INDEXERS = 20;
  const NEWZNAB_SUFFIXES = ['ENDPOINT', 'API_KEY', 'API_PATH', 'NAME', 'INDEXER_ENABLED', 'PAID', 'PAID_LIMIT', 'ZYCLOPS', 'SEARCH_UA', 'DOWNLOAD_UA', 'PROXY'];

  // Canonical option vocabularies for preferred/excluded chip helpers.
  // Aligned with the import schema so imported configs map 1:1. Release groups
  // and keywords are inherently open-ended; the chips are common-examples
  // helpers, not an exhaustive list.
  const OPTION_VOCAB = {
    qualities: ['BluRay REMUX', 'BluRay', 'WEB-DL', 'WEBRip', 'HDRip', 'HC HD-Rip', 'DVDRip', 'HDTV', 'SCR', 'TC', 'TS', 'CAM', 'Unknown'],
    encodes: ['AV1', 'HEVC', 'AVC', 'XviD', 'DivX', 'Unknown'],
    visualTags: ['HDR+DV', 'DV Only', 'HDR Only', 'HDR10+', 'HDR10', 'DV', 'HDR', 'HLG', '10bit', '3D', 'IMAX', 'AI', 'SDR', 'H-OU', 'H-SBS', 'Unknown'],
    audioTags: ['Atmos', 'DD+', 'DD', 'DTS:X', 'DTS-HD MA', 'DTS-HD', 'DTS-ES', 'DTS', 'TrueHD', 'OPUS', 'FLAC', 'AAC', 'Unknown'],
    audioChannels: ['2.0', '5.1', '6.1', '7.1', 'Unknown'],
    // Meta-language tokens (Original / Multi / Dual Audio / Dubbed / Unknown)
    // first so power users see them at the top of the chip grid. Real
    // languages follow in rough usage-frequency order.
    languages: [
      'Original', 'Multi', 'Dual Audio', 'Dubbed', 'Unknown',
      'English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese',
      'Hindi', 'Tamil', 'Telugu', 'Malayalam', 'Kannada', 'Bengali', 'Punjabi', 'Marathi', 'Gujarati', 'Urdu',
      'Chinese', 'Japanese', 'Korean',
      'Russian', 'Ukrainian', 'Polish', 'Czech', 'Slovak',
      'Arabic', 'Persian', 'Turkish', 'Hebrew',
      'Dutch', 'Swedish', 'Norwegian', 'Danish', 'Finnish',
      'Indonesian', 'Vietnamese', 'Thai', 'Tagalog', 'Malay',
      'Greek', 'Romanian', 'Hungarian',
    ],
    releaseGroups: ['FraMeSToR', 'FLUX', 'NTb', 'CtrlHD', 'EVO', 'RARBG', 'YIFY', 'NTG', 'Tigole', 'ETHEL', 'GalaxyRG', 'MeGusta', 'TBM', 'PSA', 'QxR'],
    keywords: ['criterion', 'extended', 'proper', 'repack', 'remastered', 'directors-cut', 'unrated', 'theatrical', 'imax', 'open-matte'],
  };
  const SUPPORTED_SORT_KEYS = ['language', 'release_group', 'size', 'resolution', 'quality', 'encode', 'visual_tag', 'audio_tag', 'audio_channel', 'keyword', 'date', 'files'];
  const SORT_LABELS = {
    language: 'Language',
    release_group: 'Release Group',
    size: 'Size',
    resolution: 'Resolution',
    quality: 'Quality',
    encode: 'Encode',
    visual_tag: 'Visual Tag',
    audio_tag: 'Audio Tag',
    audio_channel: 'Audio Channel',
    keyword: 'Keyword',
    date: 'Date',
    files: 'File Count',
  };
  // Per-key default direction. Users can override via the toggle button.
  const SORT_DEFAULT_DIRECTIONS = {
    files: 'asc',  // legacy: fewer first
    // everything else defaults to 'desc'
  };
  const getDefaultDirection = (key) => SORT_DEFAULT_DIRECTIONS[key] || 'desc';

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
    saveButton.textContent = isSaving ? 'Saving...'
      : (currentProfileSlug === '__new__' ? 'Create profile'
        : currentProfileSlug ? 'Save profile' : 'Save Changes');
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

  // The server masks saved credentials (API keys, and proxies that embed
  // user:pass@) by sending this zero-width-space-wrapped sentinel. Password
  // inputs render it as dots automatically; text/url inputs (proxy fields) would
  // otherwise show the raw sentinel string, so we mask those as a password too.
  // The sentinel stays as the field's value, so an untouched save round-trips it
  // back to the real value (the server swaps the sentinel for the stored value).
  const MASK_SENTINEL = String.fromCharCode(0x200b) + "__MASKED_CREDENTIAL__" + String.fromCharCode(0x200b);

  function applyMaskedDisplay(element, value) {
    if (!element) return;
    const isMasked = value === MASK_SENTINEL;
    if (isMasked && (element.type === 'text' || element.type === 'url')) {
      if (!element.dataset.maskedOrigType) element.dataset.maskedOrigType = element.type;
      element.type = 'password';
    } else if (element.dataset.maskedOrigType && !isMasked) {
      // Repopulated with a real (non-masked) value — restore the visible type.
      element.type = element.dataset.maskedOrigType;
      delete element.dataset.maskedOrigType;
    }
  }

  function populateForm(values) {
    const elements = configForm.querySelectorAll('input[name], select[name], textarea[name]');
    elements.forEach((element) => {
      const key = element.name;
      const rawValue = Object.prototype.hasOwnProperty.call(values, key) ? values[key] : '';
      if (element.type === 'checkbox') {
        if (key === 'TMDB_ENABLED' && rawValue === '') {
          element.checked = false;
        } else if ((key === 'DAILY_SHOWS_ENABLED' || key === 'DAILY_SHOWS_AUTO_DETECT') && rawValue === '') {
          element.checked = true;
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
        applyMaskedDisplay(element, rawValue);
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
    const shouldShow = Boolean(streamProtectionSelect && ['health-check', 'health-check-auto-advance', 'smart-play-only', 'smart-play'].includes(streamProtectionSelect.value)) && !hasAnyPaidSource();
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

  // Preferred languages are an ORDERED list — the engine ranks streams by
  // first-match index. Checkbox grids serialize in DOM order, which loses
  // the user's intended priority. So we track the click order ourselves:
  // first tick → priority 1, second tick → priority 2, etc.
  // A numbered badge on each ticked label makes the order visible.
  let languagePriorityOrder = [];

  function refreshLanguagePriorityBadges() {
    languageCheckboxes.forEach((checkbox) => {
      const label = checkbox.closest('label');
      if (!label) return;
      let badge = label.querySelector('[data-language-priority-badge]');
      const index = languagePriorityOrder.indexOf(checkbox.value);
      if (index === -1) {
        if (badge) badge.textContent = '';
        return;
      }
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'sort-order-index';
        badge.setAttribute('data-language-priority-badge', '');
        label.appendChild(badge);
      }
      badge.textContent = String(index + 1);
    });
  }

  function getSelectedLanguages() {
    return languagePriorityOrder.slice();
  }

  function syncLanguageHiddenInput() {
    if (!languageHiddenInput) return;
    languageHiddenInput.value = languagePriorityOrder.join(',');
    refreshLanguagePriorityBadges();
    syncConfigWarnings();
  }

  function applyLanguageSelectionsFromHidden() {
    if (!languageHiddenInput || languageCheckboxes.length === 0) return;
    const stored = (languageHiddenInput.value || '').trim();
    const tokens = stored
      ? stored.split(',').map((value) => value.trim()).filter((value) => value.length > 0)
      : [];
    // Validate against actual checkbox values so legacy/imported lists with
    // unknown tokens don't break the picker.
    const knownValues = new Set(languageCheckboxes.map((cb) => cb.value));
    languagePriorityOrder = tokens.filter((token) => knownValues.has(token));
    const selectedSet = new Set(languagePriorityOrder);
    languageCheckboxes.forEach((checkbox) => {
      checkbox.checked = selectedSet.has(checkbox.value);
    });
    syncLanguageHiddenInput();
  }

  // Sort order is now an ordered array of { key, direction } pairs.
  // Wire format: "key:direction,key:direction,..." with bare key falling back
  // to the per-key default direction (backward-compat with old NZB_SORT_ORDER).
  function parseSortOrder(raw) {
    const seen = new Set();
    const out = [];
    (raw || '').split(',').forEach((token) => {
      const trimmed = token.trim().toLowerCase();
      if (!trimmed) return;
      const [keyRaw, dirRaw] = trimmed.split(':');
      const key = (keyRaw || '').trim();
      if (!SUPPORTED_SORT_KEYS.includes(key) || seen.has(key)) return;
      seen.add(key);
      const direction = dirRaw === 'asc' || dirRaw === 'desc' ? dirRaw : getDefaultDirection(key);
      out.push({ key, direction });
    });
    return out;
  }

  function getDefaultSortOrder() {
    if (loadedSortMode === 'language_quality_size') {
      return [
        { key: 'language', direction: 'desc' },
        { key: 'resolution', direction: 'desc' },
        { key: 'size', direction: 'desc' },
      ];
    }
    return [
      { key: 'resolution', direction: 'desc' },
      { key: 'size', direction: 'desc' },
      { key: 'files', direction: 'asc' },
    ];
  }

  function serializeSortOrder(order) {
    return order.map((entry) => {
      const dir = entry.direction || getDefaultDirection(entry.key);
      return dir === getDefaultDirection(entry.key) ? entry.key : `${entry.key}:${dir}`;
    }).join(',');
  }

  function findOrderIndex(order, key) {
    for (let i = 0; i < order.length; i += 1) {
      if (order[i].key === key) return i;
    }
    return -1;
  }

  function syncBuilderUI(builder) {
    if (!builder) return;
    if (builder.hiddenInput) {
      builder.hiddenInput.value = serializeSortOrder(builder.activeOrder);
    }
    // Only the global builder shows the legacy default order when empty —
    // per-type lists render empty (the engine falls back to global at runtime).
    const fallbackOrder = builder.scope === 'global' ? getDefaultSortOrder() : [];
    const displayOrder = builder.activeOrder.length > 0 ? builder.activeOrder : fallbackOrder;
    builder.options.forEach((option) => {
      const key = (option.value || '').trim().toLowerCase();
      const index = findOrderIndex(displayOrder, key);
      option.checked = index !== -1 && builder.activeOrder.length > 0;
      const label = option.closest('label');
      if (!label) return;
      const badge = label.querySelector('[data-sort-order-index]');
      if (badge) {
        badge.textContent = index === -1 || builder.activeOrder.length === 0 ? '' : String(index + 1);
      }
      // Render the direction toggle inline; create if missing.
      let dirBtn = label.querySelector('[data-sort-direction-toggle]');
      if (!dirBtn) {
        dirBtn = document.createElement('button');
        dirBtn.type = 'button';
        dirBtn.className = 'sort-direction-toggle';
        dirBtn.setAttribute('data-sort-direction-toggle', '');
        dirBtn.title = 'Toggle sort direction';
        label.appendChild(dirBtn);
        dirBtn.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          const idx = findOrderIndex(builder.activeOrder, key);
          if (idx === -1) return; // only meaningful when active
          const current = builder.activeOrder[idx].direction;
          builder.activeOrder[idx].direction = current === 'asc' ? 'desc' : 'asc';
          syncBuilderUI(builder);
          syncSaveGuard();
        });
      }
      const isActive = builder.activeOrder.length > 0 && index !== -1;
      if (!isActive) {
        dirBtn.classList.add('hidden');
      } else {
        dirBtn.classList.remove('hidden');
        const dir = displayOrder[index].direction || getDefaultDirection(key);
        dirBtn.textContent = dir === 'asc' ? '↑' : '↓';
        dirBtn.dataset.direction = dir;
      }
    });
  }

  // Backward-compat wrapper used by other code that operates on the "main" sort.
  function syncSortOrderUI() {
    syncBuilderUI(globalBuilder);
  }

  function setBuilderOrder(builder, order) {
    if (!builder) return;
    const asString = Array.isArray(order)
      ? order.map((entry) => typeof entry === 'string' ? entry : `${entry.key}:${entry.direction || ''}`).join(',')
      : String(order || '');
    builder.activeOrder = parseSortOrder(asString);
    if (builder.scope === 'global') {
      activeSortOrder = builder.activeOrder;
    }
    syncBuilderUI(builder);
    if (builder.scope === 'global') {
      // Global change re-runs the full sorting controls sync (also re-paints
      // per-type summaries via syncSortingControls' loop + the language warning).
      syncSortingControls();
    } else {
      // Per-type change only needs to refresh its own summary.
      updateBuilderSummary(builder);
    }
  }

  function setSortOrder(order) {
    setBuilderOrder(globalBuilder, order);
  }

  function applySortOrderFromHidden() {
    Object.values(sortBuilders).forEach((builder) => {
      if (!builder.hiddenInput) return;
      setBuilderOrder(builder, builder.hiddenInput.value || '');
    });
  }

  // === Suggestion panel helpers ===================================
  // Each <div data-suggestions data-suggestions-categories="[{...}]"> becomes
  // a grouped chip picker. The JSON config lists categories: each has a
  // {vocab, heading, input} triple — vocab picks the list from OPTION_VOCAB,
  // input names the form input the chips drive. Clicking a chip toggles the
  // value in that input's comma-separated list. Highlights mirror current
  // input state, case-insensitive.
  function parseCommaInput(value) {
    return (value || '').split(',').map((token) => token.trim()).filter(Boolean);
  }

  function toggleValueInCommaInput(input, value) {
    const tokens = parseCommaInput(input.value);
    const lowerValue = value.toLowerCase();
    const existingIndex = tokens.findIndex((token) => token.toLowerCase() === lowerValue);
    if (existingIndex !== -1) {
      tokens.splice(existingIndex, 1);
    } else {
      tokens.push(value);
    }
    input.value = tokens.join(',');
    // Dispatch input + change so any field watchers (save-guard, warnings) re-run.
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function refreshCategoryChipStates(input, categoryEl) {
    const tokensLower = parseCommaInput(input.value).map((token) => token.toLowerCase());
    categoryEl.querySelectorAll('.option-chip').forEach((chip) => {
      const value = (chip.dataset.value || '').toLowerCase();
      chip.classList.toggle('active', tokensLower.includes(value));
    });
  }

  function setupSuggestionPanels() {
    configForm.querySelectorAll('[data-suggestions]').forEach((panel) => {
      // Idempotent: don't rebuild on re-runs.
      if (panel.dataset.suggestionsBuilt === '1') return;
      let categories;
      try {
        categories = JSON.parse(panel.dataset.suggestionsCategories || '[]');
      } catch (error) {
        console.warn('[suggestions] failed to parse categories config', error);
        return;
      }
      categories.forEach((cat) => {
        const vocab = OPTION_VOCAB[cat.vocab];
        const input = configForm.querySelector(`input[name="${cat.input}"]`);
        if (!Array.isArray(vocab) || vocab.length === 0 || !input) return;

        const categoryEl = document.createElement('div');
        categoryEl.className = 'option-category';
        categoryEl.dataset.vocab = cat.vocab;
        categoryEl.dataset.inputName = cat.input;
        const heading = document.createElement('h4');
        heading.textContent = cat.heading;
        const chipRow = document.createElement('div');
        chipRow.className = 'option-chip-row';
        vocab.forEach((value) => {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'option-chip';
          chip.dataset.value = value;
          chip.textContent = value;
          chip.addEventListener('click', (event) => {
            event.preventDefault();
            toggleValueInCommaInput(input, value);
            refreshCategoryChipStates(input, categoryEl);
          });
          chipRow.appendChild(chip);
        });
        categoryEl.appendChild(heading);
        categoryEl.appendChild(chipRow);
        panel.appendChild(categoryEl);

        refreshCategoryChipStates(input, categoryEl);
        // Re-highlight chips when the input changes (typing or import path).
        input.addEventListener('input', () => refreshCategoryChipStates(input, categoryEl));
      });
      panel.dataset.suggestionsBuilt = '1';
    });
  }

  // After populateForm() writes input.value directly (no `input` event),
  // re-paint all chips against the freshly loaded values.
  function refreshAllChipPickers() {
    configForm.querySelectorAll('[data-suggestions]').forEach((panel) => {
      panel.querySelectorAll('.option-category').forEach((categoryEl) => {
        // Find the input this category is bound to — we stashed nothing on the
        // category itself, so we look up the original config to grab the name.
        // Simpler: walk back to the JSON config and re-match by vocab+order.
        // Easier: just re-paint based on the data-vocab and the closest input
        // with the matching name. Since we know the name at build time, store
        // it on the element for refresh.
        const inputName = categoryEl.dataset.inputName;
        if (!inputName) return;
        const input = configForm.querySelector(`input[name="${inputName}"]`);
        if (!input) return;
        refreshCategoryChipStates(input, categoryEl);
      });
    });
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
    // Profiles inherit the global indexer source, so the "no source" guard never
    // applies while editing a profile — keep the save button enabled.
    if (currentProfileSlug !== null) {
      if (sourceGuardNotice) sourceGuardNotice.classList.add('hidden');
      if (saveButton && !saveInProgress) saveButton.disabled = false;
      return;
    }
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
        applyMaskedDisplay(input, value);
      }
    });
  }

  function buildNewznabRowElement() {
    const row = document.createElement('div');
    row.className = 'newznab-row';
    row.innerHTML = `
      <div class="row-header">
        <div class="row-title">
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
            <select data-field="PAID_LIMIT" class="small-select">
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="4">4</option>
              <option value="5">5</option>
              <option value="6" selected>6</option>
            </select>
          </label>
        </div>
        <button type="button" class="row-remove" data-row-action="remove" title="Remove indexer" aria-label="Remove indexer">&#128465;</button>
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
            <input type="password" data-field="API_KEY" placeholder="Paste API key" autocomplete="new-password" />
          </div>
        </label>
      </div>
      <div class="inline-actions row-inline">
        <button type="button" class="secondary" data-row-action="test">Test Indexer</button>
        <span class="status-message row-status" data-row-status></span>
      </div>
      <details class="advanced-settings">
        <summary>Advanced settings</summary>
        <div class="field-grid">
          <label>Search User-Agent
            <input type="text" data-field="SEARCH_UA" placeholder="Prowlarr/2.4.0.5397 (ubuntu 22.04)" />
            <span class="field-hint">User-Agent sent on Newznab API search calls. Leave blank to use the default.</span>
          </label>
          <label>Download User-Agent
            <input type="text" data-field="DOWNLOAD_UA" placeholder="SABnzbd/5.0.3" />
            <span class="field-hint">User-Agent sent when downloading the NZB file (used by health checks and NZBDav uploads). Leave blank to use the default.</span>
          </label>
          <label>Indexer Proxy (Optional)
            <input type="text" data-field="PROXY" placeholder="socks5://gluetun:8388 or http://gluetun:8888" autocomplete="new-password" />
            <span class="field-hint">Optional — usually not needed. Only set this if this indexer has blocked your server's IP (common on cloud/VPS hosts). Routes this indexer's search, caps, test and NZB downloads through the proxy. Leave blank for a direct connection. Local/LAN targets are bypassed; use socks5h:// to resolve DNS at the proxy. Need one? Webshare (webshare.io) offers free proxies.</span>
          </label>
          <label class="checkbox">
            <input type="checkbox" data-field="ZYCLOPS" />
            <span>Enable Zyclops Health Check Proxy</span>
          </label>
        </div>
        <p class="warning hidden" data-zyclops-warning>⚠️ Zyclops proxies your indexer URL/API key and returns only known-healthy results for your providers. It also downloads and ingests the newest untested NZB to enrich the health database. (Learn more <A HREF="https://zyclops.elfhosted.com/">here</A>) Many indexers prohibit this, so proceed at your own risk. The health database is directly searchable via Newznab on private ElfHosted instances only.</p>
      </details>
    `;

    const removeButton = row.querySelector('[data-row-action="remove"]');
    const testButton = row.querySelector('[data-row-action="test"]');
    const enabledToggle = row.querySelector('[data-field="INDEXER_ENABLED"]');
    const paidToggle = row.querySelector('[data-field="PAID"]');
    const apiKeyInput = row.querySelector('[data-field="API_KEY"]');
    const endpointInput = row.querySelector('[data-field="ENDPOINT"]');
    const paidLimitSelect = row.querySelector('[data-field="PAID_LIMIT"]');
    const zyclopsToggle = row.querySelector('[data-field="ZYCLOPS"]');
    const zyclopsRowWarning = row.querySelector('[data-zyclops-warning]');

    if (removeButton) removeButton.addEventListener('click', () => { removeNewznabRow(row); });
    if (enabledToggle) enabledToggle.addEventListener('change', () => syncNewznabControls());
    if (zyclopsToggle) zyclopsToggle.addEventListener('change', () => {
      if (zyclopsRowWarning) zyclopsRowWarning.classList.toggle('hidden', !zyclopsToggle.checked);
    });
    if (paidToggle) {
      paidToggle.addEventListener('change', () => {
        updateHealthPaidWarning();
      });
    }
    if (testButton) testButton.addEventListener('click', () => runNewznabRowTest(row));
    if (endpointInput) {
      endpointInput.addEventListener('input', () => refreshRowApiKeyLink(row));
      endpointInput.addEventListener('blur', () => refreshRowApiKeyLink(row));
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
    // Auto-open Advanced settings if Zyclops is enabled or any UA override is set
    const advancedDetails = row.querySelector('details.advanced-settings');
    if (advancedDetails) {
      const searchUaInput = row.querySelector('[data-field="SEARCH_UA"]');
      const downloadUaInput = row.querySelector('[data-field="DOWNLOAD_UA"]');
      const proxyInput = row.querySelector('[data-field="PROXY"]');
      const hasOverride = (searchUaInput && searchUaInput.value && searchUaInput.value.trim())
        || (downloadUaInput && downloadUaInput.value && downloadUaInput.value.trim())
        || (proxyInput && proxyInput.value && proxyInput.value.trim())
        || (zyclopsCheck && zyclopsCheck.checked);
      if (hasOverride) advancedDetails.open = true;
    }
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
    placeholder.textContent = 'Choose a preset';
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
      setRowStatus(row, preset.description || 'Preset added — paste your API key to finish.', false);
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
        throw new Error('Unauthorized: enter your admin token again and reload the configuration.');
      }
      throw new Error(message || 'Request failed');
    }
    if (response.status === 204) return null;
    return response.json();
  }

  // Re-sync all the rich form builders (chip pickers, sort-order builder, quality
  // grid, pattern preview, control visibility) from the current field/hidden values.
  // Extracted from loadConfiguration so profile mode can re-run it after overlaying a
  // profile's overrides onto the form.
  function refreshFormBuilders() {
    setupPatternPreview();
    applyLanguageSelectionsFromHidden();
    applyQualitySelectionsFromHidden();
    applySortOrderFromHidden();
    refreshAllChipPickers();
    applyTmdbLanguageSelectionsFromHidden();
    syncTmdbLanguageControls();
    refreshNewznabFieldNames();
    syncStreamProtectionControls(true);
    syncSortingControls();
    syncStreamingModeControls();
    syncManagerControls();
    syncNewznabControls();
    syncConfigWarnings();
    if (typeof syncSortImportControls === 'function') syncSortImportControls();
  }

  async function loadConfiguration() {
    authError.classList.add('hidden');
    markLoading(true);
    saveStatus.textContent = '';

    try {
      const data = await apiRequest('/admin/api/config');
      const values = data.values || {};
      lastGlobalValues = values; // cached so profile mode can show inherited defaults
      loadedSortMode = (values.NZB_SORT_MODE || 'quality_then_size').toString().trim().toLowerCase();
      setAvailableNewznabPresets(data?.newznabPresets || []);
      updateVersionBadge(data?.addonVersion);
      allowNewznabTestSearch = Boolean(data?.debugNewznabSearch);
      setupNewznabRowsFromValues(values);
      populateForm(values);
      // Backward compat: derive NZB_STREAM_PROTECTION from legacy vars if not set.
      // Triage disabled (or unset) → auto-advance (no health checks, runtime failover).
      if (streamProtectionSelect && !values.NZB_STREAM_PROTECTION) {
        const legacyEnabled = parseBool(values.NZB_TRIAGE_ENABLED);
        const legacyMode = (values.NZB_TRIAGE_MODE || '').trim().toLowerCase();
        if (!legacyEnabled) {
          streamProtectionSelect.value = 'auto-advance';
        } else if (legacyMode === 'background') {
          streamProtectionSelect.value = 'smart-play';
        } else {
          streamProtectionSelect.value = 'health-check';
        }
      }
      // Backward compat: derive NZB_DEDUP_MODE from legacy NZB_DEDUP_ENABLED
      // if the new key isn't set. Users who had dedupe enabled (or unset) get
      // 'standard' — the same behavior they had before this dropdown existed.
      const dedupeModeSelect = configForm.querySelector('select[name="NZB_DEDUP_MODE"]');
      if (dedupeModeSelect && !values.NZB_DEDUP_MODE) {
        const legacyDedupeRaw = (values.NZB_DEDUP_ENABLED ?? 'true').toString().trim().toLowerCase();
        const legacyDedupeOff = ['false', '0', 'off', 'no'].includes(legacyDedupeRaw);
        dedupeModeSelect.value = legacyDedupeOff ? 'off' : 'standard';
      }
      refreshFormBuilders();
      configSection.classList.remove('hidden');
      loadProfiles();
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

    setupSectionCollapsers();
  }

  // Add a chevron to each top-level <section.group> header that toggles
  // collapse state. State persists in localStorage so users don't have to
  // re-collapse their long sections on every reload.
  function setupSectionCollapsers() {
    const COLLAPSE_KEY = 'usenetstreamer-admin-collapsed-sections';
    let collapsed = null; // null = no saved state yet (first visit)
    try {
      const raw = localStorage.getItem(COLLAPSE_KEY);
      if (raw !== null) collapsed = new Set(JSON.parse(raw));
    } catch (_) { /* ignore */ }

    const saveState = () => {
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify(Array.from(collapsed)));
      } catch (_) { /* ignore */ }
    };

    const sections = configForm.querySelectorAll('section.group');

    // First-visit default: collapse everything so the page isn't a giant wall.
    // Once the user has any saved state (even an empty array from expanding
    // everything), we respect it.
    if (collapsed === null) {
      collapsed = new Set();
      sections.forEach((section) => {
        const heading = section.querySelector(':scope > h3');
        if (!heading) return;
        const key = section.id || heading.textContent.trim();
        if (key) collapsed.add(key);
      });
      saveState();
    }

    sections.forEach((section) => {
      const heading = section.querySelector(':scope > h3');
      if (!heading) return;
      const key = section.id || heading.textContent.trim();
      if (!key) return;

      // Add the toggle chevron to the heading
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'section-collapse-toggle';
      btn.setAttribute('aria-label', 'Collapse section');
      btn.textContent = '▾';
      heading.appendChild(btn);
      heading.classList.add('section-heading-collapsible');

      const apply = () => {
        const isCollapsed = collapsed.has(key);
        section.classList.toggle('section-collapsed', isCollapsed);
        btn.textContent = isCollapsed ? '▸' : '▾';
        btn.setAttribute('aria-label', isCollapsed ? 'Expand section' : 'Collapse section');
      };
      apply();

      const toggle = (event) => {
        // Only toggle on heading/chevron clicks, not on inner-content clicks
        if (event.target.closest('button, input, select, textarea, a, .field-grid')) {
          if (event.target !== btn && !btn.contains(event.target)) return;
        }
        event.preventDefault();
        if (collapsed.has(key)) collapsed.delete(key);
        else collapsed.add(key);
        saveState();
        apply();
      };
      btn.addEventListener('click', toggle);
      heading.addEventListener('click', (event) => {
        // Heading click anywhere also toggles, unless user clicked an inline link/control
        if (event.target.tagName === 'A' || event.target.tagName === 'BUTTON') return;
        toggle(event);
      });
    });
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

  // When editing a saved profile, install/copy targets THAT profile's manifest URL
  // (insert /<slug> before /manifest.json); otherwise the global manifest.
  function effectiveManifestUrl() {
    if (currentProfileSlug && currentProfileSlug !== '__new__' && currentManifestUrl) {
      return currentManifestUrl.replace(/\/manifest\.json([^/]*)$/, `/${currentProfileSlug}/manifest.json$1`);
    }
    return currentManifestUrl;
  }

  async function copyManifestUrl() {
    if (!currentManifestUrl || copyManifestButton.disabled) return;
    const url = effectiveManifestUrl();
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
    const encoded = encodeURIComponent(effectiveManifestUrl());
    const url = `https://web.stremio.com/#/addons?addon=${encoded}`;
    const newWindow = window.open(url, '_blank', 'noopener,noreferrer');
    if (!newWindow) {
      window.location.href = url;
    }
  }

  function openStremioAppInstall() {
    if (!currentManifestUrl) return;
    const deeplink = getStremioProtocolUrl(effectiveManifestUrl());
    const newWindow = window.open(deeplink, '_blank');
    if (!newWindow) {
      window.location.href = deeplink;
    }
  }

  const healthToggle = configForm.querySelector('input[name="NZB_TRIAGE_ENABLED"]');
  const streamProtectionSelect = document.getElementById('streamProtectionSelect');
  const autoAdvanceStrategySelect = document.getElementById('autoAdvanceStrategySelect');
  const autoAdvanceStrategyLabel = document.getElementById('autoAdvanceStrategyLabel');
  const prefetchLabel = document.getElementById('prefetchLabel');
  const prefetchToggle = document.getElementById('prefetchToggle');
  const smartPlayModeLabel = document.getElementById('smartPlayModeLabel');
  const smartPlayModeSelect = document.getElementById('smartPlayModeSelect');
  const healthCheckCredentialsGroup = document.getElementById('healthCheckCredentialsGroup');
  const protectionNntpNote = document.getElementById('protectionNntpNote');
  const healthRequiredFields = Array.from(configForm.querySelectorAll('[data-health-required]'));
  const triageCandidateSelect = configForm.querySelector('select[name="NZB_TRIAGE_MAX_CANDIDATES"]');
  const triageConnectionsInput = configForm.querySelector('input[name="NZB_TRIAGE_MAX_CONNECTIONS"]');

  function updateHealthFieldRequirements() {
    const mode = streamProtectionSelect?.value || 'none';
    const needsNntp = ['health-check', 'health-check-auto-advance', 'smart-play-only', 'smart-play'].includes(mode);
    healthRequiredFields.forEach((field) => {
      if (!field) return;
      if (needsNntp) field.setAttribute('required', 'required');
      else field.removeAttribute('required');
    });
  }

  // Warn about NNTP creds only when a health-check mode is selected AND the
  // provider login isn't filled in yet — clears once host/user/pass are set.
  // (A saved password loads as the masked sentinel, which counts as present.)
  function updateProtectionNntpNote() {
    if (!protectionNntpNote) return;
    const mode = streamProtectionSelect?.value || 'none';
    const needsNntp = ['health-check', 'health-check-auto-advance', 'smart-play-only', 'smart-play'].includes(mode);
    const credsMissing = ['NZB_TRIAGE_NNTP_HOST', 'NZB_TRIAGE_NNTP_USER', 'NZB_TRIAGE_NNTP_PASS'].some((name) => {
      const field = configForm.querySelector(`[name="${name}"]`);
      return !field || !String(field.value || '').trim();
    });
    protectionNntpNote.classList.toggle('hidden', !(needsNntp && credsMissing));
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

  /**
   * Sync all stream protection UI: show/hide NNTP section, auto-advance strategy,
   * prefetch toggle, and set the hidden NZB_TRIAGE_ENABLED + NZB_TRIAGE_MODE values.
   */
  function syncStreamProtectionControls(isInitialLoad = false) {
    const mode = streamProtectionSelect?.value || 'none';
    const needsNntp = ['health-check', 'health-check-auto-advance', 'smart-play-only', 'smart-play'].includes(mode);
    const hasAutoAdvance = ['auto-advance', 'health-check-auto-advance', 'smart-play'].includes(mode);

    // Show/hide NNTP credentials section — always visible now
    // (needed for Zyclops even in no-protection/auto-advance modes)

    // Health-check modes can't run without NNTP creds — flag it right at the
    // mode dropdown, but only while the provider login is still missing.
    updateProtectionNntpNote();

    // Show/hide auto-advance strategy dropdown (only for modes with auto-advance)
    if (autoAdvanceStrategyLabel) {
      autoAdvanceStrategyLabel.classList.toggle('hidden', !hasAutoAdvance);
    }

    // Show/hide pre-cache toggle — visible for all modes except "none"
    // (makes sense with auto-advance, health-check, or smart-play)
    if (prefetchLabel) {
      prefetchLabel.classList.toggle('hidden', mode === 'none');
    }

    // Show/hide Smart Play mode dropdown — only for smart-play modes
    const hasSmartPlay = ['smart-play-only', 'smart-play'].includes(mode);
    if (smartPlayModeLabel) {
      smartPlayModeLabel.classList.toggle('hidden', !hasSmartPlay);
    }

    // Smart-play: allow user to toggle pre-cache (no longer forced ON)
    // None: force OFF
    if (prefetchToggle) {
      if (mode === 'none') {
        prefetchToggle.checked = false;
        prefetchToggle.disabled = true;
      } else {
        prefetchToggle.disabled = false;
        if (!isInitialLoad && mode === 'none') {
          prefetchToggle.checked = false;
        }
      }
    }

    // Sync hidden NZB_TRIAGE_ENABLED value
    if (healthToggle) {
      healthToggle.value = needsNntp ? 'true' : 'false';
    }

    // Sync hidden NZB_TRIAGE_MODE input if present
    const triageModeInput = configForm.querySelector('input[name="NZB_TRIAGE_MODE"]');
    if (triageModeInput) {
      switch (mode) {
        case 'health-check': case 'health-check-auto-advance': triageModeInput.value = 'blocking'; break;
        case 'smart-play-only': case 'smart-play': triageModeInput.value = 'background'; break;
        default: triageModeInput.value = 'disabled'; break;
      }
    }

    syncHealthControls();
  }

  function formatSortChain(order) {
    return order
      .map((entry) => {
        const name = SORT_LABELS[entry.key] || entry.key;
        const arrow = entry.direction === 'asc' ? ' ↑' : ' ↓';
        return `${name}${arrow}`;
      })
      .join(' → ');
  }

  function updateBuilderSummary(builder) {
    if (!builder || !builder.summaryEl) return;
    if (builder.scope === 'global') {
      // Global always shows something — either the user's order or the default.
      const effective = builder.activeOrder.length > 0 ? builder.activeOrder : getDefaultSortOrder();
      const label = formatSortChain(effective);
      builder.summaryEl.textContent = builder.activeOrder.length > 0
        ? `Current order: ${label}`
        : `Current order (default): ${label}`;
    } else {
      // Per-type override: empty means fall back to Global — make that explicit.
      if (builder.activeOrder.length === 0) {
        builder.summaryEl.textContent = 'No override — inherits Global order.';
      } else {
        builder.summaryEl.textContent = `Override order: ${formatSortChain(builder.activeOrder)}`;
      }
    }
  }

  function syncSortingControls() {
    Object.values(sortBuilders).forEach(updateBuilderSummary);
    syncConfigWarnings();
  }

  // Only warn about Language not being top-priority when the user has picked
  // a language that *isn't* in the everyday defaults. Picking just English or
  // meta-tags (Original/Multi/Dual Audio/Dubbed/Unknown) doesn't materially
  // change ranking outcomes regardless of where Language sits in the priority
  // chain, so the warning would be noise. Picking Tamil/Korean/etc. is a
  // deliberate non-default choice that *requires* Language at the top to
  // actually affect the order — warn there.
  const LANGUAGE_WARNING_IGNORE_SET = new Set(
    ['Original', 'Multi', 'Dual Audio', 'Dubbed', 'Unknown', 'English'].map((v) => v.toLowerCase())
  );

  function hasNonDefaultLanguagePicked() {
    if (!languageHiddenInput) return false;
    const tokens = (languageHiddenInput.value || '')
      .split(',')
      .map((token) => token.trim())
      .filter(Boolean);
    return tokens.some((token) => !LANGUAGE_WARNING_IGNORE_SET.has(token.toLowerCase()));
  }

  function syncConfigWarnings() {
    const langWarning = configForm.querySelector('[data-language-priority-warning]');
    if (langWarning) {
      const effective = activeSortOrder.length > 0 ? activeSortOrder : getDefaultSortOrder();
      const languageIsTop = effective[0] && effective[0].key === 'language';
      langWarning.classList.toggle('hidden', !(hasNonDefaultLanguagePicked() && !languageIsTop));
    }

    const tmdbWarning = configForm.querySelector('[data-tmdb-strict-id-warning]');
    if (tmdbWarning) {
      const tmdbModeSelect = configForm.querySelector('select[name="TMDB_SEARCH_MODE"]');
      const strictIdCheckbox = configForm.querySelector('input[name="INDEXER_MANAGER_STRICT_ID_MATCH"]');
      const isRegional = tmdbModeSelect?.value === 'english_and_regional';
      const hasAdditionalTmdbLanguages = tmdbLanguageHiddenInput
        && (tmdbLanguageHiddenInput.value || '').trim().length > 0;
      const isStrict = Boolean(strictIdCheckbox?.checked);
      const wantsLocalizedTitles = isRegional || hasAdditionalTmdbLanguages;
      tmdbWarning.classList.toggle('hidden', !(wantsLocalizedTitles && isStrict));
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

    // When Direct Newznab is the active source, the manager fields are hidden,
    // so point the user to the "Direct Newznab Indexers" section below.
    const usingDirectNewznab = managerValue === 'none' || streamingMode === 'native';
    const directNote = configForm.querySelector('[data-direct-newznab-note]');
    if (directNote) directNote.classList.toggle('hidden', !usingDirectNewznab);

    const indexerInput = configForm.querySelector('input[name="INDEXER_MANAGER_INDEXERS"]');
    const indexerHint = indexerInput && indexerInput.nextElementSibling;
    const paidInput = configForm.querySelector('input[name="NZB_TRIAGE_PRIORITY_INDEXERS"]');
    const paidHint = paidInput && paidInput.nextElementSibling;
    if (managerValue === 'prowlarr') {
      if (indexerInput) indexerInput.placeholder = 'e.g. 1,2,3 or -1 for all';
      if (indexerHint) indexerHint.textContent = 'Comma-separated numeric IDs from Prowlarr\'s indexer list. Use -1 to query all Usenet indexers.';
      if (paidInput) paidInput.placeholder = 'e.g. 3,4';
      if (paidHint) paidHint.textContent = 'Numeric IDs of indexers where you have a paid plan. Health checks only run against these.';
    } else if (managerValue === 'nzbhydra') {
      if (indexerInput) indexerInput.placeholder = 'e.g. NZBGeek,UsenetCrawler';
      if (indexerHint) indexerHint.textContent = 'Comma-separated indexer names exactly as shown in NZBHydra (case-sensitive).';
      if (paidInput) paidInput.placeholder = 'e.g. NZBGeek,UsenetCrawler';
      if (paidHint) paidHint.textContent = 'Names of indexers where you have a paid plan, exactly as shown in NZBHydra. Health checks only run against these.';
    }

    syncSaveGuard();
  }

  function syncPrefetchToggle() {
    // Currently no dependencies; placeholder for future state-based enabling/disabling
    return Boolean(prefetchToggle);
  }

  function syncStreamingModeControls() {
    const mode = streamingModeSelect?.value || 'nzbdav';
    const isNativeMode = mode === 'native';
    // Native-mode constraints only apply on plain HTTP. On HTTPS the addon
    // proxies NZBs (encrypted, keys hidden) and any indexer/manager works.
    // Empty/unknown base URL is treated as HTTP (the safe, restrictive default).
    const isHttps = /^https:/i.test((addonBaseUrlInput?.value || '').trim());

    // Show/hide native mode notice + the HTTP-only vs HTTPS sub-notices.
    if (nativeModeNotice) {
      nativeModeNotice.classList.toggle('hidden', !isNativeMode);
    }
    if (nativeHttpNotice) {
      nativeHttpNotice.classList.toggle('hidden', !(isNativeMode && !isHttps));
    }
    if (nativeHttpsNotice) {
      nativeHttpsNotice.classList.toggle('hidden', !(isNativeMode && isHttps));
    }

    if (easynewsHttpsWarning) {
      easynewsHttpsWarning.classList.toggle('hidden', !isNativeMode);
    }

    // Hide NZBDav section in native mode
    if (nzbdavGroup) {
      nzbdavGroup.classList.toggle('hidden', isNativeMode);
    }

    // Native mode forces newznab-only ONLY on HTTP (the addon must hand Stremio
    // the indexer's direct HTTPS link, and manager links are usually local/HTTP).
    // On HTTPS the addon proxies NZBs server-side, so the manager works normally.
    if (indexerManagerGroup && managerSelect) {
      if (isNativeMode && !isHttps) {
        // Force to newznab only
        managerSelect.value = 'none';
        managerSelect.disabled = true;
        // Add a hint that manager is disabled
        const existingHint = indexerManagerGroup.querySelector('.native-mode-hint');
        if (!existingHint) {
          const hint = document.createElement('p');
          hint.className = 'hint native-mode-hint';
          hint.textContent = 'Prowlarr/NZBHydra disabled in Stremio Native mode on HTTP. Serve the addon over HTTPS to use them.';
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

    // In native mode, only allow 'none' and 'health-check' stream protection
    if (streamProtectionSelect) {
      const nativeOnlyValues = new Set(['none', 'health-check']);
      Array.from(streamProtectionSelect.options).forEach((opt) => {
        opt.hidden = isNativeMode && !nativeOnlyValues.has(opt.value);
      });
      // If current selection is hidden, reset to 'health-check'
      if (isNativeMode && !nativeOnlyValues.has(streamProtectionSelect.value)) {
        streamProtectionSelect.value = 'health-check';
        syncStreamProtectionControls();
      }
    }
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
    syncConfigWarnings();
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

  function hasAnyZyclopsEnabled() {
    return getNewznabRows().some((row) => {
      const zyclopsToggle = row.querySelector('[data-field="ZYCLOPS"]');
      return Boolean(zyclopsToggle?.checked);
    });
  }

  async function saveConfiguration(event) {
    event.preventDefault();
    saveStatus.textContent = '';
    if (currentProfileSlug !== null) { return saveProfileConfiguration(); }

    // Block save if any Zyclops is enabled but NNTP host is empty
    if (hasAnyZyclopsEnabled()) {
      const nntpHost = configForm.querySelector('[name="NZB_TRIAGE_NNTP_HOST"]');
      if (!nntpHost?.value?.trim()) {
        saveStatus.textContent = 'Error: Zyclops requires your Usenet Provider Host to be set in the NNTP Health Check Credentials section.';
        return;
      }
    }

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
        ? 'Settings applied and the addon restarted on the new port. All cached results cleared.'
        : 'Settings applied instantly — no restart needed. All cached results cleared.';
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

  // ── Profiles (Option C top switcher) ────────────────────────────────────────
  // currentProfileSlug (declared near the top): null = editing Default/global (saves via
  // POST /config); a slug = editing that profile (only per-profile sections shown, each
  // with an Inherit/Override toggle; saves via POST /profiles).
  let profileOverrideMap = {};   // suffix -> global env key (= form field name)
  let lastGlobalValues = {};     // cached global config, to show inherited defaults + restore
  let knownProfiles = [];

  const profileTabs = document.getElementById('profileTabs');
  const profileEditRow = document.getElementById('profileEditRow');
  const profileNameInput = document.getElementById('profileNameInput');
  const deleteProfileBtn = document.getElementById('deleteProfileBtn');
  const profileInstallHint = document.getElementById('profileInstallHint');
  const profileMultiInstallWarning = document.getElementById('profileMultiInstallWarning');
  const profileSections = Array.from(configForm.querySelectorAll('[data-profile-section]'));

  function profileFieldNames() { return Object.values(profileOverrideMap); }
  function globalKeyToSuffix() {
    const inv = {};
    Object.entries(profileOverrideMap).forEach(([suf, gk]) => { inv[gk] = suf; });
    return inv;
  }
  function escapeHtmlText(s) { const d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  function slugifyName(name) {
    return String(name || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  }

  async function loadProfiles() {
    if (!profileTabs) return;
    try {
      const data = await apiRequest('/admin/api/profiles');
      profileOverrideMap = data.overrideMap || {};
      knownProfiles = data.profiles || [];
      renderProfileTabs();
    } catch (e) { /* profiles are optional; ignore */ }
  }

  // Visible tab bar: Default + every saved profile (always on screen — no hidden
  // dropdown) + a transient "New (unsaved)" tab while creating + a "+ New profile"
  // button. The active tab reflects what's being edited.
  function renderProfileTabs() {
    if (!profileTabs) return;
    const active = currentProfileSlug || '__default__';
    const tabs = [{ slug: '__default__', label: 'Default' }]
      .concat(knownProfiles.map((p) => ({ slug: p.slug, label: p.name })));
    if (currentProfileSlug === '__new__') tabs.push({ slug: '__new__', label: '✦ New (unsaved)' });
    profileTabs.innerHTML = '';
    tabs.forEach((t) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'profile-tab' + (t.slug === active ? ' active' : '');
      btn.textContent = t.label;
      btn.addEventListener('click', () => selectTab(t.slug));
      profileTabs.appendChild(btn);
    });
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'profile-tab profile-tab-add';
    add.textContent = '+ New profile';
    add.addEventListener('click', () => enterProfileMode(null, true));
    profileTabs.appendChild(add);
  }
  function syncSwitcherToCurrent() { renderProfileTabs(); }

  function selectTab(slug) {
    if (slug === '__new__') return; // already creating
    if (slug === '__default__') { enterDefaultMode(); return; }
    const profile = knownProfiles.find((p) => p.slug === slug);
    if (profile) enterProfileMode(profile, false);
    else enterDefaultMode();
  }

  function setSectionOverride(section, on) {
    section.classList.toggle('profile-inherit', !on);
    // Override ON => expand the (collapsible) section so its fields are visible;
    // inherit => collapse it (clean + dimmed). This is the key fix: checking
    // "Override" now reveals the fields instead of leaving a collapsed empty section.
    section.classList.toggle('section-collapsed', !on);
    const chevron = section.querySelector('.section-collapse-toggle');
    if (chevron) { chevron.textContent = on ? '▾' : '▸'; chevron.disabled = false; }
    section.querySelectorAll('input[name], select[name], textarea[name], button').forEach((el) => {
      if (el.hasAttribute('data-profile-override-toggle')) return;
      if (el.classList.contains('section-collapse-toggle')) return; // keep the expand/collapse chevron usable
      if (el.type === 'submit') return;
      el.disabled = !on;
    });
    const toggle = section.querySelector('[data-profile-override-toggle]');
    if (toggle) toggle.checked = on;
  }

  function ensureOverrideToggles() {
    profileSections.forEach((section) => {
      if (section.querySelector('[data-profile-override-toggle]')) return;
      const h3 = section.querySelector('h3');
      if (!h3) return;
      const label = document.createElement('label');
      label.className = 'profile-override-label';
      label.innerHTML = '<input type="checkbox" data-profile-override-toggle /> Override for this profile';
      // Don't let clicks on the override control bubble to the section collapse toggle.
      label.addEventListener('click', (e) => e.stopPropagation());
      h3.appendChild(label);
      label.querySelector('input').addEventListener('change', (e) => setSectionOverride(section, e.target.checked));
    });
  }
  function showOverrideToggles(show) {
    profileSections.forEach((section) => {
      const lbl = section.querySelector('.profile-override-label');
      if (lbl) lbl.classList.toggle('hidden', !show);
    });
  }

  function enterDefaultMode() {
    currentProfileSlug = null;
    syncSwitcherToCurrent();
    if (profileEditRow) profileEditRow.classList.add('hidden');
    if (profileInstallHint) profileInstallHint.classList.add('hidden');
    // The multi-install warning is only relevant for non-default profiles —
    // the Default profile is the one everyone installs, so hide it here.
    if (profileMultiInstallWarning) profileMultiInstallWarning.classList.add('hidden');
    configForm.classList.remove('profile-mode');
    // Re-enable the per-profile section fields we disabled; shared sections are restored
    // by removing profile-mode + refreshFormBuilders() below.
    profileSections.forEach((s) => {
      s.classList.remove('profile-inherit');
      s.querySelectorAll('input[name], select[name], textarea[name], button').forEach((el) => { el.disabled = false; });
    });
    showOverrideToggles(false);
    populateForm(lastGlobalValues);
    refreshFormBuilders();
    syncProfileAddonNamePlaceholder();
    if (saveButton) saveButton.textContent = 'Save Changes';
  }

  function enterProfileMode(profile, isNew) {
    currentProfileSlug = isNew ? '__new__' : profile.slug;
    syncSwitcherToCurrent();
    ensureOverrideToggles();
    if (profileEditRow) profileEditRow.classList.remove('hidden');
    // Show the "one profile per Stremio account" warning when editing any
    // non-default profile (including a new, unsaved one).
    if (profileMultiInstallWarning) profileMultiInstallWarning.classList.remove('hidden');
    profileNameInput.value = isNew ? '' : profile.name;
    deleteProfileBtn.classList.toggle('hidden', isNew);
    // Hide shared sections via a form class so the rich builders (which toggle .hidden
    // on shared groups by mode/manager) can't re-show them; CSS !important wins.
    configForm.classList.add('profile-mode');
    // Baseline = global config so inherited fields show the effective default.
    populateForm(lastGlobalValues);
    const g2s = globalKeyToSuffix();
    const overrides = (profile && profile.overrides) || {};
    profileSections.forEach((section) => {
      section.classList.remove('hidden');
      let hasOverride = false;
      Array.from(section.querySelectorAll('input[name], select[name], textarea[name]')).forEach((el) => {
        if (!profileFieldNames().includes(el.name)) {
          // Shared field inside a per-profile section (e.g. Base URL / Stream Token in
          // "Addon Name") — it stays global, so hide it while editing a profile.
          const wrap = el.closest('label') || el.parentElement;
          if (wrap) wrap.classList.add('profile-foreign-field');
          return;
        }
        const suf = g2s[el.name];
        if (suf && overrides[suf] !== undefined) {
          hasOverride = true;
          if (el.type === 'checkbox') el.checked = parseBool(overrides[suf]);
          else el.value = overrides[suf];
        }
      });
      setSectionOverride(section, hasOverride);
    });
    showOverrideToggles(true);
    refreshFormBuilders();
    // refreshFormBuilders may re-enable controls — re-apply inherit/override disabling.
    profileSections.forEach((section) => {
      const t = section.querySelector('[data-profile-override-toggle]');
      setSectionOverride(section, Boolean(t && t.checked));
    });
    // Don't pre-fill the inherited base name into the field — a blank field means
    // "inherit", surfaced via the placeholder as "{base} ({profile})". Keep only a
    // genuinely custom name (one that differs from the base default name).
    const profileNameField = configForm.querySelector('[name="ADDON_NAME"]');
    if (profileNameField) {
      const base = (lastGlobalValues.ADDON_NAME || '').trim() || 'UsenetStreamer';
      if (isNew || (profileNameField.value || '').trim() === base) profileNameField.value = '';
    }
    syncProfileAddonNamePlaceholder();
    updateProfileInstallHint();
    if (saveButton) { saveButton.disabled = false; saveButton.textContent = isNew ? 'Create profile' : 'Save profile'; }
  }

  function updateProfileInstallHint() {
    if (!profileInstallHint) return;
    const slug = slugifyName(profileNameInput.value);
    if (!slug || !currentManifestUrl) { profileInstallHint.classList.add('hidden'); return; }
    const url = currentManifestUrl.replace(/\/manifest\.json([^/]*)$/, `/${slug}/manifest.json$1`);
    profileInstallHint.innerHTML = `Install this profile in Stremio: <code>${escapeHtmlText(url)}</code> — install only <strong>one</strong> profile per Stremio account (each installed profile makes this addon run again on every title).`;
    profileInstallHint.classList.remove('hidden');
  }

  // For a profile, the Addon Display Name field is left blank when inheriting; the
  // effective Stremio name ("{base} ({profile})") is shown as the placeholder +
  // hint, so it's clear a blank field still produces a distinct, suffixed name.
  // (Server appends the "(profile)" suffix unless a genuinely custom name is set.)
  function syncProfileAddonNamePlaceholder() {
    const nameInput = configForm.querySelector('[name="ADDON_NAME"]');
    if (!nameInput) return;
    const hint = nameInput.closest('label') && nameInput.closest('label').querySelector('.field-hint');
    if (currentProfileSlug === null) {
      nameInput.placeholder = 'UsenetStreamer';
      if (hint) hint.textContent = 'Appears in Stremio as the addon title.';
      return;
    }
    const base = (lastGlobalValues.ADDON_NAME || '').trim() || 'UsenetStreamer';
    const effective = `${base} (${(profileNameInput.value || '').trim() || 'profile name'})`;
    nameInput.placeholder = effective;
    if (hint) hint.textContent = `Leave blank to inherit — appears in Stremio as “${effective}”. Enter a name to fully override.`;
  }

  function gatherProfileOverrides() {
    const overrides = {};
    const g2s = globalKeyToSuffix();
    profileSections.forEach((section) => {
      const toggle = section.querySelector('[data-profile-override-toggle]');
      if (!toggle || !toggle.checked) return; // inherit -> omit (cleared on the server)
      section.querySelectorAll('input[name], select[name], textarea[name]').forEach((el) => {
        const suf = g2s[el.name];
        if (!suf) return;
        let v;
        if (el.type === 'checkbox') v = el.checked ? 'true' : 'false';
        else if (el.multiple) v = Array.from(el.selectedOptions).map((o) => o.value).join(',');
        else v = el.value != null ? String(el.value) : '';
        overrides[suf] = v;
      });
    });
    return overrides;
  }

  async function saveProfileConfiguration() {
    const name = (profileNameInput.value || '').trim();
    if (!name) { saveStatus.textContent = 'Error: enter a profile name.'; return; }
    try {
      markSaving(true);
      const body = { name, overrides: gatherProfileOverrides() };
      if (currentProfileSlug && currentProfileSlug !== '__new__') body.slug = currentProfileSlug;
      const result = await apiRequest('/admin/api/profiles', { method: 'POST', body: JSON.stringify(body) });
      const saved = result && result.profile;
      // Show this profile's own manifest URL at the bottom too (like the default
      // profile does), so it's where users expect it — not only the top hint.
      const savedSlug = saved && saved.slug;
      const profileManifestUrl = (savedSlug && currentManifestUrl)
        ? currentManifestUrl.replace(/\/manifest\.json([^/]*)$/, `/${savedSlug}/manifest.json$1`)
        : '';
      const urlNote = profileManifestUrl ? `Manifest URL: ${profileManifestUrl}. ` : '';
      saveStatus.textContent = `${urlNote}Profile "${name}" saved — settings apply instantly, no restart needed.`;
      if (savedSlug) currentProfileSlug = savedSlug;
      await loadProfiles();
      const justSaved = saved && saved.slug ? knownProfiles.find((p) => p.slug === saved.slug) : null;
      if (justSaved) enterProfileMode(justSaved, false); else renderProfileTabs();
    } catch (error) {
      saveStatus.textContent = `Error: ${error.message}`;
    } finally {
      markSaving(false);
    }
  }

  async function deleteCurrentProfile() {
    if (!currentProfileSlug || currentProfileSlug === '__new__') {
      enterDefaultMode();
      return;
    }
    if (!window.confirm('Delete this profile? Its Stremio addon will stop working.')) return;
    try {
      await apiRequest(`/admin/api/profiles/${encodeURIComponent(currentProfileSlug)}`, { method: 'DELETE' });
      saveStatus.textContent = 'Profile deleted.';
      currentProfileSlug = null;
      await loadProfiles();
      enterDefaultMode();
    } catch (error) {
      saveStatus.textContent = `Error: ${error.message}`;
    }
  }

  if (profileTabs) {
    deleteProfileBtn.addEventListener('click', deleteCurrentProfile);
    profileNameInput.addEventListener('input', () => { updateProfileInstallHint(); syncProfileAddonNamePlaceholder(); });
  }

  const testButtons = configForm.querySelectorAll('button[data-test]');
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

  if (streamProtectionSelect) {
    streamProtectionSelect.addEventListener('change', () => syncStreamProtectionControls(false));
  }
  // Re-evaluate the NNTP-creds note as the user fills in the provider login.
  ['NZB_TRIAGE_NNTP_HOST', 'NZB_TRIAGE_NNTP_USER', 'NZB_TRIAGE_NNTP_PASS'].forEach((name) => {
    const field = configForm.querySelector(`[name="${name}"]`);
    if (field) field.addEventListener('input', updateProtectionNntpNote);
  });
  if (autoAdvanceStrategySelect) {
    autoAdvanceStrategySelect.addEventListener('change', () => syncStreamProtectionControls(false));
  }
  if (triageCandidateSelect) {
    triageCandidateSelect.addEventListener('change', () => {
      enforceConnectionLimit();
    });
  }
  if (triageConnectionsInput) {
    triageConnectionsInput.addEventListener('input', enforceConnectionLimit);
  }
  languageCheckboxes.forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      // Capture click order: ticking appends to the end of the priority list
      // (so first-clicked = top priority), unticking removes the entry and
      // shifts everything after it up by one.
      if (checkbox.checked) {
        if (!languagePriorityOrder.includes(checkbox.value)) {
          languagePriorityOrder.push(checkbox.value);
        }
      } else {
        languagePriorityOrder = languagePriorityOrder.filter((v) => v !== checkbox.value);
      }
      syncLanguageHiddenInput();
      syncSortingControls();
      syncSaveGuard();
    });
  });

  // Wire change handlers per builder. Each scope owns its own activeOrder
  // independently — toggling a key in Movies does not affect Global.
  Object.values(sortBuilders).forEach((builder) => {
    builder.options.forEach((option) => {
      option.addEventListener('change', () => {
        const key = (option.value || '').trim().toLowerCase();
        // First-time tick on an empty per-type list starts from blank (no
        // defaults). Global still pulls from the legacy default chain so the
        // "remove last item to reset" path behaves the same as before.
        const baseOrder = builder.activeOrder.length > 0
          ? builder.activeOrder.slice()
          : (builder.scope === 'global' ? getDefaultSortOrder() : []);
        const next = baseOrder.filter((entry) => entry.key !== key);
        if (option.checked) {
          next.push({ key, direction: getDefaultDirection(key) });
        }
        setBuilderOrder(builder, next);
        syncSaveGuard();
      });
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

  // Re-evaluate native-mode HTTP/HTTPS constraints when the base URL changes,
  // so the warning + manager controls reflect http:// vs https:// live.
  if (addonBaseUrlInput) {
    addonBaseUrlInput.addEventListener('input', () => {
      syncStreamingModeControls();
    });
  }

  // Sort config import preview (lives inside Sort & Filter section)
  const sortImportPreviewButton = document.getElementById('sortImportPreviewButton');
  const sortImportPreview = document.getElementById('sortImportPreview');
  const sortImportStatus = document.getElementById('sortImportStatus');
  const sortImportTextarea = document.getElementById('sortImportConfigTextarea');
  const sortImportAdvanced = document.getElementById('sortImportAdvanced');

  function setSortImportStatus(text, isError = false) {
    if (!sortImportStatus) return;
    sortImportStatus.textContent = text || '';
    sortImportStatus.style.color = isError ? 'var(--danger, #ff8d9b)' : 'var(--text-muted)';
  }

  function renderSortImportPreview(data) {
    if (!sortImportPreview) return;
    if (!data) {
      sortImportPreview.classList.add('hidden');
      sortImportPreview.innerHTML = '';
      return;
    }
    const renderList = (items) => Array.isArray(items) && items.length
      ? '<code>' + items.map((v) => String(v).replace(/[<>&]/g, (c) => ({ '<':'&lt;', '>':'&gt;', '&':'&amp;' }[c]))).join(', ') + '</code>'
      : '<span class="field-hint">(none)</span>';
    const renderCriteria = (list) => Array.isArray(list) && list.length
      ? '<code>' + list.map((c) => `${c.key} ${c.direction === 'asc' ? '↑' : '↓'}`).join(' → ') + '</code>'
      : '<span class="field-hint">(none)</span>';

    const sc = data.sortCriteria || {};
    const pref = data.preferred || {};
    const excl = (data.filters && data.filters.excluded) || {};

    const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
    // Surface importer warnings (dropped/ignored keys) so the user knows what
    // was NOT applied — otherwise the import looks fully successful when parts
    // were silently skipped.
    const warnings = Array.isArray(data.warnings) ? data.warnings : [];
    const warningsHtml = warnings.length
      ? `<div class="sort-import-warnings"><strong>⚠️ ${warnings.length} item(s) were not imported:</strong><ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>`
      : '';

    sortImportPreview.innerHTML = `
      <h4 class="compact">Imported config</h4>
      <div class="sort-import-preview-grid">
        <div><strong>Sort (global):</strong> ${renderCriteria(sc.global)}</div>
        ${sc.movies ? `<div><strong>Sort (movies):</strong> ${renderCriteria(sc.movies)}</div>` : ''}
        ${sc.series ? `<div><strong>Sort (series):</strong> ${renderCriteria(sc.series)}</div>` : ''}
        ${sc.anime ? `<div><strong>Sort (anime):</strong> ${renderCriteria(sc.anime)}</div>` : ''}
        <div><strong>Preferred resolutions:</strong> ${renderList(pref.resolutions)}</div>
        <div><strong>Preferred qualities:</strong> ${renderList(pref.qualities)}</div>
        ${pref.languages && pref.languages.length ? `<div><strong>Preferred languages:</strong> ${renderList(pref.languages)}</div>` : ''}
        ${pref.releaseGroups && pref.releaseGroups.length ? `<div><strong>Preferred release groups:</strong> ${renderList(pref.releaseGroups)}</div>` : ''}
        <div><strong>Excluded qualities:</strong> ${renderList(excl.qualities)}</div>
        <div><strong>Excluded visual tags:</strong> ${renderList(excl.visualTags)}</div>
      </div>
      ${warningsHtml}
    `;
    sortImportPreview.classList.remove('hidden');
  }

  function syncSortImportControls() {
    if (!sortImportAdvanced) return;
    // Auto-open the Advanced disclosure when the import textarea has content.
    const hasJsonRemainder = sortImportTextarea && sortImportTextarea.value && sortImportTextarea.value.trim();
    if (hasJsonRemainder) sortImportAdvanced.open = true;
  }

  // Map imported sort key names → our legacy sort builder key names so the basic
  // priority builder reflects the imported sortCriteria.global.
  const IMPORT_KEY_TO_LEGACY = {
    releaseGroup: 'release_group',
    visualTag: 'visual_tag',
    audioTag: 'audio_tag',
    audioChannel: 'audio_channel',
    age: 'date',
  };
  function importKeyToLegacy(key) {
    return IMPORT_KEY_TO_LEGACY[key] || key;
  }

  // Normalize imported resolution tokens to match our checkbox values.
  const IMPORT_RESOLUTION_MAP = {
    '4320p': '8k',
    '2160p': '4k',
  };
  function normalizeImportedResolutions(list) {
    if (!Array.isArray(list)) return [];
    return list.map((r) => IMPORT_RESOLUTION_MAP[r] || r);
  }

  function setInputValue(name, value) {
    const input = configForm.querySelector(`input[name="${name}"], textarea[name="${name}"]`);
    if (input) input.value = value == null ? '' : String(value);
  }

  function setCsvInput(name, list) {
    if (!Array.isArray(list)) return;
    setInputValue(name, list.join(','));
  }

  function setTextareaLines(id, list) {
    const el = document.getElementById(id);
    if (!el || !Array.isArray(list)) return;
    el.value = list.join('\n');
  }


  // Populate the basic UI form fields from a parsed sort-config import. After
  // this runs, the form fields ARE the source of truth — the JSON textarea is
  // left with only per-type sort data that can't be shown in the basic UI.
  function populateFormFromImport(parsed) {
    // Sort priority — translate imported keys to legacy keys and serialize per scope.
    const SCOPE_TO_INPUT_NAME = {
      global: 'NZB_SORT_ORDER',
      movies: 'NZB_SORT_ORDER_MOVIES',
      series: 'NZB_SORT_ORDER_SERIES',
      anime: 'NZB_SORT_ORDER_ANIME',
    };
    let anyScopePopulated = false;
    Object.entries(SCOPE_TO_INPUT_NAME).forEach(([scope, inputName]) => {
      const hidden = configForm.querySelector(`input[name="${inputName}"]`);
      if (!hidden) return;
      const list = parsed.sortCriteria?.[scope];
      if (!Array.isArray(list)) return;
      hidden.value = list
        .map((c) => `${importKeyToLegacy(c.key)}:${c.direction || 'desc'}`)
        .filter((token) => !token.startsWith(':')) // drop entries whose key didn't map
        .join(',');
      anyScopePopulated = true;
    });
    if (anyScopePopulated && typeof applySortOrderFromHidden === 'function') {
      applySortOrderFromHidden();
    }

    // Preferred lists (text inputs + language hidden picker)
    setCsvInput('NZB_PREFERRED_QUALITIES', parsed.preferred?.qualities);
    setCsvInput('NZB_PREFERRED_ENCODES', parsed.preferred?.encodes);
    setCsvInput('NZB_PREFERRED_VISUAL_TAGS', parsed.preferred?.visualTags);
    setCsvInput('NZB_PREFERRED_AUDIO_TAGS', parsed.preferred?.audioTags);
    setCsvInput('NZB_PREFERRED_AUDIO_CHANNELS', parsed.preferred?.audioChannels);
    setCsvInput('NZB_PREFERRED_RELEASE_GROUPS', parsed.preferred?.releaseGroups);

    // Preferred languages — hidden CSV input + checkbox grid
    if (languageHiddenInput && Array.isArray(parsed.preferred?.languages)) {
      languageHiddenInput.value = parsed.preferred.languages.join(',');
      if (typeof applyLanguageSelectionsFromHidden === 'function') applyLanguageSelectionsFromHidden();
    }

    // Resolution filter — translate 4320p/2160p → 8k/4k for our checkbox grid
    if (qualityHiddenInput && Array.isArray(parsed.preferred?.resolutions) && parsed.preferred.resolutions.length) {
      qualityHiddenInput.value = normalizeImportedResolutions(parsed.preferred.resolutions).join(',');
      if (typeof applyQualitySelectionsFromHidden === 'function') applyQualitySelectionsFromHidden();
    } else if (qualityHiddenInput && Array.isArray(parsed.filters?.included?.resolutions) && parsed.filters.included.resolutions.length) {
      qualityHiddenInput.value = normalizeImportedResolutions(parsed.filters.included.resolutions).join(',');
      if (typeof applyQualitySelectionsFromHidden === 'function') applyQualitySelectionsFromHidden();
    }

    // Excluded lists
    const exc = parsed.filters?.excluded || {};
    setCsvInput('NZB_EXCLUDED_QUALITIES', exc.qualities);
    setCsvInput('NZB_EXCLUDED_VISUAL_TAGS', exc.visualTags);
    setCsvInput('NZB_EXCLUDED_ENCODES', exc.encodes);
    setCsvInput('NZB_EXCLUDED_AUDIO_TAGS', exc.audioTags);
    setCsvInput('NZB_EXCLUDED_AUDIO_CHANNELS', exc.audioChannels);
    setCsvInput('NZB_EXCLUDED_LANGUAGES', exc.languages);
    setCsvInput('NZB_EXCLUDED_RELEASE_GROUPS', exc.releaseGroups);

    // Numeric ranges
    const ranges = parsed.filters?.ranges || {};
    if (ranges.size?.min) setInputValue('NZB_MIN_RESULT_SIZE_GB', (ranges.size.min / (1024 * 1024 * 1024)).toFixed(2));
    if (ranges.size?.max) setInputValue('NZB_MAX_RESULT_SIZE_GB', (ranges.size.max / (1024 * 1024 * 1024)).toFixed(2));
    if (ranges.bitrate?.max) setInputValue('NZB_MAX_BITRATE_MBPS', (ranges.bitrate.max / 1_000_000).toFixed(2));

    // Regex pattern textareas — imported configs store as { pattern, name,
    // negate, ... }; serialize back to source strings (prefix with ! for
    // negate) for our UI.
    const serializePattern = (entry) => {
      if (typeof entry === 'string') return entry;
      if (!entry || typeof entry !== 'object') return null;
      const src = entry.pattern;
      if (typeof src !== 'string') return null;
      return entry.negate ? `!${src}` : src;
    };
    const requiredPatterns = (parsed.filters?.requiredRegex || [])
      .map(serializePattern).filter(Boolean);
    const excludedPatterns = (parsed.filters?.excludedRegex || [])
      .map(serializePattern).filter(Boolean);
    setTextareaLines('requiredRegexTextarea', requiredPatterns);
    setTextareaLines('excludedRegexTextarea', excludedPatterns);

    // Strip the import JSON textarea — only keep per-type sort criteria that
    // can't be shown in the basic UI. If nothing remains, clear it entirely.
    const perTypeKeys = ['movies', 'series', 'anime', 'cached', 'uncached',
      'cachedMovies', 'cachedSeries', 'cachedAnime',
      'uncachedMovies', 'uncachedSeries', 'uncachedAnime'];
    const remainder = {};
    for (const k of perTypeKeys) {
      if (Array.isArray(parsed.sortCriteria?.[k]) && parsed.sortCriteria[k].length) {
        remainder[k] = parsed.sortCriteria[k];
      }
    }
    if (sortImportTextarea) {
      if (Object.keys(remainder).length) {
        sortImportTextarea.value = JSON.stringify({ sortCriteria: remainder }, null, 2);
      } else {
        sortImportTextarea.value = '';
      }
    }
    syncSaveGuard();
  }

  if (sortImportPreviewButton && sortImportTextarea) {
    sortImportPreviewButton.addEventListener('click', () => {
      const raw = sortImportTextarea.value.trim();
      if (!raw) {
        setSortImportStatus('Paste a sort-config JSON first.', true);
        renderSortImportPreview(null);
        return;
      }
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch (err) {
        // Try base64
        try {
          payload = JSON.parse(atob(raw));
        } catch (_) {
          setSortImportStatus('Invalid JSON. Re-export and paste again.', true);
          renderSortImportPreview(null);
          return;
        }
      }
      // POST to the preview endpoint via apiRequest so the X-Addon-Token
      // header is set consistently with the rest of the admin calls.
      apiRequest('/admin/api/sort-import/preview', {
        method: 'POST',
        body: JSON.stringify({ config: payload }),
      })
        .then((body) => {
          populateFormFromImport(body);
          renderSortImportPreview(body);
          const remainderMsg = sortImportTextarea && sortImportTextarea.value.trim()
            ? ' (per-type sort kept in the JSON box below)'
            : '';
          const warnCount = Array.isArray(body && body.warnings) ? body.warnings.length : 0;
          const warnMsg = warnCount ? ` — ${warnCount} item(s) not supported and skipped (see below)` : '';
          setSortImportStatus(`Imported and applied to fields above${remainderMsg}. Click Save Changes to persist.${warnMsg}`, warnCount > 0);
          syncSortImportControls();
        })
        .catch((err) => {
          setSortImportStatus(err?.message || 'Import request failed', true);
          renderSortImportPreview(null);
        });
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

  const tmdbModeSelectEl = configForm.querySelector('select[name="TMDB_SEARCH_MODE"]');
  if (tmdbModeSelectEl) {
    tmdbModeSelectEl.addEventListener('change', syncConfigWarnings);
  }
  const strictIdCheckboxEl = configForm.querySelector('input[name="INDEXER_MANAGER_STRICT_ID_MATCH"]');
  if (strictIdCheckboxEl) {
    strictIdCheckboxEl.addEventListener('change', syncConfigWarnings);
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
      // Nested context (matches the upstream template schema)
      stream: {
        title: 'Tune Part Two',
        proxied: true,
        private: false,
        resolution: '2160p',
        upscaled: false,
        quality: 'WEB-DL',
        streamQuality: 'WEB-DL',
        resolutionQuality: '4K',
        encode: 'HEVC',
        type: 'movie',
        visualTags: ['HDR+DV', 'HDR10', 'DV'],
        audioTags: ['Atmos', 'DD+'],
        audioChannels: ['5.1'],
        seeders: 0,
        size: 16535624089.6, // 15.4 GB in bytes
        bitrate: '13.3 Mbps', // ~ size*8 / (166 min * 60)
        files: 24,
        date: '2024-03-01',
        grabs: 1280,
        folderSize: 0,
        indexer: 'NZBGeek',
        languages: ['English'],
        network: '',
        filename: 'Tune.Part.Two.2024.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR10.H.265-FLUX.mkv',
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

    const defaultShortPattern = 'addon, health, instant, resolution';
    const defaultDescPattern = 'title,\nstream_quality,\nsource,\ncodec,\nvisual,\naudio,\ngroup,\nsize,\nbitrate,\nlanguages,\nindexer,\nfiles,\ndate,\nhealth';
    const legacyDescPattern = 'filename,\nsource,\ncodec,\nvisual,\naudio,\ngroup,\nsize,\nlanguages,\nindexer';
    const previousDefaultDescPattern = 'title,\nsource,\ncodec,\nvisual,\naudio,\ngroup,\nsize,\nlanguages,\nindexer';
    // The prior default (no bitrate/files/date) — bump users still on it.
    const supersededDefaultDescPattern = 'title,\nstream_quality,\nsource,\ncodec,\nvisual,\naudio,\ngroup,\nsize,\nlanguages,\nindexer,\nhealth';

    if (shortInput && !shortInput.value.trim()) {
      shortInput.value = defaultShortPattern;
    }
    if (descInput) {
      const currentDesc = descInput.value.trim();
      if (!currentDesc || currentDesc === legacyDescPattern || currentDesc === previousDefaultDescPattern || currentDesc === supersededDefaultDescPattern) {
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
            quality: '{stream.resolution::exists["{stream.resolution}"||""]}',
            resolution_quality: '{stream.resolution::exists["{stream.resolution}"||""]}',
            stream_quality: '{stream.streamQuality::exists["{stream.streamQuality}"||""]}',
            resolution: '{stream.resolution::exists["{stream.resolution}"||""]}',
            source: '{stream.source::exists["{stream.source}"||""]}',
            codec: '{stream.encode::exists["{stream.encode}"||""]}',
            group: '{stream.releaseGroup::exists["{stream.releaseGroup}"||""]}',
            size: '{stream.size::>0["{stream.size::bytes}"||""]}',
            bitrate: '{stream.bitrate::exists["{stream.bitrate}"||""]}',
            files: '{stream.files::exists["{stream.files} files"||""]}',
            date: '{stream.date::exists["{stream.date}"||""]}',
            grabs: '{stream.grabs::exists["{stream.grabs} grabs"||""]}',
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
            bitrate: '{stream.bitrate::exists["📶 {stream.bitrate}"||""]}',
            files: '{stream.files::exists["📁 {stream.files} files"||""]}',
            date: '{stream.date::exists["📅 {stream.date}"||""]}',
            grabs: '{stream.grabs::exists["⬇️ {stream.grabs} grabs"||""]}',
            languages: '{stream.languages::join(" ")::exists["🌎 {stream.languages::join(\" \")}"||""]}',
            indexer: '{stream.indexer::exists["🔎 {stream.indexer}"||""]}',
            health: '{stream.health::exists["🧪 {stream.health}"||""]}',
            instant: '{stream.instant::istrue["⚡ Instant"||""]}',
            quality: '{stream.resolution::exists["🖥️ {stream.resolution}"||""]}',
            resolution_quality: '{stream.resolution::exists["🖥️ {stream.resolution}"||""]}',
            stream_quality: '{stream.streamQuality::exists["✨ {stream.streamQuality}"||""]}',
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
        quality: '{stream.resolution::exists["{stream.resolution}"||""]}',
        resolution_quality: '{stream.resolution::exists["{stream.resolution}"||""]}',
        stream_quality: '{stream.streamQuality::exists["{stream.streamQuality}"||""]}',
        resolution: '{stream.resolution::exists["{stream.resolution}"||""]}',
        source: '{stream.source::exists["{stream.source}"||""]}',
        codec: '{stream.encode::exists["{stream.encode}"||""]}',
        group: '{stream.releaseGroup::exists["{stream.releaseGroup}"||""]}',
        size: '{stream.size::>0["{stream.size::bytes}"||""]}',
        bitrate: '{stream.bitrate::exists["{stream.bitrate}"||""]}',
        files: '{stream.files::exists["{stream.files} files"||""]}',
        date: '{stream.date::exists["{stream.date}"||""]}',
        grabs: '{stream.grabs::exists["{stream.grabs} grabs"||""]}',
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
        bitrate: '{stream.bitrate::exists["📶 {stream.bitrate}"||""]}',
        files: '{stream.files::exists["📁 {stream.files} files"||""]}',
        date: '{stream.date::exists["📅 {stream.date}"||""]}',
        grabs: '{stream.grabs::exists["⬇️ {stream.grabs} grabs"||""]}',
        languages: '{stream.languages::join(" ")::exists["🌎 {stream.languages::join(\" \")}"||""]}',
        indexer: '{stream.indexer::exists["🔎 {stream.indexer}"||""]}',
        health: '{stream.health::exists["🧪 {stream.health}"||""]}',
        instant: '{stream.instant::istrue["⚡ Instant"||""]}',
        quality: '{stream.resolution::exists["🖥️ {stream.resolution}"||""]}',
        resolution_quality: '{stream.resolution::exists["🖥️ {stream.resolution}"||""]}',
        stream_quality: '{stream.streamQuality::exists["✨ {stream.streamQuality}"||""]}',
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
  setupSuggestionPanels();
  syncSaveGuard();
  setupSectionCollapsers();
})();
