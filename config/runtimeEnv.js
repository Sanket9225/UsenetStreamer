const fs = require('fs');
const path = require('path');

// Allow overriding the configuration directory at runtime via ENV.
// If CONFIG_DIR is set (and not empty), we resolve it relative to CWD; otherwise we fall back to this module's directory.
// This lets downstream forks relocate runtime-env.json without patching upstream paths.
const CONFIG_DIR = (() => {
  const override = process.env.CONFIG_DIR;
  if (override && override.trim() !== '') {
    // Use path.resolve to normalize; if override is relative it becomes absolute from current working directory.
    return path.resolve(override.trim());
  }
  return path.join(__dirname);
})();
const RUNTIME_ENV_FILE = path.join(CONFIG_DIR, 'runtime-env.json');
let cachedEnv = null;
let appliedKeys = new Set();

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function readRuntimeEnv() {
  if (cachedEnv) return { ...cachedEnv };

  try {
    const raw = fs.readFileSync(RUNTIME_ENV_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      cachedEnv = {};
      Object.keys(parsed).forEach((key) => {
        const value = parsed[key];
        if (value === undefined || value === null) return;
        cachedEnv[key] = String(value);
      });
      return { ...cachedEnv };
    }
  } catch (error) {
    // ignore missing/invalid files; we'll recreate on save
  }

  cachedEnv = {};
  return {};
}

function writeRuntimeEnv(envObject) {
  ensureConfigDir();
  const sortedKeys = Object.keys(envObject).sort();
  const data = {};
  sortedKeys.forEach((key) => {
    data[key] = envObject[key];
  });
  fs.writeFileSync(RUNTIME_ENV_FILE, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
  // Ensure restrictive permissions even if file already existed with wider mode
  try { fs.chmodSync(RUNTIME_ENV_FILE, 0o600); } catch (_) { /* Windows ignores chmod */ }
  cachedEnv = { ...data };
}

function applyRuntimeEnv() {
  const env = readRuntimeEnv();
  // Remove any keys we previously applied that are no longer present
  appliedKeys.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(env, key)) {
      delete process.env[key];
    }
  });
  Object.entries(env).forEach(([key, value]) => {
    process.env[key] = value;
  });
  appliedKeys = new Set(Object.keys(env));
}

function updateRuntimeEnv(updates) {
  if (!updates || typeof updates !== 'object') return;
  const current = readRuntimeEnv();
  Object.entries(updates).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      delete current[key];
    } else {
      current[key] = String(value);
    }
  });
  writeRuntimeEnv(current);
}

function getRuntimeEnv() {
  return readRuntimeEnv();
}

module.exports = {
  applyRuntimeEnv,
  updateRuntimeEnv,
  getRuntimeEnv,
  RUNTIME_ENV_FILE,
};
