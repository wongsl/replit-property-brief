export { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
export { s3Client } from "./s3Client";
export type { S3FileRef } from "./s3Client";

export type {
  ObjectAclPolicy,
  ObjectAccessGroup,
  ObjectAccessGroupType,
  ObjectAclRule,
} from "./objectAcl";

export {
  canAccessObject,
  getObjectAclPolicy,
  setObjectAclPolicy,
} from "./objectAcl";

export { registerObjectStorageRoutes } from "./routes";

