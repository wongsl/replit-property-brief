# Property Brief

A full-stack application for managing, organizing, and AI-analyzing real estate inspection documents.

## Architecture

The app runs two backend services behind a single Express gateway:

```
Browser / Client (React + Vite)
        |
        | :3000
        v
Express Gateway (Node.js)
  ├── /api/uploads/*          — file upload & presigned URL handling
  ├── /api/documents/:id/analyze/  — PDF extraction + Perplexity AI analysis
  ├── /objects/*              — serve stored files
  └── /api/*, /media/*  ──proxy──> Django REST API (:8000)
                                    ├── auth (session-based)
                                    ├── documents & folders
                                    ├── teams & join requests
                                    ├── admin management
                                    └── credits
```

| Layer | Tech | Entry point |
|---|---|---|
| Frontend | React, Vite, Tailwind CSS | `client/` |
| Gateway | Express.js (TypeScript) | `server/index.ts` |
| API | Django REST Framework (Python) | `backend/` |
| Database | PostgreSQL (via `DATABASE_URL`) | Django ORM |
| File storage | AWS S3 or local disk | `server/replit_integrations/object_storage/` |
| Cache | Django in-memory (`locmem`) | `backend/documents/cache_utils.py` |

---

## Middleware

### Express (server/index.ts)

#### Request ID
Every request gets a UUID assigned as `X-Request-Id`. It is:
- Read from the incoming `X-Request-Id` header if the client sends one
- Set on the response as `X-Request-Id` so clients can correlate errors
- Forwarded to Django automatically via the proxy (no extra config needed)
- Threaded manually into the two internal `fetch()` calls in the analyze route

#### Request Logger
Logs one line per `/api/*` request:
```
12:00:00 PM [express] [abc-123] POST /api/documents/5/analyze/ 200 in 3421ms
```

#### Error Handler
All unhandled Express errors respond with:
```json
{ "error": "...", "requestId": "abc-123" }
```
This matches the `{ "error": "..." }` shape used by all inline route handlers and all Django views.

---

### Django (backend/)

#### Request Logging Middleware
`backend/documents/middleware.py` — `RequestLoggingMiddleware`

Logs one line per request to the `api` logger:
```
2026-02-24 12:00:00 [django] [abc-123] GET /api/documents/ 200 45ms user=7
```

The `requestId` matches the Express log line for the same request, enabling end-to-end tracing across both layers.

Registered last in `MIDDLEWARE` (after `SessionMiddleware` so `request.session` is available).

#### Custom DRF Exception Handler
`backend/documents/exceptions.py` — `custom_exception_handler`

Normalizes all DRF exception responses into a single shape:
```json
{ "error": "...", "requestId": "abc-123" }
```

Covers:
- `NotAuthenticated` → 401 (unauthenticated requests)
- `PermissionDenied` → 403 (role checks)
- `NotFound` → 404
- `ValidationError` → 400 (serializer field errors flattened to a single string)

Registered in `settings.py` as `REST_FRAMEWORK['EXCEPTION_HANDLER']`.

#### Permission Classes
`backend/documents/permissions.py`

| Class | Allows |
|---|---|
| `IsAdmin` | `role == "admin"` |
| `IsAdminOrTeamLeader` | `role in ("admin", "team_leader")` |

Used via `@permission_classes([IsAdmin])` on admin views. When access is denied, DRF raises `PermissionDenied` which the exception handler converts to `{ "error": "Admin only" }` with a 403 status.

---

## Authentication

Session-based. Login POSTs to `/api/auth/login/` and Django stores `user_id` in the database-backed session. All subsequent requests include the session cookie.

The Express gateway does not validate sessions — it forwards cookies to Django on proxied routes. The analyze route forwards cookies manually via `Cookie` and `X-Request-Id` headers on its internal `fetch()` calls.

Custom auth backend: `backend/documents/auth_backend.py`

---

## User Roles

| Role | Permissions |
|---|---|
| `admin` | Full access: user management, team management, credit grants, all documents |
| `team_leader` | Manage join requests for their own team |
| `user` | Own documents and folders, request to join a team, request credits |
| `viewer` | Read-only |

---

## Key Files

| File | Purpose |
|---|---|
| `server/index.ts` | Express entry: request ID middleware, logger, error handler |
| `server/analyze.ts` | PDF text extraction + Perplexity AI analysis |
| `server/routes.ts` | Django proxy setup |
| `server/replit_integrations/object_storage/` | S3 / local file storage |
| `backend/documents/views.py` | All Django API views |
| `backend/documents/middleware.py` | Django request logging middleware |
| `backend/documents/exceptions.py` | Custom DRF exception handler |
| `backend/documents/permissions.py` | Role-based permission classes |
| `backend/documents/auth_backend.py` | Custom session authentication |
| `backend/documents/cache_utils.py` | Cache key helpers and invalidation |
| `backend/property_brief/settings.py` | Django configuration |

---

## Running Locally

**Prerequisites:** Node.js, Python 3.11+, PostgreSQL (or set `DATABASE_URL`)

```bash
# Install Node dependencies
npm install

# Install Python dependencies
cd backend && pip install -r requirements.txt && cd ..

# Apply Django migrations
cd backend && python manage.py migrate && cd ..

# Start both servers (Express on :3000, Django on :8000)
npm run dev
```

### Creating an admin user

After running migrations, create your first admin user via the Django shell:

```bash
cd backend && python manage.py shell -c "
from documents.models import User
u = User.objects.create_user(username='yourname', password='yourpassword', role='admin', is_staff=True)
print(f'Created admin: {u.username}')
"
```

To change the password later:

```bash
cd backend && python manage.py changepassword yourname
```

Copy `.env.local.example` to `.env.local` and fill in:
- `DATABASE_URL` — PostgreSQL connection string
- `PERPLEXITY_API_KEY` — for document analysis
- `DJANGO_SECRET_KEY` — Django secret key
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` / `AWS_S3_BUCKET` — for S3 storage (or set `USE_LOCAL_STORAGE=true`)
