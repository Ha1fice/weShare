CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`node_id` text,
	`uploader_id` text NOT NULL,
	`original_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`sha256` text NOT NULL,
	`storage_key` text NOT NULL,
	`width` integer,
	`height` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`uploader_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attachments_storage_key_uq` ON `attachments` (`storage_key`);--> statement-breakpoint
CREATE INDEX `attachments_node_idx` ON `attachments` (`node_id`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` text NOT NULL,
	`actor_id` text,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`ip` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_events_ws_time_idx` ON `audit_events` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `document_contents` (
	`node_id` text PRIMARY KEY NOT NULL,
	`content_schema_version` integer DEFAULT 1 NOT NULL,
	`yjs_schema_version` integer DEFAULT 1 NOT NULL,
	`content_json` text,
	`yjs_state` blob,
	`state_vector` blob,
	`doc_size_bytes` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`text_preview` text,
	`char_count` integer DEFAULT 0 NOT NULL,
	`updated_by` text,
	`updated_at` integer NOT NULL,
	`stored_at` integer,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `node_acl` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`role` text NOT NULL,
	`effect` text DEFAULT 'allow' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `node_acl_subject_uq` ON `node_acl` (`node_id`,`subject_type`,`subject_id`);--> statement-breakpoint
CREATE INDEX `node_acl_subject_idx` ON `node_acl` (`subject_type`,`subject_id`);--> statement-breakpoint
CREATE TABLE `node_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`version_no` integer NOT NULL,
	`kind` text NOT NULL,
	`label` text,
	`content_schema_version` integer DEFAULT 1 NOT NULL,
	`yjs_schema_version` integer DEFAULT 1 NOT NULL,
	`content_json` text NOT NULL,
	`yjs_state` blob,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `node_versions_node_no_uq` ON `node_versions` (`node_id`,`version_no`);--> statement-breakpoint
CREATE INDEX `node_versions_node_idx` ON `node_versions` (`node_id`,`version_no`);--> statement-breakpoint
CREATE TABLE `nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`parent_id` text,
	`type` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`title_norm` text DEFAULT '' NOT NULL,
	`owner_id` text NOT NULL,
	`visibility` text DEFAULT 'workspace' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`deleted_by` text,
	`trash_root_id` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deleted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`trash_root_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `nodes_tree_idx` ON `nodes` (`workspace_id`,`parent_id`,`deleted_at`,`sort_order`);--> statement-breakpoint
CREATE INDEX `nodes_trash_idx` ON `nodes` (`workspace_id`,`deleted_at`) WHERE "nodes"."deleted_at" is not null;--> statement-breakpoint
CREATE INDEX `nodes_title_norm_idx` ON `nodes` (`title_norm`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` blob NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`user_agent` text,
	`ip` text,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_uq` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`display_name` text NOT NULL,
	`avatar_key` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_login_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_lower_uq` ON `users` (lower("email"));--> statement-breakpoint
CREATE TABLE `workspace_members` (
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `user_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workspace_members_user_idx` ON `workspace_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`owner_id` text NOT NULL,
	`default_role` text DEFAULT 'edit' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
