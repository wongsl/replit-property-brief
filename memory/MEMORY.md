# Property Brief - Project Memory

## Architecture
- **Frontend**: React 19 + Vite + TypeScript + TailwindCSS, rooted at `client/`
- **Gateway**: Express.js (`server/`) — proxies `/api/*` to Django on port 8000
- **Backend**: Django REST Framework (`backend/`) — PostgreSQL (managed by Django ORM)
- **AI**: Perplexity `sonar-pro` model for document analysis
- **Storage**: AWS S3 or local (`server/replit_integrations/object_storage/`)

## Key Files
- `backend/documents/models.py` — all Django models (User, Document, CombinedAnalysis, etc.)
- `backend/documents/views.py` — all API views (DocumentViewSet, share_view, etc.)
- `backend/documents/urls.py` — URL routing (includes router + explicit paths)
- `backend/property_brief/urls.py` — Django root URLs: `path('api/', include('documents.urls'))`
- `server/routes.ts` — Express proxy setup; rewrites `/api/X` → Django `/api/X`
- `client/src/pages/dashboard-page.tsx` — main UI (~2400 lines), AnalysisReport component inside
- `client/src/App.tsx` — React router (wouter)

## Testing Setup
- **Backend**: Django built-in test runner + SQLite in-memory — **112 tests**
  - Run: `npm run test:backend` (must run from project root, not `cd backend`)
  - Settings: `backend/property_brief/test_settings.py` (SQLite `:memory:`)
  - Tests: `backend/documents/tests.py` — covers auth, folders, docs, teams, admin, credits, cache utils, middleware, exception handler, auth backend, permissions, share, combined analysis
- **Frontend**: Vitest + @testing-library/react + jsdom — **78 tests**
  - Run: `npm test`
  - Config: `vitest.config.ts` at root; setup: `client/src/test/setup.ts`
  - Test files: `lib/utils.test.ts`, `lib/queryClient.test.ts`, `lib/mock-auth.test.tsx`, `hooks/use-mobile.test.tsx`, `hooks/use-toast.test.ts`, `pages/not-found.test.tsx`, `pages/auth-page.test.tsx`, `pages/shared-analysis-page.test.tsx`

## Shareable Analysis Links Feature (added)
- `Document.share_token` — UUIDField, null/unique, generated lazily on demand
- `POST /api/documents/:id/share/` — generates token, returns `{share_token}`; requires auth + ownership
- `GET /api/share/<uuid:token>/` — public (AllowAny), returns `{name, ai_analysis}` only
- Frontend route `/share/:token` → `client/src/pages/shared-analysis-page.tsx` (no auth required)
- Share button in AnalysisReport (dashboard-page.tsx) calls the share endpoint and copies URL

## Patterns
- jsdom clipboard mock: define in setup.ts with `Object.defineProperty(navigator, 'clipboard', {value: {writeText: vi.fn()}, configurable: true})`
- Django proxy auth: Express proxies all `/api/*` to Django; auth is handled by Django session cookies
- Cache invalidation: `invalidate_docs()` / `invalidate_user()` called after writes
