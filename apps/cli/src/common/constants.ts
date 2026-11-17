export const STATE_DIR = ".vaultsync";
export const IGNORE_FILE = ".vaultsyncignore";
export const KEYRING_SERVICE = "vault-sync";

export const MAX_BATCH_BYTES = 50 * 1024 * 1024;
export const UPLOAD_CONCURRENCY = 4;
export const MAX_HASH_ATTEMPTS = 3;

export const WATCH_DEBOUNCE_MS = 2000;
export const WATCH_MAX_BACKOFF_MS = 5 * 60_000;

export const HTTP_MAX_ATTEMPTS = 5;
export const HTTP_BASE_DELAY_MS = 500;
export const TMP_SUFFIX = ".vaultsync-tmp";
