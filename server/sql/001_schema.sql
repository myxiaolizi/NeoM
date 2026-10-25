-- =====================================================================
-- NeoM schema 鈥?MySQL 8 / utf8mb4
-- Run: mysql -h host -u NeoM -p neom < 001_schema.sql
-- Idempotent: every table uses CREATE TABLE IF NOT EXISTS.
-- =====================================================================
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------
-- 1. identity
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username          VARCHAR(64)  NOT NULL,
  email             VARCHAR(190) DEFAULT NULL,
  phone             VARCHAR(32)  DEFAULT NULL,
  password_hash     VARCHAR(255) NOT NULL,
  nickname          VARCHAR(64)  NOT NULL DEFAULT '',
  avatar            VARCHAR(500) DEFAULT NULL,
  role              ENUM('user','developer','admin') NOT NULL DEFAULT 'user',
  points            DECIMAL(14,4) NOT NULL DEFAULT 0.0000,
  status            ENUM('active','banned') NOT NULL DEFAULT 'active',
  storage_quota_mb  INT NOT NULL DEFAULT 5120,
  rpm_limit         INT NOT NULL DEFAULT 60,
  tpm_limit         INT NOT NULL DEFAULT 200000,
  ban_reason        VARCHAR(255) DEFAULT NULL,
  settings_json     JSON DEFAULT NULL,
  register_ip       VARCHAR(64) DEFAULT NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_login_at     DATETIME DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_users_username (username),
  UNIQUE KEY uk_users_email (email),
  KEY idx_users_phone (phone),
  KEY idx_users_status (status),
  KEY idx_users_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_sessions (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  device      VARCHAR(64)  NOT NULL DEFAULT '',
  ip          VARCHAR(64)  NOT NULL DEFAULT '',
  user_agent  VARCHAR(500) NOT NULL DEFAULT '',
  token_hash  CHAR(64)     NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME DEFAULT NULL,
  expires_at  DATETIME NOT NULL,
  revoked     TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_sessions_user (user_id, revoked),
  KEY idx_sessions_token (token_hash),
  KEY idx_sessions_exp (expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS login_logs (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED DEFAULT NULL,
  account    VARCHAR(190) NOT NULL DEFAULT '',
  kind       VARCHAR(24) NOT NULL DEFAULT 'login',  -- login|register|logout|fail|password
  ok         TINYINT(1) NOT NULL DEFAULT 1,
  ip         VARCHAR(64) NOT NULL DEFAULT '',
  user_agent VARCHAR(500) NOT NULL DEFAULT '',
  device     VARCHAR(64) NOT NULL DEFAULT '',
  msg        VARCHAR(255) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_login_user (user_id, created_at),
  KEY idx_login_ip (ip, created_at),
  KEY idx_login_kind (kind, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_audit (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  admin_id   BIGINT UNSIGNED DEFAULT NULL,
  action     VARCHAR(64) NOT NULL DEFAULT '',
  target     VARCHAR(190) NOT NULL DEFAULT '',
  detail     JSON DEFAULT NULL,
  ip         VARCHAR(64) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_admin (admin_id, created_at),
  KEY idx_audit_action (action, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 2. vaults + files (DB is an index only; content lives in OSS/S3)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vaults (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED NOT NULL,
  name       VARCHAR(128) NOT NULL DEFAULT 'default',
  kind       ENUM('local','cloud') NOT NULL DEFAULT 'cloud',
  path       VARCHAR(500) DEFAULT NULL,
  meta_json  JSON DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_vault_user_name (user_id, name),
  CONSTRAINT fk_vault_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS files (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED NOT NULL,
  vault_id   BIGINT UNSIGNED DEFAULT NULL,
  path       VARCHAR(512) NOT NULL,
  name       VARCHAR(255)  NOT NULL,
  parent     VARCHAR(512) NOT NULL DEFAULT '',
  is_dir     TINYINT(1) NOT NULL DEFAULT 0,
  size       BIGINT NOT NULL DEFAULT 0,
  etag       CHAR(32) DEFAULT NULL,
  mtime      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ctime      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `order`    INT NOT NULL DEFAULT 0,
  deleted    TINYINT(1) NOT NULL DEFAULT 0,
  deleted_at DATETIME DEFAULT NULL,
  oss_key    VARCHAR(1200) DEFAULT NULL,
  starred    TINYINT(1) NOT NULL DEFAULT 0,
  tags       VARCHAR(500) DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_files_user_path (user_id, path),
  KEY idx_files_user_parent (user_id, parent, deleted),
  KEY idx_files_user_mtime (user_id, mtime),
  KEY idx_files_deleted (deleted, deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS file_versions (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED NOT NULL,
  path       VARCHAR(512) NOT NULL,
  version    INT NOT NULL DEFAULT 1,
  content    LONGTEXT,
  size       INT NOT NULL DEFAULT 0,
  reason     ENUM('save','auto','restore','snapshot','import') NOT NULL DEFAULT 'save',
  device     VARCHAR(64) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_versions_user_path (user_id, path, id),
  KEY idx_versions_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- recycle bin: full snapshot of a deleted path (single file or whole dir)
CREATE TABLE IF NOT EXISTS file_snapshots (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED NOT NULL,
  path       VARCHAR(512) NOT NULL,
  name       VARCHAR(255) NOT NULL DEFAULT '',
  kind       ENUM('file','dir') NOT NULL DEFAULT 'file',
  size       BIGINT NOT NULL DEFAULT 0,
  etag       CHAR(32) DEFAULT NULL,
  payload    JSON DEFAULT NULL,       -- {files:[{path,content}]} for dir, {content} for file
  oss_key    VARCHAR(1200) DEFAULT NULL,
  reason     VARCHAR(64) NOT NULL DEFAULT 'delete',
  restored   TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_snap_user (user_id, created_at),
  KEY idx_snap_path (user_id, path)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 3. share / publish
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS share_links (
  id         VARCHAR(32) NOT NULL,
  user_id    BIGINT UNSIGNED NOT NULL,
  path       VARCHAR(512) NOT NULL,
  doc_name   VARCHAR(255) NOT NULL DEFAULT '',
  mode       ENUM('read','comment','edit') NOT NULL DEFAULT 'read',
  password   VARCHAR(255) DEFAULT NULL,
  expires_at DATETIME DEFAULT NULL,
  views      INT NOT NULL DEFAULT 0,
  status     ENUM('active','blocked','expired') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_share_user (user_id, created_at),
  KEY idx_share_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS share_comments (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  share_id   VARCHAR(32) NOT NULL,
  author     VARCHAR(64) NOT NULL DEFAULT '鍖垮悕',
  content    VARCHAR(2000) NOT NULL,
  anchor     VARCHAR(255) DEFAULT NULL,
  ip         VARCHAR(64) NOT NULL DEFAULT '',
  status     ENUM('visible','hidden','pending') NOT NULL DEFAULT 'visible',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_comments_share (share_id, created_at),
  KEY idx_comments_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS publish_pages (
  id         VARCHAR(32) NOT NULL,
  user_id    BIGINT UNSIGNED NOT NULL,
  path       VARCHAR(512) NOT NULL,
  doc_name   VARCHAR(255) NOT NULL DEFAULT '',
  encrypted  TINYINT(1) NOT NULL DEFAULT 0,
  password   VARCHAR(255) DEFAULT NULL,
  views      INT NOT NULL DEFAULT 0,
  status     ENUM('active','blocked') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_publish_user (user_id, created_at),
  KEY idx_publish_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 4. AI providers / channels / models / settings / usage
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_providers (
  id                  VARCHAR(48) NOT NULL,
  name                VARCHAR(96) NOT NULL,
  kind                VARCHAR(32) NOT NULL DEFAULT 'openai-compatible',
  base_url_chat       VARCHAR(255) DEFAULT NULL,
  base_url_responses  VARCHAR(255) DEFAULT NULL,
  base_url_anthropic  VARCHAR(255) DEFAULT NULL,
  api_doc_url         VARCHAR(255) DEFAULT NULL,
  needs_key           TINYINT(1) NOT NULL DEFAULT 1,
  builtin             TINYINT(1) NOT NULL DEFAULT 1,
  enabled             TINYINT(1) NOT NULL DEFAULT 1,
  sort                INT NOT NULL DEFAULT 0,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_channels (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  provider_id  VARCHAR(48) NOT NULL,
  name         VARCHAR(96) NOT NULL DEFAULT 'default',
  api_key_enc  TEXT,
  api_key_mask VARCHAR(64) DEFAULT NULL,
  base_url     VARCHAR(255) DEFAULT NULL,
  weight       INT NOT NULL DEFAULT 1,
  enabled      TINYINT(1) NOT NULL DEFAULT 1,
  status       ENUM('active','disabled','error') NOT NULL DEFAULT 'active',
  fail_count   INT NOT NULL DEFAULT 0,
  last_error   VARCHAR(500) DEFAULT NULL,
  last_used_at DATETIME DEFAULT NULL,
  last_ok_at   DATETIME DEFAULT NULL,
  models_json  JSON DEFAULT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_channels_provider (provider_id, enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_models (
  id              VARCHAR(64) NOT NULL,
  provider_id     VARCHAR(48) NOT NULL,
  label           VARCHAR(96) NOT NULL,
  category        ENUM('text','omni','reasoning','asr','tts','voiceclone') NOT NULL DEFAULT 'text',
  context_window  INT NOT NULL DEFAULT 8192,
  max_output      INT NOT NULL DEFAULT 4096,
  rpm             INT NOT NULL DEFAULT 100,
  tpm             INT NOT NULL DEFAULT 10000000,
  billing         ENUM('token','audio','call','free') NOT NULL DEFAULT 'token',
  price_cache_in  DECIMAL(12,4) NOT NULL DEFAULT 0,
  price_in        DECIMAL(12,4) NOT NULL DEFAULT 0,
  price_out       DECIMAL(12,4) NOT NULL DEFAULT 0,
  price_audio_hour DECIMAL(12,4) NOT NULL DEFAULT 0,
  price_call      DECIMAL(12,4) NOT NULL DEFAULT 0,
  free_until      DATETIME DEFAULT NULL,
  recommended_for VARCHAR(255) DEFAULT NULL,
  tag             VARCHAR(32) DEFAULT NULL,
  enabled         TINYINT(1) NOT NULL DEFAULT 1,
  sort            INT NOT NULL DEFAULT 0,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_models_provider (provider_id, enabled),
  KEY idx_models_category (category, enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_settings (
  user_id        BIGINT UNSIGNED NOT NULL,
  mode           ENUM('official','custom') NOT NULL DEFAULT 'official',
  provider_id    VARCHAR(48) NOT NULL DEFAULT 'mimo',
  api_key_enc    TEXT,
  base_url       VARCHAR(255) DEFAULT NULL,
  enabled_models JSON DEFAULT NULL,
  defaults_json  JSON DEFAULT NULL,
  tts_voice      VARCHAR(64) DEFAULT NULL,
  temperature    DECIMAL(3,2) DEFAULT NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_usage_logs (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id           BIGINT UNSIGNED NOT NULL,
  channel_id        BIGINT UNSIGNED DEFAULT NULL,
  provider_id       VARCHAR(48) DEFAULT NULL,
  model             VARCHAR(64) NOT NULL DEFAULT '',
  scene             VARCHAR(32) NOT NULL DEFAULT 'chat',
  mode              VARCHAR(16) NOT NULL DEFAULT 'official',
  prompt_tokens     INT NOT NULL DEFAULT 0,
  cached_tokens     INT NOT NULL DEFAULT 0,
  completion_tokens INT NOT NULL DEFAULT 0,
  audio_seconds     DECIMAL(10,2) NOT NULL DEFAULT 0,
  points_cost       DECIMAL(12,4) NOT NULL DEFAULT 0,
  cny_cost          DECIMAL(12,6) NOT NULL DEFAULT 0,
  latency_ms        INT NOT NULL DEFAULT 0,
  status            VARCHAR(16) NOT NULL DEFAULT 'ok',
  error             VARCHAR(500) DEFAULT NULL,
  ip                VARCHAR(64) DEFAULT NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_usage_user (user_id, created_at),
  KEY idx_usage_model (model, created_at),
  KEY idx_usage_scene (scene, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 5. points / billing
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS point_ledger (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id           BIGINT UNSIGNED NOT NULL,
  kind              VARCHAR(24) NOT NULL DEFAULT 'ai',
  points            DECIMAL(12,4) NOT NULL DEFAULT 0,
  balance_after     DECIMAL(14,4) NOT NULL DEFAULT 0,
  model             VARCHAR(64) DEFAULT NULL,
  prompt_tokens     INT NOT NULL DEFAULT 0,
  cached_tokens     INT NOT NULL DEFAULT 0,
  completion_tokens INT NOT NULL DEFAULT 0,
  audio_seconds     DECIMAL(10,2) NOT NULL DEFAULT 0,
  note              VARCHAR(500) DEFAULT NULL,
  ref_id            VARCHAR(64) DEFAULT NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ledger_user (user_id, created_at),
  KEY idx_ledger_kind (kind, created_at),
  KEY idx_ledger_ref (ref_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recharge_packages (
  id       VARCHAR(40) NOT NULL,
  name     VARCHAR(96) NOT NULL,
  price    DECIMAL(10,2) NOT NULL DEFAULT 0,
  points   DECIMAL(12,4) NOT NULL DEFAULT 0,
  bonus    DECIMAL(12,4) NOT NULL DEFAULT 0,
  tag      VARCHAR(32) DEFAULT NULL,
  enabled  TINYINT(1) NOT NULL DEFAULT 1,
  sort     INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recharge_orders (
  id         VARCHAR(40) NOT NULL,
  user_id    BIGINT UNSIGNED NOT NULL,
  package_id VARCHAR(40) DEFAULT NULL,
  amount     DECIMAL(10,2) NOT NULL DEFAULT 0,
  points     DECIMAL(12,4) NOT NULL DEFAULT 0,
  bonus      DECIMAL(12,4) NOT NULL DEFAULT 0,
  channel    VARCHAR(24) NOT NULL DEFAULT 'manual',
  pay_url    VARCHAR(500) DEFAULT NULL,
  trade_no   VARCHAR(80) DEFAULT NULL,
  status     ENUM('pending','paid','cancelled','refunded') NOT NULL DEFAULT 'pending',
  paid_at    DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_orders_user (user_id, created_at),
  KEY idx_orders_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS redeem_codes (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code       VARCHAR(64) NOT NULL,
  points     DECIMAL(12,4) NOT NULL DEFAULT 0,
  batch      VARCHAR(40) DEFAULT NULL,
  batch_note VARCHAR(255) DEFAULT NULL,
  status     ENUM('unused','used','void') NOT NULL DEFAULT 'unused',
  used_by    BIGINT UNSIGNED DEFAULT NULL,
  used_at    DATETIME DEFAULT NULL,
  created_by BIGINT UNSIGNED DEFAULT NULL,
  expires_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_redeem_code (code),
  KEY idx_redeem_batch (batch),
  KEY idx_redeem_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 6. plugins
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plugins (
  id              VARCHAR(64) NOT NULL,
  name            VARCHAR(96) NOT NULL,
  version         VARCHAR(32) NOT NULL DEFAULT '1.0.0',
  description     TEXT,
  author          VARCHAR(96) NOT NULL DEFAULT '',
  category        VARCHAR(32) NOT NULL DEFAULT 'productivity',
  icon            VARCHAR(96) NOT NULL DEFAULT '',
  builtin         TINYINT(1) NOT NULL DEFAULT 0,
  manifest_json   JSON DEFAULT NULL,
  package_key     VARCHAR(500) DEFAULT NULL,
  status          ENUM('published','pending','rejected','offline') NOT NULL DEFAULT 'published',
  downloads       INT NOT NULL DEFAULT 0,
  rating          DECIMAL(3,2) NOT NULL DEFAULT 5.00,
  default_enabled TINYINT(1) NOT NULL DEFAULT 0,
  sort            INT NOT NULL DEFAULT 0,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_plugins_status (status, category),
  KEY idx_plugins_builtin (builtin)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS plugin_versions (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  plugin_id   VARCHAR(64) NOT NULL,
  version     VARCHAR(32) NOT NULL,
  changelog   TEXT,
  package_key VARCHAR(500) DEFAULT NULL,
  status      ENUM('published','pending','rejected','offline') NOT NULL DEFAULT 'published',
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_plugin_version (plugin_id, version),
  KEY idx_pv_plugin (plugin_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_plugins (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      BIGINT UNSIGNED NOT NULL,
  plugin_id    VARCHAR(64) NOT NULL,
  version      VARCHAR(32) NOT NULL DEFAULT '1.0.0',
  enabled      TINYINT(1) NOT NULL DEFAULT 1,
  source       ENUM('builtin','store','uploaded') NOT NULL DEFAULT 'builtin',
  installed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_user_plugin (user_id, plugin_id),
  KEY idx_up_user (user_id, enabled),
  CONSTRAINT fk_up_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 7. releases / site / storage / system
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS releases (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  platform     VARCHAR(24) NOT NULL,   -- win-x64|win-green|mac-arm64|mac-x64|android|ios|linux-x64
  version      VARCHAR(32) NOT NULL,
  filename     VARCHAR(255) NOT NULL,
  size         BIGINT NOT NULL DEFAULT 0,
  oss_key      VARCHAR(1200) DEFAULT NULL,
  url          VARCHAR(1200) NOT NULL DEFAULT '',
  sha256       CHAR(64) DEFAULT NULL,
  changelog    TEXT,
  forced       TINYINT(1) NOT NULL DEFAULT 0,
  channel      ENUM('stable','beta') NOT NULL DEFAULT 'stable',
  downloads    INT NOT NULL DEFAULT 0,
  published_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_release (platform, version, channel),
  KEY idx_release_platform (platform, channel, published_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS site_config (
  k          VARCHAR(64) NOT NULL,
  v          TEXT,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (k)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS site_docs (
  k          VARCHAR(64) NOT NULL,
  title      VARCHAR(190) NOT NULL DEFAULT '',
  content    LONGTEXT,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (k)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS storage_configs (
  user_id       BIGINT UNSIGNED NOT NULL,
  vendor        VARCHAR(32) NOT NULL DEFAULT 'aliyun-oss',
  bucket        VARCHAR(190) DEFAULT NULL,
  endpoint      VARCHAR(190) DEFAULT NULL,
  region        VARCHAR(64) DEFAULT NULL,
  ak_enc        TEXT,
  sk_enc        TEXT,
  access_key_id VARCHAR(190) DEFAULT NULL,
  public_domain VARCHAR(255) DEFAULT NULL,
  prefix        VARCHAR(255) DEFAULT NULL,
  path_style    TINYINT(1) NOT NULL DEFAULT 0,
  test_ok       TINYINT(1) NOT NULL DEFAULT 0,
  test_at       DATETIME DEFAULT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sys_settings (
  k          VARCHAR(64) NOT NULL,
  v          TEXT,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (k)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sensitive_words (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  word       VARCHAR(96) NOT NULL,
  action     ENUM('block','replace') NOT NULL DEFAULT 'block',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_word (word)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rate_limits (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  scope      VARCHAR(64) NOT NULL,       -- e.g. share:comment
  `key`      VARCHAR(190) NOT NULL,      -- ip / user id
  hits       INT NOT NULL DEFAULT 0,
  window_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  blocked    TINYINT(1) NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_rl (scope, `key`, window_at),
  KEY idx_rl_scope (scope, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS backups (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED DEFAULT NULL,
  scope      VARCHAR(32) NOT NULL DEFAULT 'user', -- user|site|mysql
  name       VARCHAR(190) NOT NULL DEFAULT '',
  oss_key    VARCHAR(1200) DEFAULT NULL,
  size       BIGINT NOT NULL DEFAULT 0,
  status     ENUM('running','done','failed') NOT NULL DEFAULT 'done',
  msg        VARCHAR(500) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_backup_user (user_id, created_at),
  KEY idx_backup_scope (scope, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED DEFAULT NULL,   -- NULL = broadcast
  kind       VARCHAR(32) NOT NULL DEFAULT 'system',
  title      VARCHAR(190) NOT NULL DEFAULT '',
  content    TEXT,
  read_at    DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_notify_user (user_id, read_at, created_at),
  KEY idx_notify_kind (kind, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

