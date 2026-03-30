import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  integer,
  bigint,
  boolean,
  jsonb,
  serial,
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

// ── Django-managed tables declared here so drizzle-kit sees no diff ──────────
// These tables are owned by Django migrations. We declare them in the Drizzle
// schema so that drizzle-kit does not generate invalid "SET DATA TYPE serial"
// ALTER statements when it encounters their sequences during db:push.
// NEVER use these exports for schema management — Django owns the DDL.

export const featureFlags = pgTable("feature_flags", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  key: varchar("key", { length: 100 }).notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description").notNull(),
  enabled: boolean("enabled").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  updatedById: bigint("updated_by_id", { mode: "number" }),
  allowedRoles: jsonb("allowed_roles").notNull(),
});

export const featureFlagsAllowedUsers = pgTable("feature_flags_allowed_users", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  featureflagId: bigint("featureflag_id", { mode: "number" }).notNull(),
  userId: bigint("user_id", { mode: "number" }).notNull(),
});

export const combinedAnalysesFavoritedBy = pgTable("combined_analyses_favorited_by", {
  id: serial("id").primaryKey(),
  combinedanalysisId: integer("combinedanalysis_id").notNull(),
  userId: integer("user_id").notNull(),
});

export const foldersFavoritedBy = pgTable("folders_favorited_by", {
  id: serial("id").primaryKey(),
  folderId: integer("folder_id").notNull(),
  userId: integer("user_id").notNull(),
});
