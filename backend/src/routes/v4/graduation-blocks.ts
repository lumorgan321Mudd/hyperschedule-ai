import type { Request, Response } from "@tinyhttp/app";
import { App } from "@tinyhttp/app";
import { json as jsonParser } from "milliparsec";
import * as APIv4 from "hyperschedule-shared/api/v4";
import {
    createBlock,
    updateBlock,
    deleteBlock,
    addSemester,
    updateSemesterSections,
    deleteSemester,
    setShareInfo,
    setRequirementOverride,
    deleteRequirementOverride,
} from "../../db/models/graduation-block";
import { createSnapshot, getSnapshotsForStudent, deleteSnapshot } from "../../db/models/shared-snapshot";
import { getUser } from "../../db/models/user";
import { createLogger } from "../../logger";

const logger = createLogger("routes.graduation-blocks");

const graduationBlocksApp = new App({
    settings: { xPoweredBy: false },
    onError(err: any, req, res) {
        if (Object.hasOwn(err, "code")) return res.status(err.code).end();
        logger.info("Graduation blocks error: %o", err);
        return res.status(400).send(`${err}`);
    },
})
    .use((req: Request, res: Response, next) => {
        res.header(
            "Cache-Control",
            "private,no-cache,no-store,max-age=0,must-revalidate",
        );
        res.header("Access-Control-Allow-Credentials", "true");
        if (req.method === "OPTIONS") {
            res.header(
                "Access-Control-Allow-Methods",
                "GET,POST,PUT,DELETE,PATCH",
            )
                .header("Access-Control-Allow-Headers", "Content-Type")
                .status(204)
                .end();
            return;
        }
        next();
    })
    .use(jsonParser());

// GET / — get all blocks for current user
graduationBlocksApp.get(
    "/",
    async function (request: Request, response: Response) {
        if (request.userToken === null) return response.status(401).end();
        const user = await getUser(request.userToken.uuid);
        return response
            .header("Content-Type", "application/json")
            .send(user.graduationBlocks ?? {});
    },
);

// POST / — create a new block
graduationBlocksApp.post(
    "/",
    async function (request: Request, response: Response) {
        if (request.userToken === null) return response.status(401).end();

        const input = APIv4.CreateBlockRequest.safeParse(request.body);
        if (!input.success)
            return response
                .status(400)
                .header("Content-Type", "application/json")
                .send(input.error);

        const blockId = await createBlock(
            request.userToken.uuid,
            input.data.name,
            input.data.college,
            input.data.major,
            input.data.planType,
            input.data.catalogYear,
        );

        return response
            .header("Content-Type", "application/json")
            .send({ blockId } satisfies APIv4.CreateBlockResponse);
    },
);

// GET /my-snapshots — get all snapshots for current student
graduationBlocksApp.get(
    "/my-snapshots",
    async function (request: Request, response: Response) {
        if (request.userToken === null) return response.status(401).end();
        const snapshots = await getSnapshotsForStudent(
            request.userToken.uuid,
        );
        return response
            .header("Content-Type", "application/json")
            .send({ snapshots } satisfies APIv4.GetMySnapshotsResponse);
    },
);

// DELETE /snapshots/:snapshotId — delete a snapshot (student only)
graduationBlocksApp.delete(
    "/snapshots/:snapshotId",
    async function (request: Request, response: Response) {
        if (request.userToken === null) return response.status(401).end();
        const snapshotId = request.params
            .snapshotId as APIv4.SharedBlockSnapshotId;
        const deleted = await deleteSnapshot(
            snapshotId,
            request.userToken.uuid,
        );
        if (!deleted)
            return response
                .status(404)
                .send("Snapshot not found or not owned by you");
        return response.status(204).end();
    },
);

// PATCH /:blockId — update block metadata
graduationBlocksApp.patch(
    "/:blockId",
    async function (request: Request, response: Response) {
        if (request.userToken === null) return response.status(401).end();

        const blockId = request.params.blockId as APIv4.GraduationBlockId;
        const input = APIv4.UpdateBlockRequest.safeParse({
            ...request.body,
            blockId,
        });
        if (!input.success)
            return response
                .status(400)
                .header("Content-Type", "application/json")
                .send(input.error);

        await updateBlock(request.userToken.uuid, blockId, {
            name: input.data.name,
            college: input.data.college,
            major: input.data.major,
            catalogYear: input.data.catalogYear,
        });

        return response.status(204).end();
    },
);

// DELETE /:blockId — delete a block
graduationBlocksApp.delete(
    "/:blockId",
    async function (request: Request, response: Response) {
        if (request.userToken === null) return response.status(401).end();

        const blockId = request.params.blockId as APIv4.GraduationBlockId;
        await deleteBlock(request.userToken.uuid, blockId);

        return response.status(204).end();
    },
);

// POST /:blockId/semester — add a semester to a block
graduationBlocksApp.post(
    "/:blockId/semester",
    async function (request: Request, response: Response) {
        if (request.userToken === null) return response.status(401).end();

        const blockId = request.params.blockId as APIv4.GraduationBlockId;
        const input = APIv4.AddBlockSemesterRequest.safeParse({
            ...request.body,
            blockId,
        });
        if (!input.success)
            return response
                .status(400)
                .header("Content-Type", "application/json")
                .send(input.error);

        const semesterId = await addSemester(
            request.userToken.uuid,
            blockId,
            input.data.term,
            input.data.name,
            input.data.isFutureTerm,
            input.data.sourceTermNote,
        );

        return response
            .header("Content-Type", "application/json")
            .send({ semesterId } satisfies APIv4.AddBlockSemesterResponse);
    },
);

// PATCH /:blockId/semester/:semId — update semester sections
graduationBlocksApp.patch(
    "/:blockId/semester/:semId",
    async function (request: Request, response: Response) {
        if (request.userToken === null) return response.status(401).end();

        const blockId = request.params.blockId as APIv4.GraduationBlockId;
        const semesterId = request.params.semId as APIv4.BlockSemesterId;
        const input = APIv4.UpdateBlockSemesterRequest.safeParse({
            ...request.body,
            blockId,
            semesterId,
        });
        if (!input.success)
            return response
                .status(400)
                .header("Content-Type", "application/json")
                .send(input.error);

        await updateSemesterSections(
            request.userToken.uuid,
            blockId,
            semesterId,
            input.data.sections,
        );

        return response.status(204).end();
    },
);

// DELETE /:blockId/semester/:semId — delete a semester
graduationBlocksApp.delete(
    "/:blockId/semester/:semId",
    async function (request: Request, response: Response) {
        if (request.userToken === null) return response.status(401).end();

        const blockId = request.params.blockId as APIv4.GraduationBlockId;
        const semesterId = request.params.semId as APIv4.BlockSemesterId;

        await deleteSemester(
            request.userToken.uuid,
            blockId,
            semesterId,
        );

        return response.status(204).end();
    },
);

// PUT /:blockId/requirement-override — set or update a requirement override
graduationBlocksApp.put(
    "/:blockId/requirement-override",
    async function (request: Request, response: Response) {
        if (request.userToken === null) return response.status(401).end();

        const blockId = request.params.blockId as APIv4.GraduationBlockId;
        const input = APIv4.SetRequirementOverrideRequest.safeParse({
            ...request.body,
            blockId,
        });
        if (!input.success)
            return response
                .status(400)
                .header("Content-Type", "application/json")
                .send(input.error);

        const overrideId = await setRequirementOverride(
            request.userToken.uuid,
            blockId,
            {
                requirementGroupName: input.data.requirementGroupName,
                requirementSection: input.data.requirementSection,
                ...(input.data.markedSatisfied !== undefined
                    ? { markedSatisfied: input.data.markedSatisfied }
                    : {}),
                ...(input.data.coursesRequiredOverride !== undefined
                    ? {
                          coursesRequiredOverride:
                              input.data.coursesRequiredOverride,
                      }
                    : {}),
                ...(input.data.addedCourses
                    ? { addedCourses: input.data.addedCourses }
                    : {}),
                ...(input.data.note ? { note: input.data.note } : {}),
            },
        );

        return response
            .header("Content-Type", "application/json")
            .send(
                { overrideId } satisfies APIv4.SetRequirementOverrideResponse,
            );
    },
);

// DELETE /:blockId/requirement-override/:overrideId — remove a requirement override
graduationBlocksApp.delete(
    "/:blockId/requirement-override/:overrideId",
    async function (request: Request, response: Response) {
        if (request.userToken === null) return response.status(401).end();

        const blockId = request.params.blockId as APIv4.GraduationBlockId;
        const overrideId = request.params
            .overrideId as APIv4.RequirementOverrideId;

        await deleteRequirementOverride(
            request.userToken.uuid,
            blockId,
            overrideId,
        );

        return response.status(204).end();
    },
);

// POST /share — share a block with an advisor
graduationBlocksApp.post(
    "/share",
    async function (request: Request, response: Response) {
        if (request.userToken === null) return response.status(401).end();

        const input = APIv4.ShareBlockRequest.safeParse(request.body);
        if (!input.success)
            return response
                .status(400)
                .header("Content-Type", "application/json")
                .send(input.error);

        const user = await getUser(request.userToken.uuid);
        const block = user.graduationBlocks?.[input.data.blockId];
        if (!block)
            return response.status(404).send("Block not found");

        // Create immutable snapshot (deep-copy semesters so edits don't mutate the snapshot)
        const snapshotId = await createSnapshot({
            studentUserId: user._id,
            studentEppn: user.eppn,
            studentSchool: user.school,
            advisorEmail: input.data.advisorEmail,
            blockName: block.name,
            blockId: input.data.blockId,
            college: block.college,
            major: block.major,
            planType: block.planType,
            catalogYear: block.catalogYear,
            semesters: JSON.parse(JSON.stringify(block.semesters)),
            requirementOverrides: block.requirementOverrides
                ? JSON.parse(JSON.stringify(block.requirementOverrides))
                : undefined,
            sharedAt: new Date().toISOString(),
        });

        // Update share info on the block
        await setShareInfo(request.userToken.uuid, input.data.blockId, {
            advisorEmail: input.data.advisorEmail,
            lastSharedAt: new Date().toISOString(),
            snapshotId,
        });

        return response
            .header("Content-Type", "application/json")
            .send({ snapshotId } satisfies APIv4.ShareBlockResponse);
    },
);

export { graduationBlocksApp };
