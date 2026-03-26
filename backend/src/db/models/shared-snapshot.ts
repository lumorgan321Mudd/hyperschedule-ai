import { collections } from "../collections";
import { uuid4 } from "../utils";
import * as APIv4 from "hyperschedule-shared/api/v4";
import { staticMode, staticSnapshots } from "../static-store";
import { createLogger } from "../../logger";

const logger = createLogger("db.shared-snapshot");

export async function createSnapshot(
    snapshot: Omit<APIv4.SharedBlockSnapshot, "_id">,
): Promise<APIv4.SharedBlockSnapshotId> {
    const snapshotId = uuid4("snap") as APIv4.SharedBlockSnapshotId;
    const fullSnapshot: APIv4.SharedBlockSnapshot = {
        ...snapshot,
        _id: snapshotId,
    };

    if (staticMode) {
        staticSnapshots.set(snapshotId, fullSnapshot);
        logger.info(`Created static snapshot ${snapshotId}`);
        return snapshotId;
    }

    await collections.sharedBlockSnapshots.insertOne(fullSnapshot);
    logger.info(`Created new snapshot ${snapshotId}`);
    return snapshotId;
}

export async function getSnapshotsForAdvisor(
    advisorEmail: string,
): Promise<APIv4.SharedBlockSnapshot[]> {
    if (staticMode) {
        const results: APIv4.SharedBlockSnapshot[] = [];
        for (const snap of staticSnapshots.values()) {
            if (snap.advisorEmail === advisorEmail) {
                results.push(snap);
            }
        }
        return results;
    }

    return collections.sharedBlockSnapshots
        .find({ advisorEmail })
        .toArray();
}

export async function getSnapshotsForStudent(
    studentUserId: string,
): Promise<APIv4.SharedBlockSnapshot[]> {
    if (staticMode) {
        const results: APIv4.SharedBlockSnapshot[] = [];
        for (const snap of staticSnapshots.values()) {
            if (snap.studentUserId === studentUserId) {
                results.push(snap);
            }
        }
        results.sort(
            (a, b) =>
                new Date(b.sharedAt).getTime() -
                new Date(a.sharedAt).getTime(),
        );
        return results;
    }

    return collections.sharedBlockSnapshots
        .find({ studentUserId })
        .sort({ sharedAt: -1 })
        .toArray();
}

export async function deleteSnapshot(
    snapshotId: APIv4.SharedBlockSnapshotId,
    requestingUserId: string,
): Promise<boolean> {
    if (staticMode) {
        const snap = staticSnapshots.get(snapshotId);
        if (!snap) return false;
        if (snap.studentUserId !== requestingUserId) return false;
        staticSnapshots.delete(snapshotId);
        logger.info(`Deleted static snapshot ${snapshotId}`);
        return true;
    }

    const result = await collections.sharedBlockSnapshots.deleteOne({
        _id: snapshotId,
        studentUserId: requestingUserId,
    });
    if (result.deletedCount === 0) return false;
    logger.info(`Deleted snapshot ${snapshotId}`);
    return true;
}

export async function getSnapshot(
    snapshotId: APIv4.SharedBlockSnapshotId,
): Promise<APIv4.SharedBlockSnapshot | null> {
    if (staticMode) {
        return staticSnapshots.get(snapshotId) ?? null;
    }

    return collections.sharedBlockSnapshots.findOne({ _id: snapshotId });
}

export async function addApproval(
    snapshotId: APIv4.SharedBlockSnapshotId,
    approval: APIv4.SnapshotApproval,
): Promise<void> {
    if (staticMode) {
        const snap = staticSnapshots.get(snapshotId);
        if (!snap) throw Error("Snapshot not found");
        if (!snap.approvals) snap.approvals = [];
        snap.approvals.push(approval);
        logger.info(`Added approval to static snapshot ${snapshotId}`);
        return;
    }

    const result = await collections.sharedBlockSnapshots.findOneAndUpdate(
        { _id: snapshotId },
        {
            $push: {
                approvals: approval,
            },
        } as any,
    );
    if (!result.ok || result.value === null)
        throw Error("Snapshot not found");
    logger.info(`Added approval to snapshot ${snapshotId}`);
}
