import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { z } from "zod";

export type User = { id: string; username: string; password: string };
export type InsertUser = { username: string; password: string };

export const insertUserSchema = z.object({
  username: z.string(),
  password: z.string(),
});

export const uploads = pgTable("uploads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  objectPath: text("object_path").notNull(),
  originalName: text("original_name").notNull(),
  contentType: text("content_type"),
  size: integer("size"),
  status: text("status", { enum: ["pending", "uploaded"] }).notNull().default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Upload = typeof uploads.$inferSelect;
export type InsertUpload = typeof uploads.$inferInsert;
