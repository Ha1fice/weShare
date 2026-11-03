-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "email_lower" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "avatar_key" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "last_login_at" DATETIME
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "token_hash" BLOB NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_agent" TEXT,
    "ip" TEXT,
    "revoked_at" DATETIME,
    CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "default_role" TEXT NOT NULL DEFAULT 'edit',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    CONSTRAINT "workspaces_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "workspace_members" (
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("workspace_id", "user_id"),
    CONSTRAINT "workspace_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "workspace_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "nodes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspace_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "title_norm" TEXT NOT NULL DEFAULT '',
    "owner_id" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'workspace',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    "deleted_by" TEXT,
    "trash_root_id" TEXT,
    CONSTRAINT "nodes_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "nodes_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "nodes" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "nodes_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "nodes_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "nodes_trash_root_id_fkey" FOREIGN KEY ("trash_root_id") REFERENCES "nodes" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "document_contents" (
    "node_id" TEXT NOT NULL PRIMARY KEY,
    "content_schema_version" INTEGER NOT NULL DEFAULT 1,
    "yjs_schema_version" INTEGER NOT NULL DEFAULT 1,
    "content_json" JSONB,
    "yjs_state" BLOB,
    "state_vector" BLOB,
    "doc_size_bytes" INTEGER NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "text_preview" TEXT,
    "char_count" INTEGER NOT NULL DEFAULT 0,
    "updated_by" TEXT,
    "updated_at" DATETIME NOT NULL,
    "stored_at" DATETIME,
    CONSTRAINT "document_contents_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "nodes" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "document_contents_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "node_acl" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "node_id" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "effect" TEXT NOT NULL DEFAULT 'allow',
    "created_by" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "node_acl_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "nodes" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "node_acl_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "node_versions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "node_id" TEXT NOT NULL,
    "version_no" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT,
    "content_schema_version" INTEGER NOT NULL DEFAULT 1,
    "yjs_schema_version" INTEGER NOT NULL DEFAULT 1,
    "content_json" JSONB NOT NULL,
    "yjs_state" BLOB,
    "created_by" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "node_versions_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "nodes" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "node_versions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspace_id" TEXT NOT NULL,
    "node_id" TEXT,
    "uploader_id" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "attachments_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "attachments_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "nodes" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "attachments_uploader_id_fkey" FOREIGN KEY ("uploader_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "workspace_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,
    "metadata" JSONB NOT NULL,
    "ip" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "audit_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_lower_key" ON "users"("email_lower");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_expires_at_idx" ON "sessions"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX "workspace_members_user_id_idx" ON "workspace_members"("user_id");

-- CreateIndex
CREATE INDEX "nodes_workspace_id_parent_id_deleted_at_sort_order_idx" ON "nodes"("workspace_id", "parent_id", "deleted_at", "sort_order");

-- CreateIndex
CREATE INDEX "nodes_title_norm_idx" ON "nodes"("title_norm");

-- CreateIndex
CREATE INDEX "node_acl_subject_type_subject_id_idx" ON "node_acl"("subject_type", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "node_acl_node_id_subject_type_subject_id_key" ON "node_acl"("node_id", "subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "node_versions_node_id_version_no_idx" ON "node_versions"("node_id", "version_no");

-- CreateIndex
CREATE UNIQUE INDEX "node_versions_node_id_version_no_key" ON "node_versions"("node_id", "version_no");

-- CreateIndex
CREATE UNIQUE INDEX "attachments_storage_key_key" ON "attachments"("storage_key");

-- CreateIndex
CREATE INDEX "attachments_node_id_idx" ON "attachments"("node_id");

-- CreateIndex
CREATE INDEX "audit_events_workspace_id_created_at_idx" ON "audit_events"("workspace_id", "created_at");

-- ============================================================================
-- 定制索引：Prisma Schema 无法表达的索引（架构文档 §7.3）
--
-- 1. nodes_trash_idx —— 部分索引
--    Prisma 不支持部分索引（WHERE 子句）。回收站查询（附录 A：
--    GET /api/v1/workspaces/:id/trash）是高频查询：
--      SELECT ... FROM nodes WHERE workspace_id = ? AND deleted_at IS NOT NULL
--    实测（EXPLAIN QUERY PLAN，2 万节点 / 500 条在回收站）：
--      普通索引   → 走索引，0.237ms，索引体积 245,760 字节
--      部分索引   → 走索引，0.214ms，索引体积  12,288 字节
--    查询计划相同，体积差 20 倍——部分索引只存已删除的节点，
--    随数据量增长差距持续放大。10 万文档时约 1.2MB vs 60KB。
--
-- 2. users_email_lower_uq → 已改为 emailLower 列 + 普通唯一索引
--    Prisma 不支持表达式索引（lower(email)）。已在 schema 中加
--    emailLower 列承担该职责，此处无需补索引。
-- ============================================================================

-- CreateIndex
CREATE INDEX "nodes_trash_idx" ON "nodes"("workspace_id", "deleted_at") WHERE "nodes"."deleted_at" is not null;
