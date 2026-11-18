export const STATE_DIR = ".vaultsync";
export const PLUGIN_DIR = ".obsidian/plugins/vault-sync-cloudflare";
export const LEGACY_PLUGIN_DIR = ".obsidian/plugins/vault-sync";
export const TMP_SUFFIX = ".vaultsync-tmp";

export const MAX_BATCH_BYTES = 50 * 1024 * 1024;
export const UPLOAD_CONCURRENCY = 4;
export const CHANGES_PAGE = 500;
export const MAX_CONFLICT_COPIES = 100;

export const WATCH_DEBOUNCE_MS = 2000;
export const WATCH_MAX_BACKOFF_MS = 5 * 60_000;
export const REMOTE_CHANGE_DEBOUNCE_MS = 500;

export const HTTP_MAX_ATTEMPTS = 5;
export const HTTP_BASE_DELAY_MS = 500;

export const LIVE_PING_MS = 30_000;
export const LIVE_MAX_BACKOFF_MS = 5 * 60_000;
