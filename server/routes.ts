import type { Express } from "express";
import { createServer, type Server } from "http";
import { createProxyMiddleware } from "http-proxy-middleware";
import { spawn } from "child_process";
import { log } from "./index";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage";
import { registerAnalyzeRoutes } from "./analyze";

function startDjango(): Promise<void> {
  return new Promise((resolve) => {
    const django = spawn("python", ["manage.py", "runserver", "0.0.0.0:8000"], {
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
  await startDjango();

  registerObjectStorageRoutes(app);
  registerAnalyzeRoutes(app);

  const djangoProxy = createProxyMiddleware({
    target: "http://127.0.0.1:8000",
    changeOrigin: true,
  });

  app.use("/api", (req, res, next) => {
    if (req.originalUrl.startsWith('/api/uploads')) {
      return next();
    }
    if (req.originalUrl.match(/^\/api\/documents\/\d+\/analyze\/?$/)) {
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
