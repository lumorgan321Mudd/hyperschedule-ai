import { collections } from "../collections";
import { uuid4 } from "../utils";
import * as APIv4 from "hyperschedule-shared/api/v4";
import { staticMode, staticScheduleSnapshots } from "../static-store";
import { createLogger } from "../../logger";

const logger = createLogger("db.shared-schedule-snapshot");

export async function createScheduleSnapshot(
    snapshot: Omit<APIv4.SharedScheduleSnapshot, "_id">,
): Promise<APIv4.SharedScheduleSnapshotId> {
    const snapshotId = uuid4("sched-snap") as APIv4.SharedScheduleSnapshotId;
    const fullSnapshot: APIv4.SharedScheduleSnapshot = {
        ...snapshot,
        _id: snapshotId,
    };

    if (staticMode) {
        staticScheduleSnapshots.set(snapshotId, fullSnapshot);
        logger.info(`Created static schedule snapshot ${snapshotId}`);
        return snapshotId;
    }

    await collections.sharedScheduleSnapshots.insertOne(fullSnapshot);
    logger.info(`Created schedule snapshot ${snapshotId}`);
    return snapshotId;
}

export async function getScheduleSnapshotsForAdvisor(
    advisorEmail: string,
): Promise<APIv4.SharedScheduleSnapshot[]> {
    if (staticMode) {
        const results: APIv4.SharedScheduleSnapshot[] = [];
        for (const snap of staticScheduleSnapshots.values()) {
            if (snap.advisorEmail === advisorEmail) results.push(snap);
        }
        return results;
    }

    return collections.sharedScheduleSnapshots
        .find({ advisorEmail })
        .toArray();
}

export async function getScheduleSnapshotsForStudent(
    studentUserId: string,
): Promise<APIv4.SharedScheduleSnapshot[]> {
    if (staticMode) {
        const results: APIv4.SharedScheduleSnapshot[] = [];
        for (const snap of staticScheduleSnapshots.values()) {
            if (snap.studentUserId === studentUserId) results.push(snap);
        }
        results.sort(
            (a, b) =>
                new Date(b.sharedAt).getTime() -
                new Date(a.sharedAt).getTime(),
        );
        return results;
    }

    return collections.sharedScheduleSnapshots
        .find({ studentUserId })
        .sort({ sharedAt: -1 })
        .toArray();
}

export async function deleteScheduleSnapshot(
    snapshotId: APIv4.SharedScheduleSnapshotId,
    requestingUserId: string,
): Promise<boolean> {
    if (staticMode) {
        const snap = staticScheduleSnapshots.get(snapshotId);
        if (!snap) return false;
        if (snap.studentUserId !== requestingUserId) return false;
        staticScheduleSnapshots.delete(snapshotId);
        logger.info(`Deleted static schedule snapshot ${snapshotId}`);
        return true;
    }

    const result = await collections.sharedScheduleSnapshots.deleteOne({
        _id: snapshotId,
        studentUserId: requestingUserId,
    });
    if (result.deletedCount === 0) return false;
    logger.info(`Deleted schedule snapshot ${snapshotId}`);
    return true;
}

export async function getScheduleSnapshot(
    snapshotId: APIv4.SharedScheduleSnapshotId,
): Promise<APIv4.SharedScheduleSnapshot | null> {
    if (staticMode) {
        return staticScheduleSnapshots.get(snapshotId) ?? null;
    }

    return collections.sharedScheduleSnapshots.findOne({ _id: snapshotId });
}

export async function addScheduleApproval(
    snapshotId: APIv4.SharedScheduleSnapshotId,
    approval: APIv4.ScheduleApproval,
): Promise<void> {
    if (staticMode) {
        const snap = staticScheduleSnapshots.get(snapshotId);
        if (!snap) throw Error("Schedule snapshot not found");
        if (!snap.approvals) snap.approvals = [];
        snap.approvals.push(approval);
        logger.info(`Added approval to static schedule snapshot ${snapshotId}`);
        return;
    }

    const result = await collections.sharedScheduleSnapshots.findOneAndUpdate(
        { _id: snapshotId },
        {
            $push: {
                approvals: approval,
            },
        } as any,
    );
    if (!result.ok || result.value === null)
        throw Error("Schedule snapshot not found");
    logger.info(`Added approval to schedule snapshot ${snapshotId}`);
}
