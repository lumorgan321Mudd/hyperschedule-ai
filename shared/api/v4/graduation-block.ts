import { z } from "zod";
import { SchoolEnum, SectionIdentifier, TermIdentifier } from "./course";

// Re-define these to avoid circular dependency with user.ts
const UserIdRef = z.string().regex(/u~[A-Za-z0-9\-_]{22}/);
const UserSectionAttrsRef = z.object({
    selected: z.boolean(),
    requirementTags: z.string().array().optional(),
});
const UserSectionRef = z.object({
    section: SectionIdentifier,
    attrs: UserSectionAttrsRef,
});

// --- IDs ---

export const GraduationBlockId = z.string().regex(/^b~[A-Za-z0-9\-_]{22}$/);
export type GraduationBlockId = z.infer<typeof GraduationBlockId>;

export const BlockSemesterId = z.string().regex(/^sem~[A-Za-z0-9\-_]{22}$/);
export type BlockSemesterId = z.infer<typeof BlockSemesterId>;

export const SharedBlockSnapshotId = z
    .string()
    .regex(/^snap~[A-Za-z0-9\-_]{22}$/);
export type SharedBlockSnapshotId = z.infer<typeof SharedBlockSnapshotId>;

// --- Plan type ---

export const PlanType = z.enum(["standard", "hsa"]);
export type PlanType = z.infer<typeof PlanType>;

// --- Core types ---

export const BlockSemester = z.object({
    term: TermIdentifier,
    name: z.string(),
    sections: UserSectionRef.array(),
    isFutureTerm: z.boolean().optional(),
    sourceTermNote: z.string().optional(),
});
export type BlockSemester = z.infer<typeof BlockSemester>;

export const BlockShareInfo = z.object({
    advisorEmail: z.string(),
    lastSharedAt: z.string(),
    snapshotId: SharedBlockSnapshotId,
    approvalStatus: z.enum(["approved", "rejected"]).optional(),
    approvalComment: z.string().optional(),
    approvalAdvisorName: z.string().optional(),
    approvalTimestamp: z.string().optional(),
});
export type BlockShareInfo = z.infer<typeof BlockShareInfo>;

export const GraduationBlock = z.object({
    name: z.string(),
    college: SchoolEnum,
    major: z.string().optional(),
    planType: PlanType.optional(),
    semesters: z.record(BlockSemesterId, BlockSemester),
    shares: BlockShareInfo.array().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
    /** @deprecated Kept for backward compat with persisted data. */
    dirtyAfterShare: z.boolean().optional(),
});
export type GraduationBlock = z.infer<typeof GraduationBlock>;

// --- Snapshot types (stored in separate collection) ---

export const SnapshotApproval = z.object({
    advisorId: UserIdRef,
    advisorEppn: z.string(),
    advisorName: z.string(),
    status: z.enum(["approved", "rejected"]),
    comment: z.string(),
    signature: z.string(),
    timestamp: z.string(),
});
export type SnapshotApproval = z.infer<typeof SnapshotApproval>;

export const SharedBlockSnapshot = z.object({
    _id: SharedBlockSnapshotId,
    studentUserId: UserIdRef,
    studentEppn: z.string(),
    studentSchool: SchoolEnum,
    advisorEmail: z.string(),
    blockName: z.string(),
    blockId: GraduationBlockId,
    college: SchoolEnum,
    major: z.string().optional(),
    planType: PlanType.optional(),
    semesters: z.record(z.string(), BlockSemester),
    sharedAt: z.string(),
    approvals: SnapshotApproval.array().optional(),
});
export type SharedBlockSnapshot = z.infer<typeof SharedBlockSnapshot>;

// --- Request/Response types ---

export const CreateBlockRequest = z.object({
    name: z.string().min(1).max(100),
    college: SchoolEnum,
    major: z.string().optional(),
    planType: PlanType.optional(),
});
export type CreateBlockRequest = z.infer<typeof CreateBlockRequest>;

export const CreateBlockResponse = z.object({
    blockId: GraduationBlockId,
});
export type CreateBlockResponse = z.infer<typeof CreateBlockResponse>;

export const UpdateBlockRequest = z.object({
    blockId: GraduationBlockId,
    name: z.string().min(1).max(100).optional(),
    college: SchoolEnum.optional(),
    major: z.string().optional(),
});
export type UpdateBlockRequest = z.infer<typeof UpdateBlockRequest>;

export const DeleteBlockRequest = z.object({
    blockId: GraduationBlockId,
});
export type DeleteBlockRequest = z.infer<typeof DeleteBlockRequest>;

export const AddBlockSemesterRequest = z.object({
    blockId: GraduationBlockId,
    term: TermIdentifier,
    name: z.string(),
    isFutureTerm: z.boolean().optional(),
    sourceTermNote: z.string().optional(),
});
export type AddBlockSemesterRequest = z.infer<typeof AddBlockSemesterRequest>;

export const AddBlockSemesterResponse = z.object({
    semesterId: BlockSemesterId,
});
export type AddBlockSemesterResponse = z.infer<typeof AddBlockSemesterResponse>;

export const UpdateBlockSemesterRequest = z.object({
    blockId: GraduationBlockId,
    semesterId: BlockSemesterId,
    sections: UserSectionRef.array(),
});
export type UpdateBlockSemesterRequest = z.infer<
    typeof UpdateBlockSemesterRequest
>;

export const DeleteBlockSemesterRequest = z.object({
    blockId: GraduationBlockId,
    semesterId: BlockSemesterId,
});
export type DeleteBlockSemesterRequest = z.infer<
    typeof DeleteBlockSemesterRequest
>;

export const ShareBlockRequest = z.object({
    blockId: GraduationBlockId,
    advisorEmail: z.string().email(),
});
export type ShareBlockRequest = z.infer<typeof ShareBlockRequest>;

export const ShareBlockResponse = z.object({
    snapshotId: SharedBlockSnapshotId,
});
export type ShareBlockResponse = z.infer<typeof ShareBlockResponse>;

export const GetSharedSnapshotsResponse = z.object({
    snapshots: SharedBlockSnapshot.array(),
});
export type GetSharedSnapshotsResponse = z.infer<
    typeof GetSharedSnapshotsResponse
>;

export const SnapshotApprovalRequest = z.object({
    snapshotId: SharedBlockSnapshotId,
    status: z.enum(["approved", "rejected"]),
    comment: z.string(),
    signature: z.string(),
    advisorName: z.string(),
});
export type SnapshotApprovalRequest = z.infer<typeof SnapshotApprovalRequest>;

export const GetMySnapshotsResponse = z.object({
    snapshots: SharedBlockSnapshot.array(),
});
export type GetMySnapshotsResponse = z.infer<typeof GetMySnapshotsResponse>;

export const DeleteSnapshotRequest = z.object({
    snapshotId: SharedBlockSnapshotId,
});
export type DeleteSnapshotRequest = z.infer<typeof DeleteSnapshotRequest>;

// --- Role types ---

export const UserRole = z.enum(["student", "advisor"]);
export type UserRole = z.infer<typeof UserRole>;

export const SetUserRoleRequest = z.object({
    role: UserRole,
});
export type SetUserRoleRequest = z.infer<typeof SetUserRoleRequest>;
