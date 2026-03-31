import type { Express } from "express";
import { createServer, type Server } from "http";
import { createProxyMiddleware } from "http-proxy-middleware";
import { spawn } from "child_process";
import { existsSync } from "fs";
import { log } from "./index";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage";
import { registerAnalyzeRoutes, registerFolderCombinedAnalysisRoute, registerDraftEmailRoute, registerDocumentDeleteRoutes, registerFileScreeningRoute, registerTranslateRoute } from "./analyze";
import * as path from "path";

function startDjango(): Promise<void> {
  return new Promise((resolve) => {
    // Use the Python from the venv if available, otherwise fallback to system python
    const venvPython = path.join(process.cwd(), ".venv", "bin", "python");
    const pythonPath = existsSync(venvPython) ? venvPython : (process.env.PYTHON_PATH || "python3.11");
    const host = process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1";
    const django = spawn(pythonPath, ["manage.py", "runserver", `${host}:8000`], {
      cwd: `${process.cwd()}/backend`,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    let resolved = false;
    const done = () => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    };

    const checkOutput = (data: Buffer) => {
      const msg = data.toString();
      log(msg.trim(), "django");
      if (msg.includes("Starting development server") || msg.includes("Quit the server")) {
        done();
      }
    };

    django.stdout.on("data", checkOutput);
    django.stderr.on("data", checkOutput);

    django.on("error", (err) => {
      log(`Django failed to start: ${err.message}`, "django");
      done();
    });

    django.on("exit", (code) => {
      log(`Django exited with code ${code}`, "django");
    });

    setTimeout(done, 15000);
  });
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // In production (ECS), Django runs as a separate container on the same task
  // network and is already listening on port 8000. Skip spawning it.
  if (process.env.SKIP_DJANGO_SPAWN !== "true") {
    await startDjango();
  } else {
    log("Skipping Django spawn (SKIP_DJANGO_SPAWN=true)", "django");
  }

  registerObjectStorageRoutes(app);
  registerDocumentDeleteRoutes(app);
  registerAnalyzeRoutes(app);
  registerFolderCombinedAnalysisRoute(app);
  registerDraftEmailRoute(app);
  registerFileScreeningRoute(app);
  registerTranslateRoute(app);

  const djangoProxy = createProxyMiddleware({
    target: "http://127.0.0.1:8000",
    changeOrigin: true,
    on: {
      error: (err: Error, req: any, res: any) => {
        log(`Proxy error (Django not ready?): ${err.message}`, "django");
        if (!res.headersSent) {
          res.status(502).json({ error: "Backend service unavailable. Please retry." });
        }
      },
    },
  });

  app.use("/api", (req, res, next) => {
    if (req.originalUrl.startsWith('/api/uploads')) {
      return next();
    }
    if (req.originalUrl.match(/^\/api\/documents\/\d+\/analyze\/?$/)) {
      return next();
    }
    if (req.originalUrl.match(/^\/api\/documents\/\d+\/draft-email\/?$/)) {
      return next();
    }
    if (req.originalUrl.match(/^\/api\/folders\/\d+\/combined-analysis\/?$/)) {
      return next();
    }
    if (req.method === "DELETE" && req.originalUrl.match(/^\/api\/documents\/\d+\/?$/)) {
      return next();
    }
    if (req.originalUrl === '/api/screen-files/') {
      return next();
    }
    if (req.originalUrl === '/api/translate/') {
      return next();
    }
    req.url = `/api${req.url}`;
    djangoProxy(req, res, next);
  });

  app.use("/media", (req, res, next) => {
    req.url = `/media${req.url}`;
    djangoProxy(req, res, next);
  });

  return httpServer;
}
