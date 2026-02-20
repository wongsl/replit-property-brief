import { Response } from "express";
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";

/**
 * Local file storage implementation for development.
 * Stores files in a local directory instead of Google Cloud Storage.
 */
export class LocalStorageService {
  private basePath: string;

  constructor(basePath: string = "./local-storage") {
    this.basePath = basePath;
    // Create the base directory if it doesn't exist
    if (!fs.existsSync(basePath)) {
      fs.mkdirSync(basePath, { recursive: true });
    }
  }

  /**
   * Get a presigned/public URL for file upload.
   * In local mode, we return a placeholder since files are stored locally.
   */
  async getPresignedUploadUrl(): Promise<string> {
    const fileId = randomUUID();
    return `/api/local-upload/${fileId}`;
  }

  /**
   * Save an uploaded file to the local storage.
   */
  async saveFile(fileId: string, fileName: string, buffer: Buffer): Promise<string> {
    const dir = path.join(this.basePath, fileId);
    const filePath = path.join(dir, fileName);

    // Create directory for the file
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, buffer);

    return `/objects/${fileId}/${fileName}`;
  }

  /**
   * Get a file from local storage.
   */
  getFile(filePath: string): { path: string; exists: boolean } {
    // filePath format: /objects/{fileId}/{fileName} or similar
    const localPath = path.join(this.basePath, filePath.replace(/^\/objects\//, ""));
    const exists = fs.existsSync(localPath);
    return { path: localPath, exists };
  }

  /**
   * Send a file to the response.
   */
  async downloadFile(filePath: string, res: Response): Promise<void> {
    const { path: localPath, exists } = this.getFile(filePath);

    if (!exists) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    try {
      res.sendFile(localPath);
    } catch (error) {
      console.error("Error downloading file:", error);
      res.status(500).json({ error: "Failed to download file" });
    }
  }

  /**
   * Save a raw buffer directly under basePath/{fileId} (flat, no subdirectory).
   * Used by the PUT /api/local-upload/:fileId handler to mirror the S3 presigned PUT flow.
   */
  saveFileRaw(fileId: string, buffer: Buffer): void {
    const filePath = path.join(this.basePath, fileId);
    fs.writeFileSync(filePath, buffer);
  }

  /**
   * Delete a file from local storage.
   */
  async deleteFile(filePath: string): Promise<void> {
    const { path: localPath, exists } = this.getFile(filePath);

    if (!exists) {
      throw new Error("File not found");
    }

    fs.unlinkSync(localPath);
  }

  /**
   * List all files in a directory.
   */
  listFiles(dirPath: string = ""): string[] {
    const fullPath = path.join(this.basePath, dirPath);

    if (!fs.existsSync(fullPath)) {
      return [];
    }

    const files: string[] = [];
    const walkDir = (dir: string, prefix: string = "") => {
      const items = fs.readdirSync(dir);
      items.forEach((item) => {
        const itemPath = path.join(dir, item);
        const relativePath = prefix ? `${prefix}/${item}` : item;
        const stat = fs.statSync(itemPath);

        if (stat.isDirectory()) {
          walkDir(itemPath, relativePath);
        } else {
          files.push(relativePath);
        }
      });
    };

    walkDir(fullPath);
    return files;
  }
}

export const localStorageService = new LocalStorageService();
