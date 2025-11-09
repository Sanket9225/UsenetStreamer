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
      max-width: 500px;
      text-align: center;
      animation: fadeIn 0.3s ease-out;
    }

    .logo {
      width: 14vh;
      height: 14vh;
      margin: 0 auto 2vh;
      background: url('${addonLogo}') center center / contain no-repeat;
      transition: all 0.15s ease;
    }

    .logo:hover {
      transform: translateY(-2px);
      filter: drop-shadow(0 10px 15px rgba(66, 153, 255, 0.2));
    }

    h1 {
      font-size: clamp(2rem, 4.5vh, 3rem);
      margin-bottom: 1vh;
      font-weight: 700;
      background: linear-gradient(135deg, var(--card-foreground) 0%, var(--primary) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .version {
      font-size: 1.8vh;
      color: var(--muted-foreground);
      margin-bottom: 2vh;
    }

    .description {
      font-size: 2vh;
      line-height: 1.5;
      margin-bottom: 2vh;
      color: var(--muted-foreground);
    }

    .types {
      background: var(--muted);
      backdrop-filter: blur(10px);
      padding: 1vh 2vh;
      border-radius: var(--radius);
      font-size: 1.8vh;
      margin-bottom: 3vh;
      border: 1px solid var(--border);
    }

    form {
      background: var(--card);
      backdrop-filter: blur(10px);
      padding: 2rem;
      border-radius: calc(var(--radius) * 2);
      text-align: left;
      color: var(--card-foreground);
      margin-bottom: 2vh;
      border: 1px solid var(--border);
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.2);
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

    .footer {
      margin-top: 3vh;
      font-size: 0.875rem;
      color: var(--muted-foreground);
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

      form {
        padding: 1.5rem;
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
  </style>
</head>
<body>
  <div class="container">
    ${addonLogo ? '<div class="logo"></div>' : ''}
    <h1>${addonName}</h1>
    <div class="version">v${addonVersion}</div>
    ${addonDescription ? `<div class="description">${addonDescription}</div>` : ''}
    ${types ? `<div class="types">${types}</div>` : ''}

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
        ${configFields}
        <div class="button-group">
          <button type="submit" class="button">Install</button>
          <button type="button" class="button secondary-button" id="copyButton">Copy URL</button>
        </div>
        <div class="copy-feedback" id="copyFeedback">✓ URL copied to clipboard!</div>
      </form>
    ` : `
      <a href="stremio://${ADDON_BASE_URL.replace(/^https?:\/\//, '')}/manifest.json" class="button">
        Install
      </a>
    `}

    <div class="footer">
      Stremio Addon
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

      // Helper function to build config with password
      function buildConfig() {
        const formData = new FormData(configForm);
        const config = {};

        // Include the authenticated password
        if (authenticatedPassword) {
          config.password = authenticatedPassword;
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
