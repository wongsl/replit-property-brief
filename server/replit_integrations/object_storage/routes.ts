import type { Express } from "express";
import { eq } from "drizzle-orm";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
import { localStorageService } from "./localStorage";
import multer from "multer";
import { db } from "../../db";
import { uploads } from "@shared/schema";

export function registerObjectStorageRoutes(app: Express): void {
  const objectStorageService = new ObjectStorageService();
  const upload = multer({ storage: multer.memoryStorage() });

  /**
   * Request a presigned URL for file upload.
   *
   * Request body (JSON):
   * {
   *   "name": "filename.pdf",
   *   "size": 12345,
   *   "contentType": "application/pdf"
   * }
   *
   * Response:
   * {
   *   "uploadURL": "https://bucket.s3.region.amazonaws.com/..." (or /api/local-upload/uuid in dev),
   *   "objectPath": "/objects/uploads/uuid",
   *   "uploadId": "uuid"
   * }
   *
   * Client should PUT the file body directly to uploadURL, then store objectPath in the document record.
   */
  app.post("/api/uploads/request-url", async (req, res) => {
    try {
      const { name, size, contentType } = req.body;

      if (!name) {
        return res.status(400).json({ error: "Missing required field: name" });
      }

      const { uploadURL, objectPath } = await objectStorageService.getObjectEntityUploadInfo();

      // Track the upload in the database (non-fatal if DB is not configured)
      let uploadId: string | undefined;
      try {
        const [record] = await db.insert(uploads).values({
          objectPath,
          originalName: name,
          contentType: contentType ?? null,
          size: size ? Number(size) : null,
          status: "pending",
        }).returning();
        uploadId = record.id;
      } catch (dbErr) {
        console.warn("Upload tracking skipped (DB not available):", (dbErr as Error).message);
      }

      res.json({
        uploadURL,
        objectPath,
        uploadId,
        metadata: { name, size, contentType },
      });
    } catch (error) {
      console.error("Error generating upload URL:", error);
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  });

  /**
   * Local storage PUT handler — mirrors the S3 presigned PUT flow for development.
   * Accepts the raw file body and saves it to local-storage/{fileId}.
   * Only active when USE_LOCAL_STORAGE=true.
   */
  app.put("/api/local-upload/:fileId", async (req, res) => {
    const fileId = String(req.params.fileId);
    const chunks: Buffer[] = [];

    await new Promise<void>((resolve, reject) => {
      req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      req.on("end", resolve);
      req.on("error", reject);
    });

    const buffer = Buffer.concat(chunks);
    localStorageService.saveFileRaw(fileId, buffer);

    // Mark as uploaded in DB (non-fatal if DB is not configured)
    try {
      await db.update(uploads)
        .set({ status: "uploaded" })
        .where(eq(uploads.objectPath, `/objects/${fileId}`));
    } catch (dbErr) {
      console.warn("Upload status update skipped (DB not available):", (dbErr as Error).message);
    }

    res.status(200).send();
  });

  /**
   * Serve uploaded objects.
   *
   * GET /objects/:objectPath(*)
   */
  app.get("/objects/{*objectPath}", async (req, res) => {
    try {
      const objectFile = await objectStorageService.getObjectEntityFile(req.path);
      await objectStorageService.downloadObject(objectFile, res);
    } catch (error) {
      console.error("Error serving object:", error);
      if (error instanceof ObjectNotFoundError) {
        return res.status(404).json({ error: "Object not found" });
      }
      return res.status(500).json({ error: "Failed to serve object" });
    }
  });

  /**
   * Local file upload endpoint — multipart POST fallback (kept for compatibility).
   *
   * POST /api/local-upload/:fileId
   */
  app.post("/api/local-upload/:fileId", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file provided" });
      }

      const fileId = String(req.params.fileId);
      const fileName = req.file.originalname;
      const buffer = req.file.buffer;

      const objectPath = await objectStorageService.saveLocalFile(fileId, fileName, buffer);

      let uploadId: string | undefined;
      try {
        const [record] = await db.insert(uploads).values({
          objectPath,
          originalName: fileName,
          contentType: req.file.mimetype,
          size: req.file.size,
          status: "uploaded",
        }).returning();
        uploadId = record.id;
      } catch (dbErr) {
        console.warn("Upload tracking skipped (DB not available):", (dbErr as Error).message);
      }

      res.json({
        success: true,
        objectPath,
        uploadId,
        metadata: {
          name: fileName,
          size: req.file.size,
          contentType: req.file.mimetype,
        },
      });
    } catch (error) {
      console.error("Error uploading file:", error);
      res.status(500).json({ error: "Failed to upload file" });
    }
  });
}
