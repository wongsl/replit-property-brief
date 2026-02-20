import { HeadObjectCommand, CopyObjectCommand } from "@aws-sdk/client-s3";
import { s3Client, S3FileRef } from "./s3Client";

const ACL_POLICY_METADATA_KEY = "aclpolicy";

// The type of the access group.
//
// Can be flexibly defined according to the use case.
//
// Examples:
// - USER_LIST: the users from a list stored in the database;
// - EMAIL_DOMAIN: the users whose email is in a specific domain;
// - GROUP_MEMBER: the users who are members of a specific group;
// - SUBSCRIBER: the users who are subscribers of a specific service / content
//   creator.
export enum ObjectAccessGroupType {}

// The logic user group that can access the object.
export interface ObjectAccessGroup {
  // The type of the access group.
  type: ObjectAccessGroupType;
  // The logic id that is enough to identify the qualified group members.
  //
  // It may have different format for different types. For example:
  // - for USER_LIST, the id could be the user list db entity id, and the
  //   user list db entity could contain a bunch of user ids. User needs
  //   to be a member of the user list to be able to access the object.
  // - for EMAIL_DOMAIN, the id could be the email domain, and the user needs
  //   to have an email with the domain to be able to access the object.
  // - for GROUP_MEMBER, the id could be the group db entity id, and the
  //   group db entity could contain a bunch of user ids. User needs to be
  //   a member of the group to be able to access the object.
  // - for SUBSCRIBER, the id could be the subscriber db entity id, and the
  //   subscriber db entity could contain a bunch of user ids. User needs to
  //   be a subscriber to be able to access the object.
  id: string;
}

export enum ObjectPermission {
  READ = "read",
  WRITE = "write",
}

export interface ObjectAclRule {
  group: ObjectAccessGroup;
  permission: ObjectPermission;
}

// The ACL policy of the object.
// Stored as S3 object metadata under key "aclpolicy".
export interface ObjectAclPolicy {
  owner: string;
  visibility: "public" | "private";
  aclRules?: Array<ObjectAclRule>;
}

// Check if the requested permission is allowed based on the granted permission.
function isPermissionAllowed(
  requested: ObjectPermission,
  granted: ObjectPermission,
): boolean {
  // Users granted with read or write permissions can read the object.
  if (requested === ObjectPermission.READ) {
    return [ObjectPermission.READ, ObjectPermission.WRITE].includes(granted);
  }

  // Only users granted with write permissions can write the object.
  return granted === ObjectPermission.WRITE;
}

// The base class for all access groups.
//
// Different types of access groups can be implemented according to the use case.
abstract class BaseObjectAccessGroup implements ObjectAccessGroup {
  constructor(
    public readonly type: ObjectAccessGroupType,
    public readonly id: string,
  ) {}

  // Check if the user is a member of the group.
  public abstract hasMember(userId: string): Promise<boolean>;
}

function createObjectAccessGroup(
  group: ObjectAccessGroup,
): BaseObjectAccessGroup {
  switch (group.type) {
    // Implement the case for each type of access group to instantiate.
    //
    // For example:
    // case "USER_LIST":
    //   return new UserListAccessGroup(group.id);
    // case "EMAIL_DOMAIN":
    //   return new EmailDomainAccessGroup(group.id);
    // case "GROUP_MEMBER":
    //   return new GroupMemberAccessGroup(group.id);
    // case "SUBSCRIBER":
    //   return new SubscriberAccessGroup(group.id);
    default:
      throw new Error(`Unknown access group type: ${group.type}`);
  }
}

// Sets the ACL policy to the S3 object metadata.
// S3 does not support in-place metadata updates, so we copy the object to itself
// with MetadataDirective: "REPLACE" to overwrite the metadata.
export async function setObjectAclPolicy(
  objectFile: S3FileRef | string,
  aclPolicy: ObjectAclPolicy,
): Promise<void> {
  // Skip ACL for local storage
  if (typeof objectFile === "string") {
    return;
  }

  const { bucketName, objectKey } = objectFile;

  // Fetch current metadata to preserve ContentType and other fields
  const head = await s3Client.send(
    new HeadObjectCommand({ Bucket: bucketName, Key: objectKey })
  );

  // Copy object to itself with new metadata (only way to update metadata in S3)
  await s3Client.send(
    new CopyObjectCommand({
      Bucket: bucketName,
      CopySource: `${bucketName}/${objectKey}`,
      Key: objectKey,
      MetadataDirective: "REPLACE",
      ContentType: head.ContentType,
      Metadata: {
        ...head.Metadata,
        [ACL_POLICY_METADATA_KEY]: JSON.stringify(aclPolicy),
      },
    })
  );
}

// Gets the ACL policy from the S3 object metadata.
export async function getObjectAclPolicy(
  objectFile: S3FileRef | string,
): Promise<ObjectAclPolicy | null> {
  // No ACL for local storage
  if (typeof objectFile === "string") {
    return null;
  }

  const { bucketName, objectKey } = objectFile;
  const head = await s3Client.send(
    new HeadObjectCommand({ Bucket: bucketName, Key: objectKey })
  );

  const aclPolicy = head.Metadata?.[ACL_POLICY_METADATA_KEY];
  if (!aclPolicy) {
    return null;
  }
  return JSON.parse(aclPolicy);
}

// Checks if the user can access the object.
export async function canAccessObject({
  userId,
  objectFile,
  requestedPermission,
}: {
  userId?: string;
  objectFile: S3FileRef;
  requestedPermission: ObjectPermission;
}): Promise<boolean> {
  const aclPolicy = await getObjectAclPolicy(objectFile);
  if (!aclPolicy) {
    return false;
  }

  // Public objects are always accessible for read.
  if (
    aclPolicy.visibility === "public" &&
    requestedPermission === ObjectPermission.READ
  ) {
    return true;
  }

  // Access control requires the user id.
  if (!userId) {
    return false;
  }

  // The owner of the object can always access it.
  if (aclPolicy.owner === userId) {
    return true;
  }

  // Go through the ACL rules to check if the user has the required permission.
  for (const rule of aclPolicy.aclRules || []) {
    const accessGroup = createObjectAccessGroup(rule.group);
    if (
      (await accessGroup.hasMember(userId)) &&
      isPermissionAllowed(requestedPermission, rule.permission)
    ) {
      return true;
    }
  }

  return false;
}
