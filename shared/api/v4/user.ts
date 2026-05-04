import {
    SchoolEnum,
    SectionIdentifier,
    TermIdentifier,
    termIsBefore,
} from "./course";
import { z } from "zod";
import {
    UserRole,
    GraduationBlockId,
    GraduationBlock,
    CatalogYear,
} from "./graduation-block";

export const UserId = z.string().regex(/u~[A-Za-z0-9\-_]{22}/);
export const ScheduleId = z.string().regex(/s~[A-Za-z0-9\-_]{22}/);
export type UserId = z.infer<typeof UserId>;
export type ScheduleId = z.infer<typeof ScheduleId>;

export const UserSectionAttrs = z.object({
    selected: z.boolean(),
    requirementTags: z.string().array().optional(),
});
export type UserSectionAttrs = z.infer<typeof UserSectionAttrs>;

export const UserSection = z.object({
    section: SectionIdentifier,
    attrs: UserSectionAttrs,
});
export type UserSection = z.infer<typeof UserSection>;

export const UserSchedule = z.object({
    term: TermIdentifier,
    name: z.string(),
    sections: UserSection.array(),
});
export type UserSchedule = z.infer<typeof UserSchedule>;

export const LocalUser = z.object({
    _id: z.undefined(),
    schedules: z.record(ScheduleId, UserSchedule),
});
export type LocalUser = z.infer<typeof LocalUser>;

export const Username = z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-z0-9_]+$/, "Username must be lowercase letters, digits, or _");
export type Username = z.infer<typeof Username>;

export const ServerUser = z.object({
    _id: UserId,
    eppn: z.string().optional(),
    username: Username.optional(),
    email: z.string().email().optional(),
    passwordHash: z.string().optional(),
    passwordResetTokenHash: z.string().optional(),
    passwordResetExpiry: z.string().optional(),
    advisorEmail: z.string().email().optional(),
    school: SchoolEnum,
    classYear: z.number().optional(),
    schedules: z.record(ScheduleId, UserSchedule),
    role: UserRole.optional(),
    graduationBlocks: z
        .record(GraduationBlockId, GraduationBlock)
        .optional(),
});
export type ServerUser = z.infer<typeof ServerUser>;

export const SignupRequest = z.object({
    username: Username,
    email: z.string().email(),
    password: z.string().min(8),
    school: SchoolEnum,
    classYear: z.number().optional(),
    role: UserRole.optional(),
});
export type SignupRequest = z.infer<typeof SignupRequest>;

export const LoginRequest = z.object({
    username: z.string(),
    password: z.string(),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const RequestPasswordResetRequest = z.object({
    email: z.string().email(),
});
export type RequestPasswordResetRequest = z.infer<
    typeof RequestPasswordResetRequest
>;

export const ResetPasswordRequest = z.object({
    token: z.string(),
    password: z.string().min(8),
});
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequest>;

export const User = z.union([LocalUser, ServerUser]);
export type User = z.infer<typeof User>;

/**
 * sort schedules in reverse chronological order, then by name in lexical order
 */
export function getSchedulesSorted(
    schedules: Record<ScheduleId, UserSchedule>,
): [ScheduleId, UserSchedule][] {
    const arr = Object.entries(schedules);
    arr.sort((a, b): number => {
        const schedule0 = a[1];
        const schedule1 = b[1];
        if (
            schedule0.term.year === schedule1.term.year &&
            schedule0.term.term === schedule1.term.term
        )
            return schedule0.name.localeCompare(schedule1.name);
        if (termIsBefore(schedule0.term, schedule1.term)) return 1;
        return -1;
    });
    return arr;
}

export const AddScheduleRequest = z.object({
    term: TermIdentifier,
    name: z.string(),
});
export type AddScheduleRequest = z.infer<typeof AddScheduleRequest>;
export const RenameScheduleRequest = z.object({
    scheduleId: z.string(),
    name: z.string(),
});
export type RenameScheduleRequest = z.infer<typeof RenameScheduleRequest>;

export const AddScheduleResponse = z.object({
    scheduleId: ScheduleId,
});
export type AddScheduleResponse = z.infer<typeof AddScheduleResponse>;

export const DeleteScheduleRequest = AddScheduleResponse;
export type DeleteScheduleRequest = AddScheduleResponse;

export const AddSectionRequest = z.object({
    scheduleId: ScheduleId,
    section: SectionIdentifier,
});
export type AddSectionRequest = z.infer<typeof AddSectionRequest>;

export const DeleteSectionRequest = AddSectionRequest;
export type DeleteSectionRequest = AddSectionRequest;

export const SetSectionAttrRequest = z.object({
    scheduleId: ScheduleId,
    section: SectionIdentifier,
    attrs: UserSectionAttrs,
});
export type SetSectionAttrRequest = z.infer<typeof SetSectionAttrRequest>;

export const SetActiveScheduleRequest = z.object({
    scheduleId: ScheduleId,
});
export type SetActiveScheduleRequest = z.infer<typeof SetActiveScheduleRequest>;

export const ReplaceSectionsRequest = z.object({
    scheduleId: ScheduleId,
    sections: UserSection.array(),
});
export type ReplaceSectionsRequest = z.infer<typeof ReplaceSectionsRequest>;

export const DuplicateScheduleRequest = z.object({
    scheduleId: ScheduleId,
    name: z.string(),
});
export type DuplicateScheduleRequest = z.infer<typeof DuplicateScheduleRequest>;
export const DuplicateScheduleResponse = AddScheduleResponse;
export type DuplicateScheduleResponse = AddScheduleResponse;

// --- Shared Schedule Snapshot (advisor approval of a schedule) ---

export const SharedScheduleSnapshotId = z
    .string()
    .regex(/^sched-snap~[A-Za-z0-9\-_]{22}$/);
export type SharedScheduleSnapshotId = z.infer<typeof SharedScheduleSnapshotId>;

export const ScheduleApproval = z.object({
    advisorId: UserId,
    advisorEppn: z.string(),
    advisorName: z.string(),
    status: z.enum(["approved", "rejected"]),
    comment: z.string(),
    signature: z.string(),
    timestamp: z.string(),
});
export type ScheduleApproval = z.infer<typeof ScheduleApproval>;

export const SharedScheduleSnapshot = z.object({
    _id: SharedScheduleSnapshotId,
    studentUserId: UserId,
    studentEppn: z.string(),
    studentSchool: SchoolEnum,
    advisorEmail: z.string(),
    scheduleId: ScheduleId,
    scheduleName: z.string(),
    term: TermIdentifier,
    sections: UserSection.array(),
    sharedAt: z.string(),
    approvals: ScheduleApproval.array().optional(),
});
export type SharedScheduleSnapshot = z.infer<typeof SharedScheduleSnapshot>;

export const ShareScheduleRequest = z.object({
    scheduleId: ScheduleId,
    advisorEmail: z.string().email(),
});
export type ShareScheduleRequest = z.infer<typeof ShareScheduleRequest>;

export const ShareScheduleResponse = z.object({
    snapshotId: SharedScheduleSnapshotId,
});
export type ShareScheduleResponse = z.infer<typeof ShareScheduleResponse>;

export const GetScheduleSnapshotsResponse = z.object({
    snapshots: SharedScheduleSnapshot.array(),
});
export type GetScheduleSnapshotsResponse = z.infer<
    typeof GetScheduleSnapshotsResponse
>;

export const ScheduleApprovalRequest = z.object({
    snapshotId: SharedScheduleSnapshotId,
    status: z.enum(["approved", "rejected"]),
    comment: z.string(),
    signature: z.string(),
    advisorName: z.string(),
});
export type ScheduleApprovalRequest = z.infer<typeof ScheduleApprovalRequest>;

export const DeleteScheduleSnapshotRequest = z.object({
    snapshotId: SharedScheduleSnapshotId,
});
export type DeleteScheduleSnapshotRequest = z.infer<
    typeof DeleteScheduleSnapshotRequest
>;

// --- HSA Submission (HMC student → HSA advisor) ---

export const HsaSubmissionId = z
    .string()
    .regex(/^hsa-sub~[A-Za-z0-9\-_]{22}$/);
export type HsaSubmissionId = z.infer<typeof HsaSubmissionId>;

export const HsaCourseLabel = z.enum(["planned", "alternate"]);
export type HsaCourseLabel = z.infer<typeof HsaCourseLabel>;

export const HsaCourseTag = z.enum(["concentration", "distribution"]);
export type HsaCourseTag = z.infer<typeof HsaCourseTag>;

export const HsaSubmissionCourse = z.object({
    section: SectionIdentifier,
    tag: HsaCourseTag,
    label: HsaCourseLabel,
});
export type HsaSubmissionCourse = z.infer<typeof HsaSubmissionCourse>;

export const HsaSubmissionApproval = ScheduleApproval;
export type HsaSubmissionApproval = ScheduleApproval;

export const HsaSubmission = z.object({
    _id: HsaSubmissionId,
    studentUserId: UserId,
    studentUsername: z.string(),
    advisorId: UserId,
    advisorEmail: z.string(),
    courses: HsaSubmissionCourse.array(),
    sharedAt: z.string(),
    approvals: HsaSubmissionApproval.array().optional(),
});
export type HsaSubmission = z.infer<typeof HsaSubmission>;

export const ShareHsaSubmissionRequest = z.object({
    advisorEmail: z.string().email(),
    courses: HsaSubmissionCourse.array(),
});
export type ShareHsaSubmissionRequest = z.infer<
    typeof ShareHsaSubmissionRequest
>;

export const ShareHsaSubmissionResponse = z.object({
    submissionId: HsaSubmissionId,
});
export type ShareHsaSubmissionResponse = z.infer<
    typeof ShareHsaSubmissionResponse
>;

export const GetHsaSubmissionsResponse = z.object({
    submissions: HsaSubmission.array(),
});
export type GetHsaSubmissionsResponse = z.infer<
    typeof GetHsaSubmissionsResponse
>;

export const HsaSubmissionApprovalRequest = z.object({
    submissionId: HsaSubmissionId,
    status: z.enum(["approved", "rejected"]),
    comment: z.string(),
    signature: z.string(),
    advisorName: z.string(),
});
export type HsaSubmissionApprovalRequest = z.infer<
    typeof HsaSubmissionApprovalRequest
>;
