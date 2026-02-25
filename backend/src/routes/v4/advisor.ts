import type { Request, Response } from "@tinyhttp/app";
import { App } from "@tinyhttp/app";
import { json as jsonParser } from "milliparsec";
import * as APIv4 from "hyperschedule-shared/api/v4";
import { setUserRole, getUser } from "../../db/models/user";
import {
    getSnapshotsForAdvisor,
    getSnapshot,
    addApproval,
} from "../../db/models/shared-snapshot";
import { updateShareApproval } from "../../db/models/graduation-block";
import { createLogger } from "../../logger";

const logger = createLogger("routes.advisor");

const advisorApp = new App({
    settings: { xPoweredBy: false },
    onError(err: any, req, res) {
        if (Object.hasOwn(err, "code")) return res.status(err.code).end();
        logger.info("Advisor error: %o", err);
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
                "GET,POST,PATCH",
            )
                .header("Access-Control-Allow-Headers", "Content-Type")
                .status(204)
                .end();
            return;
        }
        next();
    })
    .use(jsonParser());

// PATCH /role — set the calling user's role
advisorApp.patch(
    "/role",
    async function (request: Request, response: Response) {
        if (request.userToken === null) return response.status(401).end();

        const input = APIv4.SetUserRoleRequest.safeParse(request.body);
        if (!input.success)
            return response
                .status(400)
                .header("Content-Type", "application/json")
                .send(input.error);

        await setUserRole(request.userToken.uuid, input.data.role);
        return response.status(204).end();
    },
);

// GET /shared-snapshots — get all snapshots shared with this advisor
advisorApp.get(
    "/shared-snapshots",
    async function (request: Request, response: Response) {
        if (request.userToken === null) return response.status(401).end();

        const user = await getUser(request.userToken.uuid);

        // Match snapshots by advisor's eppn (email)
        const snapshots = await getSnapshotsForAdvisor(user.eppn);

        return response
            .header("Content-Type", "application/json")
            .send({
                snapshots,
            } satisfies APIv4.GetSharedSnapshotsResponse);
    },
);

// POST /shared-snapshots/:snapshotId/approve — approve or reject a snapshot
advisorApp.post(
    "/shared-snapshots/:snapshotId/approve",
    async function (request: Request, response: Response) {
        if (request.userToken === null) return response.status(401).end();

        const snapshotId = request.params
            .snapshotId as APIv4.SharedBlockSnapshotId;
        const input = APIv4.SnapshotApprovalRequest.safeParse({
            ...request.body,
            snapshotId,
        });
        if (!input.success)
            return response
                .status(400)
                .header("Content-Type", "application/json")
                .send(input.error);

        // Verify this advisor has access to this snapshot
        const user = await getUser(request.userToken.uuid);
        const snapshot = await getSnapshot(snapshotId);
        if (!snapshot)
            return response.status(404).send("Snapshot not found");
        if (snapshot.advisorEmail !== user.eppn)
            return response.status(403).send("Not authorized");

        const approval: APIv4.SnapshotApproval = {
            advisorId: user._id,
            advisorEppn: user.eppn,
            advisorName: input.data.advisorName,
            status: input.data.status,
            comment: input.data.comment,
            signature: input.data.signature,
            timestamp: new Date().toISOString(),
        };

        await addApproval(snapshotId, approval);

        // Update the student's BlockShareInfo with approval status
        await updateShareApproval(
            snapshot.studentUserId,
            snapshot.blockId,
            snapshot.advisorEmail,
            {
                approvalStatus: input.data.status,
                approvalComment: input.data.comment,
                approvalAdvisorName: input.data.advisorName,
                approvalTimestamp: approval.timestamp,
            },
        );

        return response.status(201).end();
    },
);

export { advisorApp };
