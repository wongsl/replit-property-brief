import { defineConfig } from "drizzle-kit";

// Schema is fully managed by Django migrations + run_migrations.py.
// Drizzle-kit must not run push/migrate against the production database:
// drizzle-kit 0.31.x generates invalid PostgreSQL syntax
// ("SET DATA TYPE serial") when it encounters Django-managed identity
// columns, which breaks every deployment.
//
// Exiting here ensures drizzle-kit is a no-op regardless of whether it is
// called via `npm run db:push` or invoked directly (e.g. npx drizzle-kit push).
// The app itself imports from shared/schema.ts directly and is not affected.
process.exit(0);

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  tablesFilter: [
    "uploads",
    "feature_flags",
    "feature_flags_allowed_users",
    "combined_analyses_favorited_by",
    "folders_favorited_by",
  ],
});
