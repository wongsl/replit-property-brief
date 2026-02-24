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
  const isExpressHandled = req.path.startsWith('/api/uploads') || req.path.match(/^\/api\/documents\/\d+\/analyze\/?$/);
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
  const isExpressHandled = req.path.startsWith('/api/uploads') || req.path.match(/^\/api\/documents\/\d+\/analyze\/?$/);
  const skip = (req.path.startsWith('/api') || req.path.startsWith('/media')) && !isExpressHandled;
  if (skip) {
    return next();
  }
  express.urlencoded({ extended: false })(req, res, next);
});

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      const requestId = (req as any).requestId ?? "-";
      log(`[${requestId}] ${req.method} ${path} ${res.statusCode} in ${duration}ms`);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);
  

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    const requestId = (_req as any).requestId ?? "-";

    console.error(`[${requestId}] Internal Server Error:`, err);

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
