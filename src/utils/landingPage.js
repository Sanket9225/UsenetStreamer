const { ADDON_BASE_URL } = require('../config/environment');

/**
 * Generate landing page HTML for the addon
 * @param {object} manifest - Manifest configuration
 * @returns {string} HTML string
 */
function generateLandingPage(manifest) {
  const addonName = manifest.name || 'Stremio Addon';
  const addonVersion = manifest.version || '0.0.0';
  const addonDescription = manifest.description || '';
  const addonLogo = manifest.logo || '';
  const addonBackground = manifest.background || addonLogo;
  const types = (manifest.types || []).join(' / ');

  const hasConfig = !!(manifest.config && manifest.config.length);

  // Generate configuration form fields
  let configFields = '';
  if (hasConfig) {
    manifest.config.forEach(field => {
      // Skip password field - it's handled by authentication form
      if (field.key === 'password') {
        return;
      }

      const required = field.required ? 'required' : '';
      // Use nullish coalescing to handle 0 and false as valid defaults
      const defaultValue = field.default ?? '';

      if (field.type === 'text' || field.type === 'password' || field.type === 'number') {
        configFields += `
          <div>
            <label for="${field.key}">
              ${field.title || field.key}${field.required ? ' *' : ''}
            </label>
            <input
              type="${field.type}"
              id="${field.key}"
              name="${field.key}"
              value="${defaultValue}"
              ${required}
            />
          </div>`;
      } else if (field.type === 'checkbox') {
        const checked = defaultValue === 'checked' ? 'checked' : '';
        configFields += `
          <div>
            <label>
              <input
                type="checkbox"
                id="${field.key}"
                name="${field.key}"
                ${checked}
              />
              <span>${field.title || field.key}</span>
            </label>
          </div>`;
      } else if (field.type === 'select' && field.options) {
        configFields += `
          <div>
            <label for="${field.key}">
              ${field.title || field.key}${field.required ? ' *' : ''}
            </label>
            <div class="select-wrapper">
              <select
                id="${field.key}"
                name="${field.key}"
                ${required}
              >
                ${field.options.map(opt => {
                  const selected = opt === defaultValue ? 'selected' : '';
                  return `<option value="${opt}" ${selected}>${opt}</option>`;
                }).join('')}
              </select>
            </div>
          </div>`;
      }
    });
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${addonName} - Stremio Addon</title>
  <style>
    :root {
      --background: hsl(224, 71%, 4%);
      --card: hsl(222, 47%, 7%);
      --card-foreground: hsl(213, 31%, 91%);
      --primary: hsl(210, 100%, 50%);
      --primary-foreground: hsl(222, 47%, 11%);
      --secondary: hsl(222, 47%, 11%);
      --muted: hsl(223, 47%, 11%);
      --muted-foreground: hsl(215, 16%, 70%);
      --border: hsl(216, 34%, 17%);
      --input: hsl(222, 47%, 11%);
      --ring: hsl(212.7, 26.8%, 83.9%);
      --destructive: hsl(0, 63%, 31%);
      --radius: 0.5rem;
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    html, body {
      height: 100%;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      font-size: 0.95rem;
      letter-spacing: -0.011rem;
      line-height: 1.7;
    }

    body {
      background: var(--background);
      background-image: radial-gradient(ellipse 80% 50% at 50% -20%, hsl(210, 100%, 20%), transparent),
                        radial-gradient(ellipse 80% 80% at 50% 120%, hsl(224, 71%, 8%), transparent);
      color: var(--card-foreground);
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 2rem;
      animation: fadeIn 0.3s ease-out;
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
        transform: translateY(10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @keyframes pulse {
      0%, 100% {
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.2);
      }
      50% {
        box-shadow: 0 10px 15px -3px rgba(66, 153, 255, 0.3), 0 4px 6px -2px rgba(66, 153, 255, 0.2);
      }
    }

    .container {
      position: relative;
      width: 100%;
      max-width: 600px;
      animation: fadeIn 0.3s ease-out;
    }

    .card {
      background: var(--card);
      border-radius: calc(var(--radius) * 2);
      box-shadow: 0 4px 28px -5px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.05) inset;
      padding: 2.25rem;
      margin-bottom: 2rem;
      border: 1px solid var(--border);
      animation: fadeIn 0.4s ease-out;
      position: relative;
      overflow: hidden;
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
    }

    .card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 0.3rem;
      background: linear-gradient(90deg, var(--primary) 0%, hsl(270, 100%, 50%) 100%);
    }

    .header {
      display: flex;
      align-items: flex-start;
      gap: 1.75rem;
      margin-bottom: 2.5rem;
      border-bottom: 1px solid var(--border);
      padding-bottom: 2rem;
    }

    .header-content {
      display: flex;
      flex-direction: column;
      flex: 1;
    }

    .header-title-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.75rem;
    }

    .title {
      color: var(--card-foreground);
      margin: 0;
      font-weight: 600;
      line-height: 1.2;
      font-size: 1.75rem;
      letter-spacing: -0.025em;
    }

    .logo {
      width: 80px;
      height: 80px;
      border-radius: calc(var(--radius) * 0.8);
      object-fit: cover;
      border: 1px solid var(--border);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      transition: transform 0.2s, box-shadow 0.2s;
    }

    .logo:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
    }

    .description {
      font-size: 0.95rem;
      line-height: 1.6;
      color: var(--muted-foreground);
      margin: 0;
    }

    form {
      text-align: left;
      color: var(--card-foreground);
    }

    .install-button-wrapper {
      text-align: center;
      padding-top: 1rem;
    }

    label {
      display: block;
      margin-bottom: 0.5rem;
      font-weight: 600;
      font-size: 0.875rem;
      color: var(--card-foreground);
    }

    input[type="text"],
    input[type="password"],
    input[type="number"],
    select {
      width: 100%;
      padding: 0.625rem 0.875rem;
      font-size: 0.95rem;
      background: var(--input);
      color: var(--card-foreground);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      transition: all 0.15s ease;
      font-family: inherit;
    }

    select {
      appearance: none;
      -webkit-appearance: none;
      -moz-appearance: none;
      padding-right: 2.5rem;
      cursor: pointer;
    }

    input[type="text"]:hover,
    input[type="password"]:hover,
    input[type="number"]:hover,
    select:hover {
      border-color: var(--primary);
    }

    input[type="text"]:focus,
    input[type="password"]:focus,
    input[type="number"]:focus,
    select:focus {
      outline: none;
      border-color: var(--primary);
      box-shadow: 0 0 0 3px rgba(66, 153, 255, 0.15);
    }

    .select-wrapper {
      position: relative;
      width: 100%;
    }

    .select-wrapper::after {
      content: '';
      position: absolute;
      right: 0.875rem;
      top: 50%;
      width: 0.625rem;
      height: 0.625rem;
      pointer-events: none;
      border-right: 2px solid var(--card-foreground);
      border-bottom: 2px solid var(--card-foreground);
      transform: translateY(-70%) rotate(45deg);
      transition: all 0.15s ease;
    }

    .select-wrapper:hover::after {
      border-color: var(--primary);
    }

    input[type="checkbox"] {
      width: 1.25rem;
      height: 1.25rem;
      margin-right: 0.75rem;
      cursor: pointer;
      accent-color: var(--primary);
    }

    .button {
      display: inline-block;
      background: var(--primary);
      color: white;
      padding: 0.625rem 1.5rem;
      font-size: 0.95rem;
      font-weight: 600;
      text-decoration: none;
      border-radius: var(--radius);
      border: none;
      cursor: pointer;
      transition: all 0.15s ease;
      width: 100%;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.2);
    }

    .button:hover {
      transform: translateY(-1px);
      box-shadow: 0 10px 15px -3px rgba(66, 153, 255, 0.3), 0 4px 6px -2px rgba(66, 153, 255, 0.2);
      background: hsl(210, 100%, 45%);
    }

    .button:active {
      transform: translateY(1px);
      box-shadow: 0 2px 4px -1px rgba(0, 0, 0, 0.2), 0 1px 2px -1px rgba(0, 0, 0, 0.1);
    }

    .button:disabled {
      background: var(--muted);
      color: var(--muted-foreground);
      cursor: not-allowed;
      transform: none;
      box-shadow: none;
    }

    .button-group {
      display: flex;
      gap: 0.75rem;
      margin-top: 1.5rem;
    }

    .button-group .button {
      width: calc(50% - 0.375rem);
    }

    .secondary-button {
      background: var(--secondary);
      color: var(--card-foreground);
    }

    .secondary-button:hover {
      background: hsl(222, 47%, 15%);
      transform: translateY(-1px);
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3), 0 4px 6px -2px rgba(0, 0, 0, 0.2);
    }

    .secondary-button:active {
      transform: translateY(1px);
      box-shadow: 0 2px 4px -1px rgba(0, 0, 0, 0.2), 0 1px 2px -1px rgba(0, 0, 0, 0.1);
    }

    .error-message {
      color: hsl(0, 84%, 60%);
      font-size: 0.875rem;
      margin-top: 0.75rem;
      display: none;
      padding: 0.5rem;
      background: hsl(0, 63%, 31%, 0.1);
      border-radius: var(--radius);
      border-left: 3px solid hsl(0, 84%, 60%);
    }

    .success-message {
      color: hsl(142, 71%, 45%);
      font-size: 0.875rem;
      margin-bottom: 1.5rem;
      display: none;
      padding: 0.75rem;
      background: var(--card);
      border-radius: var(--radius);
      border: 1px solid var(--border);
      border-left: 3px solid hsl(142, 71%, 45%);
    }

    .copy-feedback {
      color: hsl(142, 71%, 45%);
      font-size: 0.875rem;
      margin-top: 0.75rem;
      display: none;
      padding: 0.5rem;
      background: hsl(142, 71%, 45%, 0.1);
      border-radius: var(--radius);
      border-left: 3px solid hsl(142, 71%, 45%);
    }

    .hidden {
      display: none !important;
    }

    .social-links {
      display: flex;
      justify-content: center;
      gap: 1.25rem;
      margin-top: 1.5rem;
    }

    .social-link {
      color: var(--muted-foreground);
      transition: all 0.15s ease;
      opacity: 0.75;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .social-link:hover {
      color: var(--primary);
      opacity: 1;
      transform: translateY(-2px);
    }

    .social-link svg {
      width: 22px;
      height: 22px;
    }

    .border {
      border-bottom: 1px solid var(--border);
      max-width: 15%;
      margin: 1.25rem auto;
      opacity: 0.5;
    }

    .footer {
      text-align: center;
    }

    .version {
      color: var(--muted-foreground);
      text-align: center;
      font-size: 0.85rem;
      margin: 0;
    }

    /* Custom scrollbar */
    ::-webkit-scrollbar {
      width: 10px;
    }

    ::-webkit-scrollbar-track {
      background: var(--background);
    }

    ::-webkit-scrollbar-thumb {
      background: var(--muted);
      border-radius: 5px;
    }

    ::-webkit-scrollbar-thumb:hover {
      background: var(--border);
    }

    /* Responsive adjustments */
    @media (max-width: 768px) {
      body {
        padding: 1rem;
      }

      .card {
        padding: 1.5rem;
      }

      .header {
        flex-direction: column;
        gap: 1.25rem;
        text-align: center;
      }

      .header-title-row {
        flex-direction: column;
        gap: 1rem;
      }

      .logo {
        display: none;
      }

      .button-group {
        flex-direction: column;
      }

      .button-group .button {
        width: 100%;
      }
    }

    /* Form field spacing */
    form > div {
      margin-bottom: 1.5rem;
    }

    form > div:last-of-type {
      margin-bottom: 0;
    }

    /* Checkbox container */
    label:has(input[type="checkbox"]) {
      display: flex;
      align-items: center;
      cursor: pointer;
      user-select: none;
    }

    label:has(input[type="checkbox"]):hover {
      color: var(--primary);
    }

    /* Indexer Selection Styles */
    .indexer-list {
      max-height: 250px;
      overflow-y: auto;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--input);
      padding: 0.5rem;
    }

    .indexer-item {
      display: flex;
      align-items: center;
      padding: 0.5rem;
      border-radius: calc(var(--radius) * 0.75);
      transition: background 0.15s ease;
      cursor: pointer;
      user-select: none;
    }

    .indexer-item:hover {
      background: var(--secondary);
    }

    .indexer-item input[type="checkbox"] {
      margin-right: 0.75rem;
      margin-top: 0;
    }

    .indexer-item-label {
      flex: 1;
      font-size: 0.875rem;
      font-weight: 500;
    }

    .indexer-item-protocol {
      font-size: 0.75rem;
      color: var(--muted-foreground);
      background: var(--muted);
      padding: 0.125rem 0.5rem;
      border-radius: calc(var(--radius) * 0.5);
    }

    .indexer-actions {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.5rem;
      padding: 0.5rem;
      background: var(--secondary);
      border-radius: var(--radius);
    }

    .indexer-action-btn {
      font-size: 0.75rem;
      padding: 0.25rem 0.625rem;
      background: var(--muted);
      color: var(--card-foreground);
      border: none;
      border-radius: calc(var(--radius) * 0.5);
      cursor: pointer;
      transition: all 0.15s ease;
      font-weight: 500;
    }

    .indexer-action-btn:hover {
      background: var(--border);
    }

    /* Category Selection Styles */
    .indexer-item-container {
      border-bottom: 1px solid var(--border);
      padding-bottom: 0.5rem;
      margin-bottom: 0.5rem;
    }

    .indexer-item-container:last-child {
      border-bottom: none;
      margin-bottom: 0;
      padding-bottom: 0;
    }

    .indexer-expand-btn {
      margin-left: auto;
      background: none;
      border: none;
      color: var(--muted-foreground);
      cursor: pointer;
      padding: 0.25rem 0.5rem;
      font-size: 0.75rem;
      transition: color 0.15s ease;
    }

    .indexer-expand-btn:hover {
      color: var(--primary);
    }

    .category-section {
      display: none;
      margin-top: 0.5rem;
      margin-left: 2rem;
      padding: 0.5rem;
      background: var(--secondary);
      border-radius: calc(var(--radius) * 0.5);
    }

    .category-section.expanded {
      display: block;
    }

    .category-item {
      display: flex;
      align-items: center;
      padding: 0.25rem 0;
      font-size: 0.8125rem;
    }

    .category-item input[type="checkbox"] {
      margin-right: 0.5rem;
      width: 1rem;
      height: 1rem;
    }

    .category-item-label {
      color: var(--card-foreground);
    }

    .category-actions {
      display: flex;
      gap: 0.375rem;
      margin-bottom: 0.5rem;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid var(--border);
    }

    .category-action-btn {
      font-size: 0.6875rem;
      padding: 0.1875rem 0.5rem;
      background: var(--muted);
      color: var(--card-foreground);
      border: none;
      border-radius: calc(var(--radius) * 0.4);
      cursor: pointer;
      transition: all 0.15s ease;
      font-weight: 500;
    }

    .category-action-btn:hover {
      background: var(--border);
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <!-- Header Section -->
      <div class="header">
        ${addonLogo ? `<img src="${addonLogo}" alt="${addonName}" class="logo" />` : ''}
        <div class="header-content">
          <div class="header-title-row">
            <h1 class="title">${addonName}</h1>
          </div>
          ${addonDescription ? `<p class="description">${addonDescription}</p>` : ''}
        </div>
      </div>

      ${hasConfig ? `
        <!-- Password Authentication Form (shown first) -->
        <form id="authForm">
          <div>
            <label for="auth_password">
              Enter Password to Configure *
            </label>
            <input
              type="password"
              id="auth_password"
              name="auth_password"
              required
              autocomplete="off"
            />
          </div>
          <div class="error-message" id="authError">Invalid password</div>
          <button type="submit" class="button" id="unlockButton">Unlock Configuration</button>
        </form>

        <!-- Success Message (shown after auth) -->
        <div class="success-message" id="authSuccess">✓ Authenticated</div>

        <!-- Configuration Form (hidden until authenticated) -->
        <form id="configForm" class="hidden">
          <!-- Indexer Selection Section -->
          <div id="indexerSection">
            <label for="indexerSelection">
              Prowlarr Indexers
            </label>
            <div id="indexerLoadingMessage" style="color: var(--muted-foreground); font-size: 0.875rem; padding: 0.5rem 0;">
              Loading indexers...
            </div>
            <div id="indexerErrorMessage" class="error-message" style="display: none;">
              Failed to load indexers
            </div>
            <div id="indexerList" class="indexer-list hidden"></div>
            <div style="margin-top: 0.5rem; font-size: 0.875rem; color: var(--muted-foreground);">
              <span id="indexerSelectionCount">No indexers selected</span> • Leave empty to use all indexers<br>
              Click "Show Categories" to filter specific categories (e.g., exclude ebooks, audio)
            </div>
          </div>

          ${configFields}
          <div class="button-group">
            <button type="submit" class="button">Install</button>
            <button type="button" class="button secondary-button" id="copyButton">Copy URL</button>
          </div>
          <div class="copy-feedback" id="copyFeedback">✓ URL copied to clipboard!</div>
        </form>
      ` : `
        <div class="install-button-wrapper">
          <a href="stremio://${ADDON_BASE_URL.replace(/^https?:\/\//, '')}/manifest.json" class="button">
            Install
          </a>
        </div>
      `}
    </div>

    <!-- Social Links -->
    <div class="social-links">
      <a href="https://github.com/BRNKR/UsenetStreamer" target="_blank" rel="noopener noreferrer" class="social-link" title="GitHub">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
        </svg>
      </a>
      <a href="https://buymeacoffee.com/brnkr" target="_blank" rel="noopener noreferrer" class="social-link" title="Buy Me a Coffee">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 8h1a4 4 0 0 1 0 8h-1"></path>
          <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path>
          <line x1="6" y1="1" x2="6" y2="4"></line>
          <line x1="10" y1="1" x2="10" y2="4"></line>
          <line x1="14" y1="1" x2="14" y2="4"></line>
        </svg>
      </a>
    </div>

    <!-- Divider -->
    <div class="border"></div>

    <!-- Footer -->
    <div class="footer">
      <p class="version">v${addonVersion}</p>
    </div>
  </div>

  ${hasConfig ? `
    <script>
      const authForm = document.getElementById('authForm');
      const configForm = document.getElementById('configForm');
      const authError = document.getElementById('authError');
      const authSuccess = document.getElementById('authSuccess');
      const copyButton = document.getElementById('copyButton');
      const copyFeedback = document.getElementById('copyFeedback');
      const baseUrl = window.location.protocol + '//' + window.location.host;

      // Store authenticated password in memory for this session
      let authenticatedPassword = null;

      // Store available indexers and selected state
      let availableIndexers = [];
      let selectedIndexerIds = [];
      let selectedCategoriesByIndexer = {}; // { indexerId: [categoryIds] }

      // Update indexer selection count
      function updateIndexerCount() {
        const countElement = document.getElementById('indexerSelectionCount');
        if (selectedIndexerIds.length === 0) {
          countElement.textContent = 'No indexers selected';
        } else if (selectedIndexerIds.length === 1) {
          countElement.textContent = '1 indexer selected';
        } else {
          countElement.textContent = selectedIndexerIds.length + ' indexers selected';
        }
      }

      // Fetch indexers from API
      async function fetchIndexers() {
        const indexerLoadingMessage = document.getElementById('indexerLoadingMessage');
        const indexerErrorMessage = document.getElementById('indexerErrorMessage');
        const indexerList = document.getElementById('indexerList');

        try {
          const response = await fetch(baseUrl + '/indexers');
          const data = await response.json();

          if (!response.ok) {
            throw new Error(data.message || 'Failed to fetch indexers');
          }

          availableIndexers = data.indexers || [];

          if (availableIndexers.length === 0) {
            indexerLoadingMessage.textContent = 'No indexers available';
            return;
          }

          // Hide loading message and show indexer list
          indexerLoadingMessage.style.display = 'none';
          indexerList.classList.remove('hidden');

          // Render indexer checkboxes
          renderIndexers();
        } catch (error) {
          console.error('Failed to fetch indexers:', error);
          indexerLoadingMessage.style.display = 'none';
          indexerErrorMessage.textContent = 'Failed to load indexers: ' + error.message;
          indexerErrorMessage.style.display = 'block';
        }
      }

      // Toggle category section visibility
      function toggleCategories(indexerId) {
        const categorySection = document.getElementById('categories_' + indexerId);
        const expandBtn = document.getElementById('expand_' + indexerId);

        if (categorySection) {
          if (categorySection.classList.contains('expanded')) {
            categorySection.classList.remove('expanded');
            expandBtn.textContent = 'Show Categories ▼';
          } else {
            categorySection.classList.add('expanded');
            expandBtn.textContent = 'Hide Categories ▲';
          }
        }
      }

      // Render indexer list with checkboxes and categories
      function renderIndexers() {
        const indexerList = document.getElementById('indexerList');

        // Add select all / deselect all buttons
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'indexer-actions';
        actionsDiv.innerHTML = \`
          <button type="button" class="indexer-action-btn" id="selectAllBtn">Select All</button>
          <button type="button" class="indexer-action-btn" id="deselectAllBtn">Deselect All</button>
        \`;
        indexerList.appendChild(actionsDiv);

        // Add indexer checkboxes with categories
        availableIndexers.forEach(indexer => {
          const containerDiv = document.createElement('div');
          containerDiv.className = 'indexer-item-container';

          const itemDiv = document.createElement('div');
          itemDiv.className = 'indexer-item';

          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.id = 'indexer_' + indexer.id;
          checkbox.value = indexer.id;
          checkbox.addEventListener('change', function() {
            if (this.checked) {
              if (!selectedIndexerIds.includes(indexer.id)) {
                selectedIndexerIds.push(indexer.id);
              }
            } else {
              selectedIndexerIds = selectedIndexerIds.filter(id => id !== indexer.id);
            }
            updateIndexerCount();
          });

          const labelSpan = document.createElement('span');
          labelSpan.className = 'indexer-item-label';
          labelSpan.textContent = indexer.name;

          const protocolSpan = document.createElement('span');
          protocolSpan.className = 'indexer-item-protocol';
          protocolSpan.textContent = indexer.protocol || 'usenet';

          // Add expand button for categories
          const expandBtn = document.createElement('button');
          expandBtn.type = 'button';
          expandBtn.className = 'indexer-expand-btn';
          expandBtn.id = 'expand_' + indexer.id;
          expandBtn.textContent = 'Show Categories ▼';
          expandBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            toggleCategories(indexer.id);
          });

          itemDiv.appendChild(checkbox);
          itemDiv.appendChild(labelSpan);
          itemDiv.appendChild(protocolSpan);
          if (indexer.categories && indexer.categories.length > 0) {
            itemDiv.appendChild(expandBtn);
          }

          // Make the whole item clickable (except expand button)
          itemDiv.addEventListener('click', function(e) {
            if (e.target !== checkbox && e.target !== expandBtn) {
              checkbox.checked = !checkbox.checked;
              checkbox.dispatchEvent(new Event('change'));
            }
          });

          containerDiv.appendChild(itemDiv);

          // Add category section if categories exist
          if (indexer.categories && indexer.categories.length > 0) {
            const categorySection = document.createElement('div');
            categorySection.className = 'category-section';
            categorySection.id = 'categories_' + indexer.id;

            // Add category actions
            const categoryActionsDiv = document.createElement('div');
            categoryActionsDiv.className = 'category-actions';

            const selectAllCatBtn = document.createElement('button');
            selectAllCatBtn.type = 'button';
            selectAllCatBtn.className = 'category-action-btn';
            selectAllCatBtn.textContent = 'Select All';
            selectAllCatBtn.addEventListener('click', function() {
              selectedCategoriesByIndexer[indexer.id] = indexer.categories.map(c => c.id);
              indexer.categories.forEach(cat => {
                const catCheckbox = document.getElementById('cat_' + indexer.id + '_' + cat.id);
                if (catCheckbox) catCheckbox.checked = true;
              });
            });

            const deselectAllCatBtn = document.createElement('button');
            deselectAllCatBtn.type = 'button';
            deselectAllCatBtn.className = 'category-action-btn';
            deselectAllCatBtn.textContent = 'Deselect All';
            deselectAllCatBtn.addEventListener('click', function() {
              selectedCategoriesByIndexer[indexer.id] = [];
              indexer.categories.forEach(cat => {
                const catCheckbox = document.getElementById('cat_' + indexer.id + '_' + cat.id);
                if (catCheckbox) catCheckbox.checked = false;
              });
            });

            categoryActionsDiv.appendChild(selectAllCatBtn);
            categoryActionsDiv.appendChild(deselectAllCatBtn);
            categorySection.appendChild(categoryActionsDiv);

            // Add category checkboxes
            indexer.categories.forEach(category => {
              const categoryItem = document.createElement('div');
              categoryItem.className = 'category-item';

              const catCheckbox = document.createElement('input');
              catCheckbox.type = 'checkbox';
              catCheckbox.id = 'cat_' + indexer.id + '_' + category.id;
              catCheckbox.value = category.id;
              catCheckbox.addEventListener('change', function() {
                if (!selectedCategoriesByIndexer[indexer.id]) {
                  selectedCategoriesByIndexer[indexer.id] = [];
                }

                if (this.checked) {
                  if (!selectedCategoriesByIndexer[indexer.id].includes(category.id)) {
                    selectedCategoriesByIndexer[indexer.id].push(category.id);
                  }
                } else {
                  selectedCategoriesByIndexer[indexer.id] = selectedCategoriesByIndexer[indexer.id].filter(id => id !== category.id);
                }
              });

              const catLabel = document.createElement('label');
              catLabel.className = 'category-item-label';
              catLabel.htmlFor = catCheckbox.id;
              catLabel.textContent = category.name;

              categoryItem.appendChild(catCheckbox);
              categoryItem.appendChild(catLabel);
              categorySection.appendChild(categoryItem);
            });

            containerDiv.appendChild(categorySection);
          }

          indexerList.appendChild(containerDiv);
        });

        // Add event listeners for select/deselect all buttons
        document.getElementById('selectAllBtn').addEventListener('click', function() {
          selectedIndexerIds = availableIndexers.map(i => i.id);
          availableIndexers.forEach(indexer => {
            document.getElementById('indexer_' + indexer.id).checked = true;
          });
          updateIndexerCount();
        });

        document.getElementById('deselectAllBtn').addEventListener('click', function() {
          selectedIndexerIds = [];
          availableIndexers.forEach(indexer => {
            document.getElementById('indexer_' + indexer.id).checked = false;
          });
          updateIndexerCount();
        });
      }

      // Helper function to build config with password
      function buildConfig() {
        const formData = new FormData(configForm);
        const config = {};

        // Include the authenticated password
        if (authenticatedPassword) {
          config.password = authenticatedPassword;
        }

        // Add selected indexers (only if some are selected)
        if (selectedIndexerIds.length > 0) {
          config.selectedIndexers = selectedIndexerIds;
        }

        // Add selected categories (only if some are selected)
        // Filter out empty category arrays
        const nonEmptyCategories = {};
        for (const [indexerId, categoryIds] of Object.entries(selectedCategoriesByIndexer)) {
          if (Array.isArray(categoryIds) && categoryIds.length > 0) {
            nonEmptyCategories[indexerId] = categoryIds;
          }
        }
        if (Object.keys(nonEmptyCategories).length > 0) {
          config.selectedCategories = nonEmptyCategories;
        }

        // Add all form fields
        for (let [key, value] of formData.entries()) {
          const input = configForm.elements[key];
          if (input.type === 'checkbox') {
            config[key] = input.checked;
          } else if (input.type === 'number') {
            config[key] = parseInt(value, 10) || 0;
          } else {
            config[key] = value;
          }
        }

        return config;
      }

      // Password authentication
      authForm.addEventListener('submit', async function(e) {
        e.preventDefault();

        const password = document.getElementById('auth_password').value;
        const unlockButton = document.getElementById('unlockButton');

        // Disable button during request
        unlockButton.disabled = true;
        unlockButton.textContent = 'Verifying...';
        authError.style.display = 'none';

        try {
          const response = await fetch(baseUrl + '/verify-password', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ password })
          });

          const result = await response.json();

          if (result.valid) {
            // Authentication successful - save password in memory
            authenticatedPassword = password;

            // Show authenticated state
            authForm.classList.add('hidden');
            authSuccess.style.display = 'block';
            configForm.classList.remove('hidden');

            // Fetch available indexers
            fetchIndexers();
          } else {
            // Authentication failed
            authError.style.display = 'block';
            unlockButton.disabled = false;
            unlockButton.textContent = 'Unlock Configuration';
          }
        } catch (error) {
          console.error('Authentication error:', error);
          authError.textContent = 'Connection error. Please try again.';
          authError.style.display = 'block';
          unlockButton.disabled = false;
          unlockButton.textContent = 'Unlock Configuration';
        }
      });

      // Config form submission (install)
      configForm.addEventListener('submit', function(e) {
        e.preventDefault();

        const config = buildConfig();
        const userData = btoa(JSON.stringify(config));
        const installUrl = 'stremio://' + baseUrl.replace(/^https?:\\/\\//, '') + '/' + userData + '/manifest.json';

        window.location.href = installUrl;
      });

      // Copy URL button
      copyButton.addEventListener('click', async function() {
        const config = buildConfig();
        const userData = btoa(JSON.stringify(config));
        const manifestUrl = baseUrl + '/' + userData + '/manifest.json';

        try {
          await navigator.clipboard.writeText(manifestUrl);
          copyFeedback.style.display = 'block';

          // Hide feedback after 3 seconds
          setTimeout(() => {
            copyFeedback.style.display = 'none';
          }, 3000);
        } catch (error) {
          console.error('Copy failed:', error);
          // Fallback for older browsers
          const textArea = document.createElement('textarea');
          textArea.value = manifestUrl;
          textArea.style.position = 'fixed';
          textArea.style.left = '-999999px';
          document.body.appendChild(textArea);
          textArea.select();
          try {
            document.execCommand('copy');
            copyFeedback.style.display = 'block';
            setTimeout(() => {
              copyFeedback.style.display = 'none';
            }, 3000);
          } catch (err) {
            alert('Failed to copy URL. Please try manually.');
          }
          document.body.removeChild(textArea);
        }
      });
    </script>
  ` : ''}
</body>
</html>`;
}

module.exports = {
  generateLandingPage
};
