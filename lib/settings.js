// Static config for t3rribox. Edit this file and redeploy.
// Anything here can still be overridden by an env var of the same name,
// so Vercel env vars keep working if you ever want them.

const settings = {
  // ---- GitHub storage ----
  // Fine-grained token with "Contents: Read and write" on the storage repo.
  // DO NOT commit a real token to a public repo — keep this repo private,
  // or leave the token empty and set GITHUB_TOKEN in Vercel instead.
  GITHUB_TOKEN: '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',
  GITHUB_REPO: 't3rri-1/t3rribox',
  GITHUB_BRANCH: 'main',
  GITHUB_RAW_VIA_API: false,

  // ---- Site ----
  SITE_URL: 'https://t3rribox.vercel.app',

  // ---- Upload limits ----
  MAX_UPLOAD_MB: 20,
  EXTRA_BLOCKED_EXTENSIONS: '',
  INDEX_FILES: false,

  // ---- Google Search Console (use one) ----
  GOOGLE_SITE_VERIFICATION: '',
  GOOGLE_VERIFICATION_FILE: '',
};

// Env var wins, then the setting above, then ''.
export function setting(key) {
  const fromEnv = process.env[key];
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  const value = settings[key];
  return value === undefined || value === null ? '' : String(value);
}

export default settings;
