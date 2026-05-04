import { collections } from "../collections";
import { uuid4 } from "../utils";
import * as APIv4 from "hyperschedule-shared/api/v4";
import { staticMode, staticHsaSubmissions } from "../static-store";
import { createLogger } from "../../logger";

const logger = createLogger("db.hsa-submission");

export async function createHsaSubmission(
    submission: Omit<APIv4.HsaSubmission, "_id">,
): Promise<APIv4.HsaSubmissionId> {
    const submissionId = uuid4("hsa-sub") as APIv4.HsaSubmissionId;
    const fullSubmission: APIv4.HsaSubmission = {
        ...submission,
        _id: submissionId,
    };

    if (staticMode) {
        staticHsaSubmissions.set(submissionId, fullSubmission);
        logger.info(`Created static HSA submission ${submissionId}`);
        return submissionId;
    }

    await collections.hsaSubmissions.insertOne(fullSubmission);
    logger.info(`Created HSA submission ${submissionId}`);
    return submissionId;
}

export async function getHsaSubmissionsForAdvisor(
    advisorId: APIv4.UserId,
): Promise<APIv4.HsaSubmission[]> {
    if (staticMode) {
        const results: APIv4.HsaSubmission[] = [];
        for (const sub of staticHsaSubmissions.values()) {
            if (sub.advisorId === advisorId) results.push(sub);
        }
        return results;
    }

    return collections.hsaSubmissions.find({ advisorId }).toArray();
}

export async function getHsaSubmissionsForStudent(
    studentUserId: APIv4.UserId,
): Promise<APIv4.HsaSubmission[]> {
    if (staticMode) {
        const results: APIv4.HsaSubmission[] = [];
        for (const sub of staticHsaSubmissions.values()) {
            if (sub.studentUserId === studentUserId) results.push(sub);
        }
        results.sort(
            (a, b) =>
                new Date(b.sharedAt).getTime() -
                new Date(a.sharedAt).getTime(),
        );
        return results;
    }

    return collections.hsaSubmissions
        .find({ studentUserId })
        .sort({ sharedAt: -1 })
        .toArray();
}

export async function getHsaSubmission(
    submissionId: APIv4.HsaSubmissionId,
): Promise<APIv4.HsaSubmission | null> {
    if (staticMode) {
        return staticHsaSubmissions.get(submissionId) ?? null;
    }

    return collections.hsaSubmissions.findOne({ _id: submissionId });
}

export async function deleteHsaSubmission(
    submissionId: APIv4.HsaSubmissionId,
    requestingUserId: APIv4.UserId,
): Promise<boolean> {
    if (staticMode) {
        const sub = staticHsaSubmissions.get(submissionId);
        if (!sub) return false;
        if (sub.studentUserId !== requestingUserId) return false;
        staticHsaSubmissions.delete(submissionId);
        logger.info(`Deleted static HSA submission ${submissionId}`);
        return true;
    }

    const result = await collections.hsaSubmissions.deleteOne({
        _id: submissionId,
        studentUserId: requestingUserId,
    });
    if (result.deletedCount === 0) return false;
    logger.info(`Deleted HSA submission ${submissionId}`);
    return true;
}

export async function addHsaSubmissionApproval(
    submissionId: APIv4.HsaSubmissionId,
    approval: APIv4.HsaSubmissionApproval,
): Promise<void> {
    if (staticMode) {
        const sub = staticHsaSubmissions.get(submissionId);
        if (!sub) throw Error("HSA submission not found");
        if (!sub.approvals) sub.approvals = [];
        sub.approvals.push(approval);
        logger.info(`Added approval to static HSA submission ${submissionId}`);
        return;
    }

    const result = await collections.hsaSubmissions.findOneAndUpdate(
        { _id: submissionId },
        {
            $push: {
                approvals: approval,
            },
        } as any,
    );
    if (!result.ok || result.value === null)
        throw Error("HSA submission not found");
    logger.info(`Added approval to HSA submission ${submissionId}`);
}
