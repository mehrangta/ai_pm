CREATE TABLE IF NOT EXISTS `kanban_board` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `kanban_board_user_id_idx` ON `kanban_board` (`user_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `kanban_column` (
	`id` text PRIMARY KEY NOT NULL,
	`board_id` text NOT NULL,
	`title` text NOT NULL,
	`color` text DEFAULT '#f4f4f5' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`board_id`) REFERENCES `kanban_board`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `kanban_column_board_id_idx` ON `kanban_column` (`board_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `kanban_card` (
	`id` text PRIMARY KEY NOT NULL,
	`column_id` text NOT NULL,
	`description` text NOT NULL,
	`color` text DEFAULT '#ffffff' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`column_id`) REFERENCES `kanban_column`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `kanban_card_column_id_idx` ON `kanban_card` (`column_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `kanban_card_image` (
	`card_id` text PRIMARY KEY NOT NULL,
	`data_url` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `kanban_card`(`id`) ON UPDATE no action ON DELETE cascade
);
