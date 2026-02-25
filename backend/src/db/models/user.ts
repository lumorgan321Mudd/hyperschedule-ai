import { collections } from "../collections";
import { uuid4 } from "../utils";
import * as APIv4 from "hyperschedule-shared/api/v4";
import type { UserRole } from "hyperschedule-shared/api/v4";

import { createLogger } from "../../logger";
import { CURRENT_TERM } from "hyperschedule-shared/api/current-term";
import { staticMode, staticUsers } from "../static-store";
import type { UpdateFilter } from "mongodb";

const logger = createLogger("db.user");

function filterUserWithSchedule(
    userId: APIv4.UserId,
    scheduleId: APIv4.ScheduleId,
): Record<string, string | { $exists: true }> {
    return {
        _id: userId,
        [`schedules.${scheduleId}`]: { $exists: true },
    };
}

export async function getOrCreateUser(
    eppn: string,
    orgName: string,
): Promise<APIv4.UserId> {
    const lookup = await collections.users.findOne({
        eppn,
    });
    if (lookup !== null) {
        logger.info(`Found user ${lookup._id} for ${eppn}`);
        return lookup._id;
    }

    const uid = uuid4("u");
    const scheduleId = uuid4("s");
    let school: APIv4.School = APIv4.School.Unknown;
    switch (orgName) {
        case "Harvey Mudd College":
            school = APIv4.School.HMC;
            break;
        case "Scripps College":
            school = APIv4.School.SCR;
            break;
        case "Pomona College":
            school = APIv4.School.POM;
            break;
        case "Pitzer College":
            school = APIv4.School.PTZ;
            break;
        case "Claremont McKenna College":
            school = APIv4.School.CMC;
            break;
    }

    const user: APIv4.ServerUser = {
        _id: uid,
        schedules: {
            [scheduleId]: {
                term: CURRENT_TERM,
                name: "Schedule 1",
                sections: [],
            },
        },
        eppn,
        school,
    };

    const res = await collections.users.insertOne(user);

    if (res.insertedId.toString() !== uid) {
        logger.error(
            `Error inserting guest user into database. Requested ID is ${uid}, resulted id is ${res.insertedId}`,
        );
        throw Error(`Database error: mismatching insertion id`);
    }

    return uid;
}

export async function getUser(userId: string): Promise<APIv4.ServerUser> {
    if (staticMode) {
        const user = staticUsers.get(userId);
        if (!user) throw Error("User not found");
        return user;
    }

    const user = await collections.users.findOne({ _id: userId });
    if (user === null) {
        throw Error("User not found");
    }
    return user;
}

export async function updateUser(
    userId: APIv4.UserId,
    updateFields: Partial<APIv4.ServerUser>,
): Promise<void> {
    if (staticMode) {
        const user = staticUsers.get(userId);
        if (!user) throw new Error(`User with ID ${userId} not found`);
        Object.assign(user, updateFields);
        logger.info(
            `Updated static user ${userId} with fields: ${JSON.stringify(updateFields)}`,
        );
        return;
    }

    const lookup = await collections.users.findOne({ _id: userId });

    if (lookup === null) {
        throw new Error(`User with ID ${userId} not found`);
    }

    if (Object.keys(updateFields).length > 0) {
        await collections.users.updateOne(
            { _id: userId },
            { $set: updateFields },
        );
        logger.info(
            `Updated user ${userId} with fields: ${JSON.stringify(
                updateFields,
            )}`,
        );
    } else {
        logger.warn(`No fields to update for user ${userId}`);
    }
}

export async function addSchedule(
    userId: APIv4.UserId,
    term: APIv4.TermIdentifier,
    scheduleName: string,
): Promise<APIv4.ScheduleId> {
    if (staticMode) {
        const user = staticUsers.get(userId);
        if (!user) throw Error("User not found");
        if (Object.keys(user.schedules).length >= 100)
            throw Error("Schedule limit reached");
        const scheduleId = uuid4("s");
        user.schedules[scheduleId] = {
            term,
            name: scheduleName,
            sections: [],
        };
        logger.info(
            `Added static schedule ${scheduleName} (${APIv4.stringifyTermIdentifier(term)}) for user ${userId}. ID: ${scheduleId}`,
        );
        return scheduleId;
    }

    const user = await getUser(userId);
    logger.info(
        `Adding schedule ${scheduleName} (${APIv4.stringifyTermIdentifier(
            term,
        )}) for user ${userId}`,
    );

    const scheduleId = uuid4("s");

    const numberOfSchedules = Object.keys(user.schedules).length;
    if (numberOfSchedules >= 100) {
        logger.warn(`User ${userId} reached schedule limit`);
        throw Error("Schedule limit reached");
    }

    const result = await collections.users.findOneAndUpdate(
        {
            _id: userId,
            [`schedules.${scheduleId}`]: {
                $exists: false,
            },
        },
        [
            // we need to make this an array so we can use aggregation pipeline methods (namely $cond) in here
            {
                $set: {
                    [`schedules.${scheduleId}`]: {
                        term,
                        name: scheduleName,
                        sections: [],
                    } satisfies APIv4.UserSchedule,
                    activeSchedule: {
                        $cond: {
                            if: { $eq: ["$activeSchedule", null] },
                            then: scheduleId,
                            else: "$activeSchedule",
                        },
                    },
                } as UpdateFilter<APIv4.ServerUser>,
            },
        ],
    );

    if (!result.ok || result.value === null) {
        logger.warn(`Operation failed`, result);
        throw Error("Database operation failed");
    }
    logger.info(
        `Addition of schedule ${scheduleName} (${APIv4.stringifyTermIdentifier(
            term,
        )}) for user ${userId} completed. New schedule ID is ${scheduleId}`,
    );
    return scheduleId;
}

export async function renameSchedule(
    userId: APIv4.UserId,
    scheduleId: APIv4.ScheduleId,
    newName: string,
): Promise<void> {
    if (staticMode) {
        const user = staticUsers.get(userId);
        if (!user || !user.schedules[scheduleId])
            throw Error("User with this schedule not found");
        user.schedules[scheduleId]!.name = newName;
        logger.info(
            `Renamed static schedule ${scheduleId} for user ${userId} to "${newName}"`,
        );
        return;
    }

    logger.info(
        `Renaming schedule ${scheduleId} for user ${userId} to "${newName}"`,
    );

    const result = await collections.users.findOneAndUpdate(
        filterUserWithSchedule(userId, scheduleId),
        {
            $set: {
                [`schedules.${scheduleId}.name`]: newName,
            },
        } as UpdateFilter<APIv4.ServerUser>,
    );

    if (!result.ok || result.value === null) {
        logger.warn(`Operation failed`, result);
        throw Error("Database operation failed");
    }
}

export async function addSection(
    userId: APIv4.UserId,
    scheduleId: APIv4.ScheduleId,
    section: APIv4.SectionIdentifier,
): Promise<void> {
    if (staticMode) {
        const user = staticUsers.get(userId);
        if (!user || !user.schedules[scheduleId])
            throw Error("User with this schedule not found");
        const schedule = user.schedules[scheduleId]!;
        if (
            schedule.term.term !== section.term ||
            schedule.term.year !== section.year
        )
            throw Error(
                "Section to be added does not have the same term as the schedule",
            );
        const key = APIv4.stringifySectionCodeLong(section);
        const exists = schedule.sections.some(
            (s) => APIv4.stringifySectionCodeLong(s.section) === key,
        );
        if (!exists)
            schedule.sections.push({
                attrs: { selected: true },
                section,
            });
        return;
    }

    const user = await collections.users.findOne(
        filterUserWithSchedule(userId, scheduleId),
    );
    if (user === null) {
        throw Error("User with this schedule not found");
    }
    logger.info(
        `Adding section ${APIv4.stringifySectionCodeLong(
            section,
        )} to ${scheduleId} for user ${userId}`,
    );

    const schedule = user.schedules[scheduleId]!;
    if (
        schedule.term.term !== section.term ||
        schedule.term.year !== section.year
    ) {
        logger.warn(
            `Operation failed. Section ${APIv4.stringifySectionCodeLong(
                section,
            )} is not compatible with schedule ${scheduleId}`,
        );
        throw Error(
            "Section to be added does not have the same term as the schedule",
        );
    }

    const result = await collections.users.findOneAndUpdate(
        filterUserWithSchedule(userId, scheduleId),
        {
            $addToSet: {
                [`schedules.${scheduleId}.sections`]: {
                    attrs: { selected: true },
                    section: section,
                } satisfies APIv4.UserSection,
            },
        },
    );

    if (!result.ok || result.value === null) {
        logger.warn(`Operation failed`, result);
        throw Error("Database operation failed");
    }
    logger.info(
        `Addition of section ${APIv4.stringifySectionCodeLong(
            section,
        )} to ${scheduleId} for user ${userId} completed`,
    );
}

export async function deleteSchedule(
    userId: APIv4.UserId,
    scheduleId: APIv4.ScheduleId,
): Promise<void> {
    if (staticMode) {
        const user = staticUsers.get(userId);
        if (!user || !user.schedules[scheduleId])
            throw Error("User with this schedule not found");
        delete user.schedules[scheduleId];
        logger.info(
            `Deleted static schedule ${scheduleId} for user ${userId}`,
        );
        return;
    }

    const user = await collections.users.findOne(
        filterUserWithSchedule(userId, scheduleId),
    );

    if (user === null) {
        throw Error("User with this schedule not found");
    }

    logger.info(`Deleting schedule ${scheduleId} for user ${userId}`);

    const result = await collections.users.findOneAndUpdate(
        {
            _id: userId,
        },
        {
            $unset: {
                [`schedules.${scheduleId}`]: true,
            },
        },
    );

    if (!result.ok || result.value === null) {
        logger.warn(`Operation failed`, result);
        throw Error("Database operation failed");
    }
    logger.info(
        `Deletion of schedule ${scheduleId} for user ${userId} completed`,
    );
}

// used by frontend to reorder sections
export async function replaceSections(
    userId: APIv4.UserId,
    scheduleId: APIv4.ScheduleId,
    sections: APIv4.UserSection[],
): Promise<void> {
    if (staticMode) {
        const user = staticUsers.get(userId);
        if (!user || !user.schedules[scheduleId])
            throw Error("User with this schedule not found");
        user.schedules[scheduleId]!.sections = sections;
        logger.info(`Replaced static sections for ${userId}`);
        return;
    }

    logger.info(`Replacing sections for ${userId}`);
    const user = await collections.users.findOne(
        filterUserWithSchedule(userId, scheduleId),
    );
    if (user === null) {
        throw Error("User with this schedule not found");
    }
    const result = await collections.users.findOneAndUpdate(
        filterUserWithSchedule(userId, scheduleId),
        {
            $set: {
                [`schedules.${scheduleId}.sections`]: sections,
            },
        } as UpdateFilter<APIv4.ServerUser>,
    );

    if (!result.ok || result.value === null) {
        logger.warn(`Operation failed`, result);
        throw Error("Database operation failed");
    }
    logger.info(`Replacing sections for ${userId} completed`);
}

export async function duplicateSchedule(
    userId: APIv4.UserId,
    fromScheduleId: APIv4.ScheduleId,
    scheduleName: string,
): Promise<APIv4.ScheduleId> {
    if (staticMode) {
        const user = staticUsers.get(userId);
        if (!user || !user.schedules[fromScheduleId])
            throw Error("User with this schedule not found");
        const schedule = user.schedules[fromScheduleId]!;
        const scheduleId = uuid4("s");
        user.schedules[scheduleId] = {
            name: scheduleName,
            term: schedule.term,
            sections: [...schedule.sections],
        };
        logger.info(
            `Duplicated static schedule ${fromScheduleId} to ${scheduleId} for user ${userId}`,
        );
        return scheduleId;
    }

    const user = await collections.users.findOne(
        filterUserWithSchedule(userId, fromScheduleId),
    );
    if (user === null) {
        throw Error("User with this schedule not found");
    }

    const schedule = user.schedules[fromScheduleId]!;

    return batchAddSectionsToNewSchedule(
        userId,
        schedule.sections,
        schedule.term,
        scheduleName,
    );
}

export async function batchAddSectionsToNewSchedule(
    userId: APIv4.UserId,
    sections: APIv4.UserSection[],
    term: APIv4.TermIdentifier,
    scheduleName: string,
): Promise<APIv4.ScheduleId> {
    if (staticMode) {
        const user = staticUsers.get(userId);
        if (!user) throw Error("User not found");
        const scheduleId = uuid4("s");
        user.schedules[scheduleId] = { name: scheduleName, term, sections };
        logger.info(
            `Batch-imported static sections for user ${userId}. Schedule ID: ${scheduleId}`,
        );
        return scheduleId;
    }

    logger.info(`Batch-importing sections for user ${userId}, %o`, sections);
    const scheduleId = uuid4("s");
    const result = await collections.users.findOneAndUpdate(
        {
            _id: userId,
        },

        {
            $set: {
                [`schedules.${scheduleId}`]: {
                    name: scheduleName,
                    term: term,
                    sections,
                } satisfies APIv4.UserSchedule,
            },
        } as UpdateFilter<APIv4.ServerUser>,
    );

    if (!result.ok || result.value === null) {
        logger.warn(`Operation failed`, result);
        throw Error("Database operation failed");
    }
    logger.info(`Batch-importing sections for user ${userId} completed`);
    return scheduleId;
}

export async function deleteSection(
    userId: APIv4.UserId,
    scheduleId: APIv4.ScheduleId,
    section: APIv4.SectionIdentifier,
): Promise<void> {
    if (staticMode) {
        const user = staticUsers.get(userId);
        if (!user || !user.schedules[scheduleId])
            throw Error("User with this schedule not found");
        const schedule = user.schedules[scheduleId]!;
        const key = APIv4.stringifySectionCodeLong(section);
        schedule.sections = schedule.sections.filter(
            (s) => APIv4.stringifySectionCodeLong(s.section) !== key,
        );
        logger.info(
            `Deleted static section ${key} from ${scheduleId} for user ${userId}`,
        );
        return;
    }

    const user = await collections.users.findOne(
        filterUserWithSchedule(userId, scheduleId),
    );
    if (user === null) {
        throw Error("User with this schedule not found");
    }

    logger.info(
        `Deleting ${APIv4.stringifySectionCodeLong(
            section,
        )} from schedule ${scheduleId} for user ${userId}`,
    );

    const result = await collections.users.findOneAndUpdate(
        {
            _id: userId,
            [`schedules.${scheduleId}.sections`]: { $elemMatch: { section } },
        },
        {
            $pull: {
                [`schedules.${scheduleId}.sections`]: { section },
            },
        },
    );
    if (!result.ok || result.value === null) {
        logger.warn(`Operation failed`, result);
        throw Error("Database operation failed");
    }
    logger.info(
        `Deletion of ${APIv4.stringifySectionCodeLong(
            section,
        )} from schedule ${scheduleId} for user ${userId} completed`,
    );
}

export async function setSectionAttrs(
    userId: APIv4.UserId,
    scheduleId: APIv4.ScheduleId,
    sectionId: APIv4.SectionIdentifier,
    attrs: Partial<APIv4.UserSectionAttrs>,
): Promise<void> {
    if (staticMode) {
        const user = staticUsers.get(userId);
        if (!user || !user.schedules[scheduleId])
            throw Error("User with this schedule not found");
        const schedule = user.schedules[scheduleId]!;
        const key = APIv4.stringifySectionCodeLong(sectionId);
        const entry = schedule.sections.find(
            (s) => APIv4.stringifySectionCodeLong(s.section) === key,
        );
        if (entry) entry.attrs = { ...entry.attrs, ...attrs };
        return;
    }

    const user = await collections.users.findOne(
        filterUserWithSchedule(userId, scheduleId),
    );
    if (user === null) {
        throw Error("User with this schedule not found");
    }

    logger.info(
        `Setting attributes %o of ${APIv4.stringifySectionCodeLong(
            sectionId,
        )} in ${scheduleId} for ${userId}`,
        attrs,
    );

    const result = await collections.users.findOneAndUpdate(
        {
            _id: userId,
            [`schedules.${scheduleId}.sections`]: {
                $elemMatch: {
                    section: sectionId,
                },
            },
        },
        {
            $set: {
                [`schedules.${scheduleId}.sections.$.attrs`]: attrs,
            },
        } as UpdateFilter<APIv4.ServerUser>,
    );

    if (!result.ok || result.value === null) {
        logger.warn(`Operation failed`, result);
        throw Error("Database operation failed");
    }
    logger.info(
        `Setting attributes %o of ${APIv4.stringifySectionCodeLong(
            sectionId,
        )} in ${scheduleId} for ${userId} completed`,
        attrs,
    );
}

export async function findDuplicatesWith<K extends keyof APIv4.ServerUser>(
    key: K,
): Promise<APIv4.ServerUser[][]> {
    const result = await collections.users
        .aggregate([
            {
                $group: {
                    _id: `$${key}`, // Group by the key value
                    count: { $sum: 1 },
                    users: { $push: "$$ROOT" }, // Collect users with the same key value
                },
            },
            {
                $match: {
                    count: { $gt: 1 },
                },
            },
            {
                $project: {
                    _id: 0, // Remove the _id field from the result
                    users: 1, // Only return the array of users
                },
            },
        ])
        .toArray();

    return result.map((group) => group.users);
}

export async function makeAllEPPNLowercase(): Promise<void> {
    await collections.users.updateMany({ eppn: { $regex: /[A-Z]/ } }, [
        {
            $set: {
                eppn: { $toLower: "$eppn" },
            },
        },
    ]);
}

export async function copySchedules(
    fromUserId: APIv4.UserId,
    toUserId: APIv4.UserId,
): Promise<void> {
    const fromUserSchedules = (await getUser(fromUserId)).schedules;
    const toUserSchedules = (await getUser(toUserId)).schedules;

    for (const [scheduleId, schedule] of Object.entries(fromUserSchedules)) {
        if (!toUserSchedules[scheduleId]) {
            toUserSchedules[scheduleId] = schedule;
        }
    }

    await collections.users.updateOne(
        { _id: toUserId },
        {
            $set: {
                schedules: toUserSchedules,
            },
        },
    );
}

export async function setUserRole(
    userId: APIv4.UserId,
    role: UserRole,
): Promise<void> {
    if (staticMode) {
        const user = staticUsers.get(userId);
        if (!user) throw Error("User not found");
        user.role = role;
        logger.info(`Set static user ${userId} role to ${role}`);
        return;
    }

    const result = await collections.users.findOneAndUpdate(
        { _id: userId },
        { $set: { role } } as UpdateFilter<APIv4.ServerUser>,
    );
    if (!result.ok || result.value === null)
        throw Error("User not found");
    logger.info(`Set user ${userId} role to ${role}`);
}

export async function getUserByEppn(
    eppn: string,
): Promise<APIv4.ServerUser | null> {
    if (staticMode) {
        for (const user of staticUsers.values()) {
            if (user.eppn === eppn) return user;
        }
        return null;
    }

    return collections.users.findOne({ eppn });
}
