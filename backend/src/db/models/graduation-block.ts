import { collections } from "../collections";
import { uuid4 } from "../utils";
import * as APIv4 from "hyperschedule-shared/api/v4";
import { staticMode, staticUsers } from "../static-store";
import { createLogger } from "../../logger";
import type { UpdateFilter } from "mongodb";

const logger = createLogger("db.graduation-block");

function getStaticUser(userId: string): APIv4.ServerUser {
    const user = staticUsers.get(userId);
    if (!user) throw Error("User not found");
    return user;
}

function ensureBlocks(
    user: APIv4.ServerUser,
): Record<string, APIv4.GraduationBlock> {
    if (!user.graduationBlocks) user.graduationBlocks = {};
    return user.graduationBlocks;
}

export async function createBlock(
    userId: APIv4.UserId,
    name: string,
    college: APIv4.School,
    major?: string,
    planType?: APIv4.PlanType,
    catalogYear?: string,
): Promise<APIv4.GraduationBlockId> {
    const blockId = uuid4("b") as APIv4.GraduationBlockId;
    const now = new Date().toISOString();
    const block: APIv4.GraduationBlock = {
        name,
        college,
        semesters: {},
        createdAt: now,
        updatedAt: now,
        ...(major ? { major } : {}),
        ...(planType ? { planType } : {}),
        ...(catalogYear ? { catalogYear } : {}),
    };

    if (staticMode) {
        const user = getStaticUser(userId);
        const blocks = ensureBlocks(user);
        blocks[blockId] = block;
        logger.info(`Created static block ${blockId} for user ${userId}`);
    } else {
        await collections.users.updateOne(
            { _id: userId },
            {
                $set: {
                    [`graduationBlocks.${blockId}`]: block,
                },
            } as UpdateFilter<APIv4.ServerUser>,
        );
        logger.info(`Created block ${blockId} for user ${userId}`);
    }
    return blockId;
}

export async function updateBlock(
    userId: APIv4.UserId,
    blockId: APIv4.GraduationBlockId,
    updates: {
        name?: string;
        college?: APIv4.School;
        major?: string;
        catalogYear?: string;
    },
): Promise<void> {
    const now = new Date().toISOString();

    if (staticMode) {
        const user = getStaticUser(userId);
        const blocks = ensureBlocks(user);
        const block = blocks[blockId];
        if (!block) throw Error("Block not found");
        if (updates.name !== undefined) block.name = updates.name;
        if (updates.college !== undefined) block.college = updates.college;
        if (updates.major !== undefined) block.major = updates.major;
        if (updates.catalogYear !== undefined)
            block.catalogYear = updates.catalogYear;
        block.updatedAt = now;
        logger.info(`Updated static block ${blockId} for user ${userId}`);
    } else {
        const setFields: Record<string, unknown> = {
            [`graduationBlocks.${blockId}.updatedAt`]: now,
        };
        if (updates.name !== undefined)
            setFields[`graduationBlocks.${blockId}.name`] = updates.name;
        if (updates.college !== undefined)
            setFields[`graduationBlocks.${blockId}.college`] = updates.college;
        if (updates.major !== undefined)
            setFields[`graduationBlocks.${blockId}.major`] = updates.major;
        if (updates.catalogYear !== undefined)
            setFields[`graduationBlocks.${blockId}.catalogYear`] =
                updates.catalogYear;

        const result = await collections.users.findOneAndUpdate(
            {
                _id: userId,
                [`graduationBlocks.${blockId}`]: { $exists: true },
            },
            { $set: setFields } as UpdateFilter<APIv4.ServerUser>,
        );
        if (!result.ok || result.value === null)
            throw Error("Block not found or update failed");
        logger.info(`Updated block ${blockId} for user ${userId}`);
    }
}

export async function deleteBlock(
    userId: APIv4.UserId,
    blockId: APIv4.GraduationBlockId,
): Promise<void> {
    if (staticMode) {
        const user = getStaticUser(userId);
        const blocks = ensureBlocks(user);
        if (!blocks[blockId]) throw Error("Block not found");
        delete blocks[blockId];
        logger.info(`Deleted static block ${blockId} for user ${userId}`);
    } else {
        const result = await collections.users.findOneAndUpdate(
            {
                _id: userId,
                [`graduationBlocks.${blockId}`]: { $exists: true },
            },
            {
                $unset: {
                    [`graduationBlocks.${blockId}`]: true,
                },
            },
        );
        if (!result.ok || result.value === null)
            throw Error("Block not found or delete failed");
        logger.info(`Deleted block ${blockId} for user ${userId}`);
    }
}

export async function addSemester(
    userId: APIv4.UserId,
    blockId: APIv4.GraduationBlockId,
    term: APIv4.TermIdentifier,
    name: string,
    isFutureTerm?: boolean,
    sourceTermNote?: string,
): Promise<APIv4.BlockSemesterId> {
    const semesterId = uuid4("sem") as APIv4.BlockSemesterId;
    const semester: APIv4.BlockSemester = {
        term,
        name,
        sections: [],
        ...(isFutureTerm ? { isFutureTerm } : {}),
        ...(sourceTermNote ? { sourceTermNote } : {}),
    };
    const now = new Date().toISOString();

    if (staticMode) {
        const user = getStaticUser(userId);
        const blocks = ensureBlocks(user);
        const block = blocks[blockId];
        if (!block) throw Error("Block not found");
        block.semesters[semesterId] = semester;
        block.updatedAt = now;
        logger.info(
            `Added semester ${semesterId} to static block ${blockId}`,
        );
    } else {
        const result = await collections.users.findOneAndUpdate(
            {
                _id: userId,
                [`graduationBlocks.${blockId}`]: { $exists: true },
            },
            {
                $set: {
                    [`graduationBlocks.${blockId}.semesters.${semesterId}`]:
                        semester,
                    [`graduationBlocks.${blockId}.updatedAt`]: now,
                },
            } as UpdateFilter<APIv4.ServerUser>,
        );
        if (!result.ok || result.value === null)
            throw Error("Block not found or add semester failed");
        logger.info(`Added semester ${semesterId} to block ${blockId}`);
    }
    return semesterId;
}

export async function updateSemesterSections(
    userId: APIv4.UserId,
    blockId: APIv4.GraduationBlockId,
    semesterId: APIv4.BlockSemesterId,
    sections: APIv4.UserSection[],
): Promise<void> {
    const now = new Date().toISOString();

    if (staticMode) {
        const user = getStaticUser(userId);
        const blocks = ensureBlocks(user);
        const block = blocks[blockId];
        if (!block) throw Error("Block not found");
        const sem = block.semesters[semesterId];
        if (!sem) throw Error("Semester not found");
        sem.sections = sections;
        block.updatedAt = now;
        logger.info(
            `Updated sections in semester ${semesterId} of static block ${blockId}`,
        );
    } else {
        const result = await collections.users.findOneAndUpdate(
            {
                _id: userId,
                [`graduationBlocks.${blockId}.semesters.${semesterId}`]: {
                    $exists: true,
                },
            },
            {
                $set: {
                    [`graduationBlocks.${blockId}.semesters.${semesterId}.sections`]:
                        sections,
                    [`graduationBlocks.${blockId}.updatedAt`]: now,
                },
            } as UpdateFilter<APIv4.ServerUser>,
        );
        if (!result.ok || result.value === null)
            throw Error("Semester not found or update failed");
        logger.info(
            `Updated sections in semester ${semesterId} of block ${blockId}`,
        );
    }
}

export async function deleteSemester(
    userId: APIv4.UserId,
    blockId: APIv4.GraduationBlockId,
    semesterId: APIv4.BlockSemesterId,
): Promise<void> {
    const now = new Date().toISOString();

    if (staticMode) {
        const user = getStaticUser(userId);
        const blocks = ensureBlocks(user);
        const block = blocks[blockId];
        if (!block) throw Error("Block not found");
        if (!block.semesters[semesterId])
            throw Error("Semester not found");
        delete block.semesters[semesterId];
        block.updatedAt = now;
        logger.info(
            `Deleted semester ${semesterId} from static block ${blockId}`,
        );
    } else {
        const result = await collections.users.findOneAndUpdate(
            {
                _id: userId,
                [`graduationBlocks.${blockId}.semesters.${semesterId}`]: {
                    $exists: true,
                },
            },
            {
                $unset: {
                    [`graduationBlocks.${blockId}.semesters.${semesterId}`]:
                        true,
                },
                $set: {
                    [`graduationBlocks.${blockId}.updatedAt`]: now,
                },
            } as UpdateFilter<APIv4.ServerUser>,
        );
        if (!result.ok || result.value === null)
            throw Error("Semester not found or delete failed");
        logger.info(
            `Deleted semester ${semesterId} from block ${blockId}`,
        );
    }
}

export async function setShareInfo(
    userId: APIv4.UserId,
    blockId: APIv4.GraduationBlockId,
    shareInfo: APIv4.BlockShareInfo,
): Promise<void> {
    if (staticMode) {
        const user = getStaticUser(userId);
        const blocks = ensureBlocks(user);
        const block = blocks[blockId];
        if (!block) throw Error("Block not found");
        if (!block.shares) block.shares = [];
        // Upsert: replace existing share to same advisor or add new
        const idx = block.shares.findIndex(
            (s) => s.advisorEmail === shareInfo.advisorEmail,
        );
        if (idx >= 0) block.shares[idx] = shareInfo;
        else block.shares.push(shareInfo);
        block.updatedAt = new Date().toISOString();
    } else {
        // First remove any existing share to this advisor, then add the new one
        await collections.users.updateOne(
            {
                _id: userId,
                [`graduationBlocks.${blockId}`]: { $exists: true },
            },
            {
                $pull: {
                    [`graduationBlocks.${blockId}.shares`]: {
                        advisorEmail: shareInfo.advisorEmail,
                    },
                },
            } as any,
        );
        await collections.users.updateOne(
            {
                _id: userId,
                [`graduationBlocks.${blockId}`]: { $exists: true },
            },
            {
                $push: {
                    [`graduationBlocks.${blockId}.shares`]: shareInfo,
                },
                $set: {
                    [`graduationBlocks.${blockId}.updatedAt`]:
                        new Date().toISOString(),
                },
            } as any,
        );
    }
    logger.info(
        `Set share info for block ${blockId} -> ${shareInfo.advisorEmail}`,
    );
}

export async function setRequirementOverride(
    userId: APIv4.UserId,
    blockId: APIv4.GraduationBlockId,
    data: Omit<APIv4.RequirementOverride, "createdAt" | "updatedAt">,
): Promise<APIv4.RequirementOverrideId> {
    const now = new Date().toISOString();

    if (staticMode) {
        const user = getStaticUser(userId);
        const blocks = ensureBlocks(user);
        const block = blocks[blockId];
        if (!block) throw Error("Block not found");
        if (!block.requirementOverrides) block.requirementOverrides = {};

        // Check for existing override with same group+section
        let existingId: string | undefined;
        for (const [id, ov] of Object.entries(block.requirementOverrides)) {
            if (
                ov.requirementGroupName === data.requirementGroupName &&
                ov.requirementSection === data.requirementSection
            ) {
                existingId = id;
                break;
            }
        }

        const overrideId = (existingId ??
            uuid4("rov")) as APIv4.RequirementOverrideId;
        block.requirementOverrides[overrideId] = {
            ...data,
            createdAt:
                existingId && block.requirementOverrides[existingId]
                    ? block.requirementOverrides[existingId]!.createdAt
                    : now,
            updatedAt: now,
        };
        block.updatedAt = now;
        logger.info(
            `Set requirement override ${overrideId} on static block ${blockId}`,
        );
        return overrideId;
    }

    // MongoDB: find existing override with same group+section
    const user = await collections.users.findOne({
        _id: userId,
        [`graduationBlocks.${blockId}`]: { $exists: true },
    });
    if (!user) throw Error("Block not found");
    const block = user.graduationBlocks?.[blockId];
    if (!block) throw Error("Block not found");

    let existingId: string | undefined;
    if (block.requirementOverrides) {
        for (const [id, ov] of Object.entries(block.requirementOverrides)) {
            if (
                ov.requirementGroupName === data.requirementGroupName &&
                ov.requirementSection === data.requirementSection
            ) {
                existingId = id;
                break;
            }
        }
    }

    const overrideId = (existingId ??
        uuid4("rov")) as APIv4.RequirementOverrideId;
    const override: APIv4.RequirementOverride = {
        ...data,
        createdAt:
            existingId && block.requirementOverrides?.[existingId]
                ? block.requirementOverrides[existingId]!.createdAt
                : now,
        updatedAt: now,
    };

    await collections.users.updateOne(
        { _id: userId },
        {
            $set: {
                [`graduationBlocks.${blockId}.requirementOverrides.${overrideId}`]:
                    override,
                [`graduationBlocks.${blockId}.updatedAt`]: now,
            },
        } as UpdateFilter<APIv4.ServerUser>,
    );
    logger.info(
        `Set requirement override ${overrideId} on block ${blockId}`,
    );
    return overrideId;
}

export async function deleteRequirementOverride(
    userId: APIv4.UserId,
    blockId: APIv4.GraduationBlockId,
    overrideId: APIv4.RequirementOverrideId,
): Promise<void> {
    const now = new Date().toISOString();

    if (staticMode) {
        const user = getStaticUser(userId);
        const blocks = ensureBlocks(user);
        const block = blocks[blockId];
        if (!block) throw Error("Block not found");
        if (!block.requirementOverrides?.[overrideId])
            throw Error("Override not found");
        delete block.requirementOverrides[overrideId];
        block.updatedAt = now;
        logger.info(
            `Deleted requirement override ${overrideId} from static block ${blockId}`,
        );
        return;
    }

    const result = await collections.users.findOneAndUpdate(
        {
            _id: userId,
            [`graduationBlocks.${blockId}.requirementOverrides.${overrideId}`]:
                { $exists: true },
        },
        {
            $unset: {
                [`graduationBlocks.${blockId}.requirementOverrides.${overrideId}`]:
                    true,
            },
            $set: {
                [`graduationBlocks.${blockId}.updatedAt`]: now,
            },
        } as UpdateFilter<APIv4.ServerUser>,
    );
    if (!result.ok || result.value === null)
        throw Error("Override not found or delete failed");
    logger.info(
        `Deleted requirement override ${overrideId} from block ${blockId}`,
    );
}

