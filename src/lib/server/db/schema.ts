import { relations, sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { user } from './auth.schema';

export const task = sqliteTable('task', {
	id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
	title: text('title').notNull(),
	priority: integer('priority').notNull().default(1)
});

export const kanbanBoard = sqliteTable(
	'kanban_board',
	{
		id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		projectLocation: text('project_location').notNull().default(''),
		createdAt: integer('created_at', { mode: 'timestamp_ms' })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.$onUpdate(() => new Date())
			.notNull()
	},
	(table) => [index('kanban_board_user_id_idx').on(table.userId)]
);

export const kanbanColumn = sqliteTable(
	'kanban_column',
	{
		id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
		boardId: text('board_id')
			.notNull()
			.references(() => kanbanBoard.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		color: text('color').notNull().default('#f4f4f5'),
		position: integer('position').notNull().default(0),
		createdAt: integer('created_at', { mode: 'timestamp_ms' })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.$onUpdate(() => new Date())
			.notNull()
	},
	(table) => [index('kanban_column_board_id_idx').on(table.boardId)]
);

export const kanbanCard = sqliteTable(
	'kanban_card',
	{
		id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
		columnId: text('column_id')
			.notNull()
			.references(() => kanbanColumn.id, { onDelete: 'cascade' }),
		description: text('description').notNull(),
		color: text('color').notNull().default('#ffffff'),
		branchName: text('branch_name'),
		position: integer('position').notNull().default(0),
		createdAt: integer('created_at', { mode: 'timestamp_ms' })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.$onUpdate(() => new Date())
			.notNull()
	},
	(table) => [index('kanban_card_column_id_idx').on(table.columnId)]
);

export const kanbanCardImage = sqliteTable(
	'kanban_card_image',
	{
		cardId: text('card_id')
			.primaryKey()
			.references(() => kanbanCard.id, { onDelete: 'cascade' }),
		dataUrl: text('data_url').notNull(),
		mimeType: text('mime_type').notNull(),
		byteSize: integer('byte_size').notNull(),
		width: integer('width').notNull(),
		height: integer('height').notNull(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull()
	}
);

export const kanbanBoardRelations = relations(kanbanBoard, ({ one, many }) => ({
	user: one(user, {
		fields: [kanbanBoard.userId],
		references: [user.id]
	}),
	columns: many(kanbanColumn)
}));

export const kanbanColumnRelations = relations(kanbanColumn, ({ one, many }) => ({
	board: one(kanbanBoard, {
		fields: [kanbanColumn.boardId],
		references: [kanbanBoard.id]
	}),
	cards: many(kanbanCard)
}));

export const kanbanCardRelations = relations(kanbanCard, ({ one }) => ({
	column: one(kanbanColumn, {
		fields: [kanbanCard.columnId],
		references: [kanbanColumn.id]
	}),
	image: one(kanbanCardImage, {
		fields: [kanbanCard.id],
		references: [kanbanCardImage.cardId]
	})
}));

export const kanbanCardImageRelations = relations(kanbanCardImage, ({ one }) => ({
	card: one(kanbanCard, {
		fields: [kanbanCardImage.cardId],
		references: [kanbanCard.id]
	})
}));

export * from './auth.schema';
