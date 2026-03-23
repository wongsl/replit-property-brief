import express, { type Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// Request ID middleware — must be first so all downstream handlers and logs can use it
app.use((req, res, next) => {
  const requestId = (req.headers["x-request-id"] as string) || randomUUID();
  req.headers["x-request-id"] = requestId; // forwarded to Django by the proxy automatically
  res.setHeader("X-Request-Id", requestId);
  (req as any).requestId = requestId;
  next();
});

app.use((req, res, next) => {
  const isExpressHandled = req.path.startsWith('/api/uploads') || req.path.match(/^\/api\/documents\/\d+\/analyze\/?$/) || req.path.match(/^\/api\/documents\/\d+\/draft-email\/?$/) || req.path.match(/^\/api\/folders\/\d+\/combined-analysis\/?$/) || req.path === '/api/screen-files/';
  const skip = (req.path.startsWith('/api') || req.path.startsWith('/media')) && !isExpressHandled;
  if (skip) {
    return next();
  }
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })(req, res, next);
});

app.use((req, res, next) => {
  const isExpressHandled = req.path.startsWith('/api/uploads') || req.path.match(/^\/api\/documents\/\d+\/analyze\/?$/) || req.path.match(/^\/api\/documents\/\d+\/draft-email\/?$/) || req.path.match(/^\/api\/folders\/\d+\/combined-analysis\/?$/) || req.path === '/api/screen-files/';
  const skip = (req.path.startsWith('/api') || req.path.startsWith('/media')) && !isExpressHandled;
  if (skip) {
    return next();
  }
  express.urlencoded({ extended: false })(req, res, next);
});

export function log(message: string, source = "express") {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level: "info", source, message }));
}

// Fetch user info for Express-handled API routes so it's available for logging
app.use(async (req, _res, next) => {
  const isExpressHandled = req.path.startsWith('/api/uploads') || req.path.match(/^\/api\/documents\/\d+\/analyze\/?$/) || req.path.match(/^\/api\/documents\/\d+\/draft-email\/?$/) || req.path.match(/^\/api\/folders\/\d+\/combined-analysis\/?$/) || req.path === '/api/screen-files/';
  if (isExpressHandled && req.headers.cookie) {
    try {
      const meRes = await fetch("http://127.0.0.1:8000/api/me/", {
        headers: { Cookie: req.headers.cookie },
      });
      if (meRes.ok) {
        const user = await meRes.json() as { id: number; username: string };
        (req as any).userInfo = { id: user.id, username: user.username };
      }
    } catch {
      // ignore — user info is best-effort for logging
    }
  }
  next();
});

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      const requestId = (req as any).requestId ?? "-";
      const userInfo = (req as any).userInfo;
      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        source: "express",
        event: "request",
        request_id: requestId,
        method: req.method,
        path,
        status_code: res.statusCode,
        duration_ms: duration,
        user_id: userInfo?.id ?? null,
        username: userInfo?.username ?? null,
      }));
    }
  });

  next();
});

(async () => {
  // ALB health check endpoint — must be registered before routes
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  await registerRoutes(httpServer, app);
  

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    const requestId = (_req as any).requestId ?? "-";

    const userInfo = (_req as any).userInfo;
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      source: "express",
      event: err.name ?? "InternalServerError",
      request_id: requestId,
      error_message: message,
      user_id: userInfo?.id ?? null,
      username: userInfo?.username ?? null,
      stack: err.stack ?? null,
    }));

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ error: message, requestId });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 3000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "3000", 10);
  const host = "0.0.0.0";
  httpServer.listen(
    {
      port,
      host,
    },
    () => {
      log(`serving on http://${host}:${port}`);
    },
  );
})();
