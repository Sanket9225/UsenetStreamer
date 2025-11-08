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
      const required = field.required ? 'required' : '';
      const defaultValue = field.default || '';

      if (field.type === 'text' || field.type === 'password' || field.type === 'number') {
        configFields += `
          <div style="margin-bottom: 1.5vh;">
            <label for="${field.key}" style="display: block; margin-bottom: 0.5vh; font-weight: bold;">
              ${field.title || field.key}${field.required ? ' *' : ''}
            </label>
            <input
              type="${field.type}"
              id="${field.key}"
              name="${field.key}"
              value="${defaultValue}"
              ${required}
              style="width: 100%; padding: 1vh; font-size: 1.8vh; border: 1px solid #ddd; border-radius: 0.5vh;"
            />
          </div>`;
      } else if (field.type === 'checkbox') {
        const checked = defaultValue === 'checked' ? 'checked' : '';
        configFields += `
          <div style="margin-bottom: 1.5vh;">
            <label style="display: flex; align-items: center;">
              <input
                type="checkbox"
                id="${field.key}"
                name="${field.key}"
                ${checked}
                style="margin-right: 1vh; width: 2vh; height: 2vh;"
              />
              <span style="font-weight: bold;">${field.title || field.key}</span>
            </label>
          </div>`;
      } else if (field.type === 'select' && field.options) {
        configFields += `
          <div style="margin-bottom: 1.5vh;">
            <label for="${field.key}" style="display: block; margin-bottom: 0.5vh; font-weight: bold;">
              ${field.title || field.key}${field.required ? ' *' : ''}
            </label>
            <select
              id="${field.key}"
              name="${field.key}"
              ${required}
              style="width: 100%; padding: 1vh; font-size: 1.8vh; border: 1px solid #ddd; border-radius: 0.5vh;"
            >
              ${field.options.map(opt => {
                const selected = opt === defaultValue ? 'selected' : '';
                return `<option value="${opt}" ${selected}>${opt}</option>`;
              }).join('')}
            </select>
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
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { height: 100%; font-family: Arial, sans-serif; }
    body {
      background: #000 url('${addonBackground}') center center / cover no-repeat;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.7);
      z-index: 1;
    }
    .container {
      position: relative;
      z-index: 2;
      width: 40vh;
      max-width: 90%;
      text-align: center;
    }
    .logo {
      width: 14vh;
      height: 14vh;
      margin: 0 auto 2vh;
      background: url('${addonLogo}') center center / contain no-repeat;
    }
    h1 { font-size: 4.5vh; margin-bottom: 1vh; }
    .version { font-size: 1.8vh; opacity: 0.8; margin-bottom: 2vh; }
    .description { font-size: 2vh; line-height: 1.5; margin-bottom: 2vh; opacity: 0.9; }
    .types {
      background: rgba(255, 255, 255, 0.1);
      padding: 1vh 2vh;
      border-radius: 1vh;
      font-size: 1.8vh;
      margin-bottom: 3vh;
    }
    form {
      background: rgba(255, 255, 255, 0.95);
      padding: 3vh;
      border-radius: 1vh;
      text-align: left;
      color: #333;
      margin-bottom: 2vh;
    }
    .button {
      display: inline-block;
      background: #8A5AAB;
      color: #fff;
      padding: 2vh 4vh;
      font-size: 2.2vh;
      text-decoration: none;
      border-radius: 1vh;
      border: none;
      cursor: pointer;
      transition: background 0.3s;
      width: 100%;
    }
    .button:hover { background: #7a4a9b; }
    .button:active { background: #6a3a8b; }
    .footer {
      margin-top: 3vh;
      font-size: 1.6vh;
      opacity: 0.7;
    }
  </style>
</head>
<body>
  <div class="overlay"></div>
  <div class="container">
    ${addonLogo ? '<div class="logo"></div>' : ''}
    <h1>${addonName}</h1>
    <div class="version">v${addonVersion}</div>
    ${addonDescription ? `<div class="description">${addonDescription}</div>` : ''}
    ${types ? `<div class="types">${types}</div>` : ''}

    ${hasConfig ? `
      <form id="configForm">
        ${configFields}
        <button type="submit" class="button">Install</button>
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
      const form = document.getElementById('configForm');
      const baseUrl = window.location.protocol + '//' + window.location.host;

      form.addEventListener('submit', function(e) {
        e.preventDefault();

        const formData = new FormData(form);
        const config = {};

        for (let [key, value] of formData.entries()) {
          const input = form.elements[key];
          if (input.type === 'checkbox') {
            config[key] = input.checked;
          } else if (input.type === 'number') {
            config[key] = parseFloat(value);
          } else {
            config[key] = value;
          }
        }

        const userData = btoa(JSON.stringify(config));
        const installUrl = 'stremio://' + baseUrl.replace(/^https?:\\/\\//, '') + '/' + userData + '/manifest.json';

        window.location.href = installUrl;
      });
    </script>
  ` : ''}
</body>
</html>`;
}

module.exports = {
  generateLandingPage
};
