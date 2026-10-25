-- =====================================================================
-- NeoM 004 — AI / 计费 / 管理后台 补充（server-ai-admin 拥有）
--
-- 目的：本文件只做「增量补齐」，不新建主表、不改 001/002/003。
--   · 001_schema.sql 已包含全部 AI/计费/后台表，因此这里的 CREATE 全部是
--     IF NOT EXISTS，作为「001 未执行时」的兜底，正常部署下不会产生任何变更。
--   · 索引/列补齐一律先查 information_schema，再动态执行 DDL
--     （MySQL 8 不支持 ALTER TABLE ... ADD COLUMN IF NOT EXISTS）。
--   · 可重复执行（幂等）。
--
-- 执行： mysql -h <host> -u NeoM -p neom < 004_ai_admin_patch.sql
-- =====================================================================
SET NAMES utf8mb4;
SET @db := DATABASE();

-- ---------------------------------------------------------------------
-- 0. 兜底建表（001 已建则为 no-op）
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
  KEY idx_ai_usage_user (user_id, created_at),
  KEY idx_ai_usage_model (model, created_at),
  KEY idx_ai_usage_scene (scene, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
-- 1. 缺失索引补齐（先探测，再动态 DDL；已存在则跳过）
--
-- 注意：这里刻意不用 DELIMITER / CREATE PROCEDURE —— 那只是 mysql 命令行
-- 客户端的指令，通过驱动（mysql2 等）执行会直接语法报错。改用
-- SET @var := ... + PREPARE/EXECUTE，纯语句形式，CLI 与驱动都可用。
-- ---------------------------------------------------------------------
-- ai_usage_logs
SET @has := (SELECT COUNT(*) FROM information_schema.statistics
              WHERE table_schema = @db AND table_name = 'ai_usage_logs' AND index_name = 'idx_ai_usage_user');
SET @ddl := IF(@has = 0, 'ALTER TABLE `ai_usage_logs` ADD INDEX `idx_ai_usage_user` (`user_id`,`created_at`)', 'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @has := (SELECT COUNT(*) FROM information_schema.statistics
              WHERE table_schema = @db AND table_name = 'ai_usage_logs' AND index_name = 'idx_ai_usage_model');
SET @ddl := IF(@has = 0, 'ALTER TABLE `ai_usage_logs` ADD INDEX `idx_ai_usage_model` (`model`,`created_at`)', 'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @has := (SELECT COUNT(*) FROM information_schema.statistics
              WHERE table_schema = @db AND table_name = 'ai_usage_logs' AND index_name = 'idx_ai_usage_scene');
SET @ddl := IF(@has = 0, 'ALTER TABLE `ai_usage_logs` ADD INDEX `idx_ai_usage_scene` (`scene`,`created_at`)', 'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @has := (SELECT COUNT(*) FROM information_schema.statistics
              WHERE table_schema = @db AND table_name = 'ai_usage_logs' AND index_name = 'idx_ai_usage_status');
SET @ddl := IF(@has = 0, 'ALTER TABLE `ai_usage_logs` ADD INDEX `idx_ai_usage_status` (`status`,`created_at`)', 'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- point_ledger
SET @has := (SELECT COUNT(*) FROM information_schema.statistics
              WHERE table_schema = @db AND table_name = 'point_ledger' AND index_name = 'idx_ledger_user');
SET @ddl := IF(@has = 0, 'ALTER TABLE `point_ledger` ADD INDEX `idx_ledger_user` (`user_id`,`created_at`)', 'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @has := (SELECT COUNT(*) FROM information_schema.statistics
              WHERE table_schema = @db AND table_name = 'point_ledger' AND index_name = 'idx_ledger_kind');
SET @ddl := IF(@has = 0, 'ALTER TABLE `point_ledger` ADD INDEX `idx_ledger_kind` (`kind`,`created_at`)', 'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @has := (SELECT COUNT(*) FROM information_schema.statistics
              WHERE table_schema = @db AND table_name = 'point_ledger' AND index_name = 'idx_ledger_ref');
SET @ddl := IF(@has = 0, 'ALTER TABLE `point_ledger` ADD INDEX `idx_ledger_ref` (`ref_id`)', 'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- ai_channels / ai_models
SET @has := (SELECT COUNT(*) FROM information_schema.statistics
              WHERE table_schema = @db AND table_name = 'ai_channels' AND index_name = 'idx_channels_provider');
SET @ddl := IF(@has = 0, 'ALTER TABLE `ai_channels` ADD INDEX `idx_channels_provider` (`provider_id`,`enabled`)', 'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @has := (SELECT COUNT(*) FROM information_schema.statistics
              WHERE table_schema = @db AND table_name = 'ai_models' AND index_name = 'idx_models_provider');
SET @ddl := IF(@has = 0, 'ALTER TABLE `ai_models` ADD INDEX `idx_models_provider` (`provider_id`,`enabled`)', 'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @has := (SELECT COUNT(*) FROM information_schema.statistics
              WHERE table_schema = @db AND table_name = 'ai_models' AND index_name = 'idx_models_category');
SET @ddl := IF(@has = 0, 'ALTER TABLE `ai_models` ADD INDEX `idx_models_category` (`category`,`enabled`)', 'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- recharge_orders / redeem_codes
SET @has := (SELECT COUNT(*) FROM information_schema.statistics
              WHERE table_schema = @db AND table_name = 'recharge_orders' AND index_name = 'idx_orders_user');
SET @ddl := IF(@has = 0, 'ALTER TABLE `recharge_orders` ADD INDEX `idx_orders_user` (`user_id`,`created_at`)', 'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @has := (SELECT COUNT(*) FROM information_schema.statistics
              WHERE table_schema = @db AND table_name = 'recharge_orders' AND index_name = 'idx_orders_status');
SET @ddl := IF(@has = 0, 'ALTER TABLE `recharge_orders` ADD INDEX `idx_orders_status` (`status`,`created_at`)', 'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @has := (SELECT COUNT(*) FROM information_schema.statistics
              WHERE table_schema = @db AND table_name = 'redeem_codes' AND index_name = 'idx_redeem_batch');
SET @ddl := IF(@has = 0, 'ALTER TABLE `redeem_codes` ADD INDEX `idx_redeem_batch` (`batch`)', 'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @has := (SELECT COUNT(*) FROM information_schema.statistics
              WHERE table_schema = @db AND table_name = 'redeem_codes' AND index_name = 'idx_redeem_status');
SET @ddl := IF(@has = 0, 'ALTER TABLE `redeem_codes` ADD INDEX `idx_redeem_status` (`status`)', 'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- admin_audit
SET @has := (SELECT COUNT(*) FROM information_schema.statistics
              WHERE table_schema = @db AND table_name = 'admin_audit' AND index_name = 'idx_audit_admin');
SET @ddl := IF(@has = 0, 'ALTER TABLE `admin_audit` ADD INDEX `idx_audit_admin` (`admin_id`,`created_at`)', 'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @has := (SELECT COUNT(*) FROM information_schema.statistics
              WHERE table_schema = @db AND table_name = 'admin_audit' AND index_name = 'idx_audit_action');
SET @ddl := IF(@has = 0, 'ALTER TABLE `admin_audit` ADD INDEX `idx_audit_action` (`action`,`created_at`)', 'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------
-- 2. 后台运行所需配置项（幂等；不覆盖运维已改过的值）
-- ---------------------------------------------------------------------
INSERT IGNORE INTO sys_settings (k, v) VALUES
  ('point_per_cny',          '100'),
  ('signin_points',          '100'),
  ('register_gift_points',   '100'),
  ('pay_enabled',            '0'),
  ('default_rpm_limit',      '60'),
  ('default_tpm_limit',      '200000'),
  ('plugin_allow_unsigned',  '0'),
  ('plugin_upload_max_mb',   '20'),
  ('ai_official_enabled',    '1');

-- ---------------------------------------------------------------------
-- 3. 计费口径自检（只读，输出当前模型的计费配置，便于核对价格）
-- ---------------------------------------------------------------------
SELECT id, label, category, billing,
       price_cache_in AS cache_in_cny_per_1m,
       price_in       AS in_cny_per_1m,
       price_out      AS out_cny_per_1m,
       price_audio_hour AS audio_cny_per_hour,
       price_call     AS call_cny,
       enabled
  FROM ai_models
 ORDER BY sort, id;

SELECT COUNT(*) AS channels,
       SUM(status = 'active') AS active_channels
  FROM ai_channels;

SELECT k, v FROM sys_settings
 WHERE k IN ('point_per_cny','signin_points','pay_enabled','ai_official_enabled','default_rpm_limit','default_tpm_limit')
 ORDER BY k;
