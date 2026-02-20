import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Response } from "express";
import { randomUUID } from "crypto";
import { Readable } from "stream";
import { s3Client, S3FileRef } from "./s3Client";
import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  getObjectAclPolicy,
  setObjectAclPolicy,
} from "./objectAcl";
import { localStorageService } from "./localStorage";

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

// The object storage service is used to interact with S3.
export class ObjectStorageService {
  private useLocalStorage: boolean;

  constructor() {
    this.useLocalStorage = process.env.USE_LOCAL_STORAGE === "true";
    if (this.useLocalStorage) {
      console.log("🗂️  Using local file storage for development");
    }
  }

  // Gets the public object search paths.
  getPublicObjectSearchPaths(): Array<string> {
    if (this.useLocalStorage) {
      return ["local"];
    }

    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path.length > 0)
      )
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create an S3 bucket and set " +
          "PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths like /bucket/prefix)."
      );
    }
    return paths;
  }

  // Gets the private object directory.
  getPrivateObjectDir(): string {
    if (this.useLocalStorage) {
      return "local-storage";
    }

    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create an S3 bucket and set PRIVATE_OBJECT_DIR env var."
      );
    }
    return dir;
  }

  // Search for a public object from the search paths.
  async searchPublicObject(filePath: string): Promise<S3FileRef | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;
      const { bucketName, objectKey } = parseObjectPath(fullPath);
      const exists = await objectExists(bucketName, objectKey);
      if (exists) {
        return { bucketName, objectKey };
      }
    }
    return null;
  }

  // Downloads an object to the response.
  async downloadObject(
    file: S3FileRef | string,
    res: Response,
    cacheTtlSec: number = 3600
  ) {
    // Handle local storage
    if (typeof file === "string") {
      return localStorageService.downloadFile(file, res);
    }

    // Handle S3
    try {
      const head = await s3Client.send(
        new HeadObjectCommand({ Bucket: file.bucketName, Key: file.objectKey })
      );
      const aclPolicy = await getObjectAclPolicy(file);
      const isPublic = aclPolicy?.visibility === "public";

      res.set({
        "Content-Type": head.ContentType || "application/octet-stream",
        ...(head.ContentLength !== undefined && {
          "Content-Length": String(head.ContentLength),
        }),
        "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
      });

      const getResponse = await s3Client.send(
        new GetObjectCommand({ Bucket: file.bucketName, Key: file.objectKey })
      );

      const body = getResponse.Body;
      if (!body) {
        res.status(500).json({ error: "Empty response body from S3" });
        return;
      }

      // AWS SDK v3 returns a Readable in Node.js environments
      const stream = body as Readable;
      stream.on("error", (err) => {
        console.error("Stream error:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Error streaming file" });
        }
      });
      stream.pipe(res);
    } catch (error) {
      console.error("Error downloading file:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Error downloading file" });
      }
    }
  }

  // Gets a presigned PUT URL and the pre-computed objectPath for an upload.
  // Returns { uploadURL, objectPath } for both S3 and local storage modes.
  async getObjectEntityUploadInfo(): Promise<{ uploadURL: string; objectPath: string }> {
    if (this.useLocalStorage) {
      const fileId = randomUUID();
      return {
        uploadURL: `/api/local-upload/${fileId}`,
        objectPath: `/objects/${fileId}`,
      };
    }

    const privateObjectDir = this.getPrivateObjectDir();
    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;
    const { bucketName, objectKey } = parseObjectPath(fullPath);
    const uploadURL = await getPresignedPutUrl({ bucketName, objectKey, ttlSec: 900 });

    return {
      uploadURL,
      objectPath: `/objects/uploads/${objectId}`,
    };
  }

  // Gets the S3FileRef for an object entity path.
  async getObjectEntityFile(objectPath: string): Promise<S3FileRef | string> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    // Handle local storage
    if (this.useLocalStorage) {
      const { path: localPath, exists } = localStorageService.getFile(objectPath);
      if (!exists) {
        throw new ObjectNotFoundError();
      }
      return localPath;
    }

    // Handle S3
    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join("/");
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectKey } = parseObjectPath(objectEntityPath);

    console.log(`[objectStorage] Looking up S3 object: bucket=${bucketName} key=${objectKey}`);
    const exists = await objectExists(bucketName, objectKey);
    if (!exists) {
      console.log(`[objectStorage] Not found in S3: bucket=${bucketName} key=${objectKey}`);
      throw new ObjectNotFoundError();
    }
    return { bucketName, objectKey };
  }

  // Normalizes an S3 presigned URL or raw path to an /objects/ path.
  normalizeObjectEntityPath(rawPath: string): string {
    // Match virtual-hosted-style: https://{bucket}.s3.{region}.amazonaws.com/{key}?...
    const virtualHosted = rawPath.match(
      /^https?:\/\/([^.]+)\.s3[^.]*\.amazonaws\.com\/([^?]+)/
    );
    // Match path-style: https://s3.{region}.amazonaws.com/{bucket}/{key}?...
    const pathStyle = rawPath.match(
      /^https?:\/\/s3[^.]*\.amazonaws\.com\/([^/]+)\/([^?]+)/
    );

    let objectKey: string | undefined;
    if (virtualHosted) {
      objectKey = virtualHosted[2];
    } else if (pathStyle) {
      objectKey = pathStyle[2];
    } else {
      return rawPath;
    }

    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith("/")) {
      objectEntityDir = `${objectEntityDir}/`;
    }

    // The dir prefix is the objectKey portion of PRIVATE_OBJECT_DIR
    const { objectKey: dirKey } = parseObjectPath(objectEntityDir);
    const dirPrefix = dirKey.endsWith("/") ? dirKey : `${dirKey}/`;

    if (!objectKey.startsWith(dirPrefix)) {
      return `/${objectKey}`;
    }

    const entityId = objectKey.slice(dirPrefix.length);
    return `/objects/${entityId}`;
  }

  // Saves a file to local storage (development mode).
  async saveLocalFile(
    fileId: string,
    fileName: string,
    buffer: Buffer
  ): Promise<string> {
    if (!this.useLocalStorage) {
      throw new Error("Local storage is not enabled");
    }
    return localStorageService.saveFile(fileId, fileName, buffer);
  }

  // Tries to set the ACL policy for the object entity and return the normalized path.
  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  // Checks if the user can access the object entity.
  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: S3FileRef;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectKey: string;
} {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }

  const bucketName = pathParts[1];
  const objectKey = pathParts.slice(2).join("/");

  return { bucketName, objectKey };
}

async function objectExists(
  bucketName: string,
  objectKey: string
): Promise<boolean> {
  try {
    await s3Client.send(
      new HeadObjectCommand({ Bucket: bucketName, Key: objectKey })
    );
    return true;
  } catch (err: any) {
    if (
      err.name === "NotFound" ||
      err.name === "NoSuchKey" ||
      err.$metadata?.httpStatusCode === 404
    ) {
      return false;
    }
    // Surface unexpected errors (wrong region, access denied, etc.) clearly
    console.error(`[objectStorage] Unexpected error checking S3 object (bucket=${bucketName} key=${objectKey}):`, err.name, err.message);
    throw err;
  }
}

async function getPresignedPutUrl({
  bucketName,
  objectKey,
  ttlSec,
}: {
  bucketName: string;
  objectKey: string;
  ttlSec: number;
}): Promise<string> {
  const command = new PutObjectCommand({ Bucket: bucketName, Key: objectKey });
  return getSignedUrl(s3Client, command, { expiresIn: ttlSec });
}
