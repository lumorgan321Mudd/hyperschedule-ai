import { collections } from "../collections";
import { uuid4 } from "../utils";
import * as APIv4 from "hyperschedule-shared/api/v4";
import { staticMode, staticSnapshots } from "../static-store";
import { createLogger } from "../../logger";

const logger = createLogger("db.shared-snapshot");

export async function upsertSnapshot(
    snapshot: Omit<APIv4.SharedBlockSnapshot, "_id">,
    existingSnapshotId?: APIv4.SharedBlockSnapshotId,
): Promise<APIv4.SharedBlockSnapshotId> {
    if (staticMode) {
        // Check if there's an existing snapshot for same student+block+advisor
        let snapshotId = existingSnapshotId;
        if (!snapshotId) {
            for (const [id, snap] of staticSnapshots) {
                if (
                    snap.studentUserId === snapshot.studentUserId &&
                    snap.blockId === snapshot.blockId &&
                    snap.advisorEmail === snapshot.advisorEmail
                ) {
                    snapshotId = id as APIv4.SharedBlockSnapshotId;
                    break;
                }
            }
        }

        if (!snapshotId) {
            snapshotId = uuid4("snap") as APIv4.SharedBlockSnapshotId;
        }

        const fullSnapshot: APIv4.SharedBlockSnapshot = {
            ...snapshot,
            _id: snapshotId,
        };
        staticSnapshots.set(snapshotId, fullSnapshot);
        logger.info(`Upserted static snapshot ${snapshotId}`);
        return snapshotId;
    }

    // MongoDB: upsert by student+block+advisor compound key
    const filter = {
        studentUserId: snapshot.studentUserId,
        blockId: snapshot.blockId,
        advisorEmail: snapshot.advisorEmail,
    };

    const existing = await collections.sharedBlockSnapshots.findOne(filter);

    if (existing) {
        await collections.sharedBlockSnapshots.updateOne(filter, {
            $set: {
                studentEppn: snapshot.studentEppn,
                studentSchool: snapshot.studentSchool,
                blockName: snapshot.blockName,
                college: snapshot.college,
                major: snapshot.major,
                semesters: snapshot.semesters,
                sharedAt: snapshot.sharedAt,
                // Keep existing approvals — advisor will re-review
            },
        });
        logger.info(`Updated existing snapshot ${existing._id}`);
        return existing._id;
    }

    const snapshotId = uuid4("snap") as APIv4.SharedBlockSnapshotId;
    const fullSnapshot: APIv4.SharedBlockSnapshot = {
        ...snapshot,
        _id: snapshotId,
    };
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
