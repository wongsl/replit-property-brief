# DocVault - Secure Document Management System

## Overview
Full-stack web application for secure document management featuring role-based access control, team-based sharing, AI-powered analysis, and comprehensive file organization.

## Architecture
- **Frontend**: React + Vite (port 5000), Tailwind CSS, shadcn/ui components, wouter routing
- **Backend**: Django REST Framework (port 8000), PostgreSQL database
- **Proxy**: Express server proxies `/api/*` and `/media/*` to Django backend
- **Auth**: Django session-based authentication via custom `SessionAuthentication` backend

## Project Structure
```
client/src/           - React frontend
  pages/              - auth-page, dashboard-page, explorer-page, admin-page
  components/         - nav-sidebar, UI components (shadcn)
  lib/mock-auth.tsx   - Auth context (now uses real Django API, name kept for compatibility)

backend/              - Django project
  docvault/           - Django settings, urls, wsgi
  documents/          - Models, views, serializers, auth_backend
    models.py         - User, Team, Folder, Tag, Document, DocumentPermission
    views.py          - REST API views for auth, documents, folders, admin
    serializers.py    - DRF serializers
    auth_backend.py   - Custom session authentication

server/               - Express server (proxies to Django)
  routes.ts           - Django proxy + auto-start Django
  index.ts            - Express setup, skip body parsing for /api routes
```

## Key Technical Decisions
- Express server spawns Django as a child process on startup
- Body parsing is skipped for `/api` and `/media` routes to allow proxy passthrough
- Django session cookies are used for authentication persistence
- CSRF middleware is disabled for API-first architecture
- DRF session auth uses custom backend that reads `user_id` from session

## API Endpoints
- `POST /api/auth/register/` - User registration
- `POST /api/auth/login/` - User login
- `POST /api/auth/logout/` - User logout
- `GET /api/auth/me/` - Current user info
- `GET /api/teams/` - List teams
- `GET/POST /api/documents/` - List/create documents
- `PATCH/DELETE /api/documents/:id/` - Update/delete document
- `POST /api/documents/:id/add_tag/` - Add tag
- `POST /api/documents/:id/remove_tag/` - Remove tag
- `POST /api/documents/:id/analyze/` - AI analysis (handled by Express, calls Perplexity)
- `POST /api/documents/:id/move/` - Move to folder
- `GET/POST /api/folders/` - List/create folders
- `POST /api/folders/reorder/` - Reorder folders
- `GET /api/admin/users/` - Admin: list users
- `PATCH /api/admin/users/:id/` - Admin: update user role
- `DELETE /api/admin/users/:id/delete/` - Admin: delete user (with optional file reassignment)

## Design
- Technical SaaS aesthetic with slate color palette
- Space Grotesk display font
- @dnd-kit for drag-and-drop file/folder management

## Caching
- **Backend**: Django LocMemCache with 5-minute TTL (300s), 1000 max entries
- **Cached endpoints**: documents (per-user + per-team), folders (per-user), teams (global, 10min TTL), user profile, admin users list (60s TTL)
- **Cache keys**: `docs:{user_id}:mine`, `docs:team:{team_id}`, `folders:{user_id}`, `teams:all`, `user:{user_id}`, `admin:users`
- **Invalidation**: All write operations (create/update/delete/move/tag/analyze/reorder) invalidate relevant keys
- **Team-scope**: Team document cache uses shared `docs:team:{team_id}` key so all team members see updates
- **Utility module**: `backend/documents/cache_utils.py` centralizes cache key generation and invalidation
- **Note**: LocMemCache is per-process; for multi-process production, switch to Redis

## File Storage
- **Cloud storage**: Replit Object Storage (Google Cloud Storage) via presigned URL upload flow
- **Upload flow**: Frontend requests presigned URL from Express (`/api/uploads/request-url`) → uploads file directly to cloud → creates document record in Django with `storage_path`
- **Download flow**: Files served via Express route `/objects/{*objectPath}` from cloud storage
- **Model field**: `Document.storage_path` stores cloud object path (e.g., `/objects/uploads/<uuid>`)
- **Express routes**: `/api/uploads/*` handled by Express directly (not proxied to Django); body parsing enabled for these routes

## AI Document Analysis
- **Provider**: Perplexity AI (sonar-pro model) via OpenAI-compatible API
- **Flow**: Express intercepts `/api/documents/:id/analyze/` → downloads file from cloud storage → extracts text (pdf-parse for PDFs) → sends to Perplexity with real estate inspection prompt → parses JSON response → saves to Django via internal API
- **Prompt**: Hardcoded system prompt for real estate inspection report summarization
- **Response format**: Structured JSON with property info (address, city, county, zipcode), document_type classification, and nested summary (Roof, Electrical, Plumbing, Permits, Foundation, Pest Inspection, HVAC, Additional Notes)
- **Storage**: `Document.ai_analysis` is a JSONField storing the full structured response
- **Express route**: `server/analyze.ts` - registered before Django proxy, body parsing enabled
- **Frontend**: `AnalysisReport` component renders structured inspection data with sections for each category

## Nested Folder Structure
- **Model**: `Folder.parent` is a self-referencing ForeignKey enabling unlimited nesting
- **Hierarchy**: Client > Property > Documents (recommended 3 levels max)
- **API**: `GET /api/folders/` returns root folders with nested `children` arrays; `POST /api/folders/` accepts optional `parent` field
- **Serializer**: `FolderSerializer` includes `parent`, `parent_name`, `full_path` (e.g., "Client / 535 Maple Ave"), and recursive `children`
- **Frontend**: `FolderTreeSection` component renders recursive tree with depth-based indentation, color-coded folder icons, and inline subfolder creation via `FolderPlus` button
- **Move-to-folder dropdown**: Shows flattened list of all folders with path indentation
- **Auto-categorization**: Address extraction searches across all nested folders (flattened) for matches

## Recent Changes
- Added nested folder structure with self-referencing parent field, recursive tree UI, and subfolder creation
- Added AI-powered document analysis using Perplexity API with structured JSON output for real estate inspection reports
- Changed `ai_analysis` model field from TextField to JSONField for structured data storage
- Admin user deletion with optional file reassignment
- Migrated document uploads from local server to Replit cloud blob storage
- Added in-memory caching layer with Django LocMemCache for read-heavy endpoints
- Connected React frontend to Django REST API (replaced mock data)
- Set up Express proxy to forward API calls to Django
- Implemented real authentication (register/login/logout/session)
- Admin page fetches and manages real users from the database
