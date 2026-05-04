import type { Request, Response, NextFunction } from "@tinyhttp/app";
import { App } from "@tinyhttp/app";
import {
    addSchedule,
    addSection,
    deleteSchedule,
    deleteSection,
    getUser,
    renameSchedule,
    replaceSections,
    setSectionAttrs,
    duplicateSchedule,
} from "../../db/models/user";
import {
    createScheduleSnapshot,
    getScheduleSnapshotsForStudent,
    deleteScheduleSnapshot,
} from "../../db/models/shared-schedule-snapshot";
import {
    createHsaSubmission,
    getHsaSubmissionsForStudent,
    deleteHsaSubmission,
} from "../../db/models/hsa-submission";
import {
    studentHasAcceptedAdvisorByEmail,
    getAcceptedLinkByStudentAndAdvisorEmail,
} from "../../db/models/advisor-link";
import { createLogger } from "../../logger";
import { json as jsonParser } from "milliparsec";
import * as APIv4 from "hyperschedule-shared/api/v4";
import { AUTH_TOKEN_COOKIE_NAME } from "hyperschedule-shared/api/constants";
import { COOKIE_DOMAIN } from "../cookie-domain";

const logger = createLogger("server.route.user");

const userApp = new App({
    settings: { xPoweredBy: false },
    onError(err: any, req, res) {
        // apparently tinyhttp will throw an object {code: 404} when the route doesn't match anything
        if (Object.hasOwn(err, "code")) return res.status(err.code).end();
        // a lot of database methods can throw errors, and we don't
        // want 500 status
        logger.info("User error: %o", err);
        return res.status(400).send(`${err}`);
    },
}).use((req: Request, res: Response, next: NextFunction) => {
    // middleware to add this header to everything under this app
    res.header(
        "Cache-Control",
        "private,no-cache,no-store,max-age=0,must-revalidate",
    );
    res.header("Access-Control-Allow-Credentials", "true");
    // handle preflight requests
    if (req.method === "OPTIONS") {
        res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,PATCH")
            .status(204)
            .end();
        return;
    }
    next();
});

userApp.get("/", async function (request: Request, response: Response) {
    if (request.userToken === null) return response.status(401).end();
    let user: APIv4.ServerUser;
    try {
        user = await getUser(request.userToken.uuid);
    } catch (e) {
        logger.error(
            "Cannot find user %s with a valid server signature",
            request.userToken.uuid,
        );
        return response
            .status(401)
            .cookie(AUTH_TOKEN_COOKIE_NAME, "", {
                maxAge: 0,
                domain: COOKIE_DOMAIN,
            })
            .end();
    }
    const {
        passwordHash: _pwh,
        passwordResetTokenHash: _prth,
        passwordResetExpiry: _pre,
        ...safeUser
    } = user;
    return response
        .header("Content-Type", "application/json")
        .send(safeUser);
});

userApp
    .route("/schedule")
    .use(jsonParser()) // we need to add this so it can parse json requests
    .post(async function (request: Request, response: Response) {
        if (request.userToken === null) return response.status(401).end();

        const input = APIv4.AddScheduleRequest.safeParse(request.body);
        if (!input.success)
            return response
                .status(400)
                .header("Content-Type", "application/json")
                .send(input.error);

        const scheduleId = await addSchedule(
            request.userToken.uuid,
            input.data.term,
            input.data.name,
        );

        response
            .header("Content-Type", "application/json")
            .send({ scheduleId } satisfies APIv4.AddScheduleResponse);
    })
    .patch(async function (request: Request, response: Response) {
        if (request.userToken === null) return response.status(401).end();

        const input = APIv4.RenameScheduleRequest.safeParse(request.body);
        if (!input.success)
            return response
                .status(400)
                .header("Content-Type", "application/json")
                .send(input.error);

        await renameSchedule(
            request.userToken.uuid,
            input.data.scheduleId,
            input.data.name,
        );
        return response.status(204).end();
    })
    .delete(async function (request: Request, response: Response) {
        if (request.userToken === null) return response.status(401).end();

        const input = APIv4.DeleteScheduleRequest.safeParse(request.body);
        if (!input.success)
            return response
                .status(400)
                .header("Content-Type", "application/json")
                .send(input.error);

        await deleteSchedule(request.userToken.uuid, input.data.scheduleId);
        return response.status(204).end();
    })
    .put(async function (request: Request, response: Response) {
        if (request.userToken === null) return response.status(401).end();

        const input = APIv4.DuplicateScheduleRequest.safeParse(request.body);
        if (!input.success)
            return response
                .status(400)
                .header("Content-Type", "application/json")
                .send(input.error);

        const scheduleId = await duplicateSchedule(
            request.userToken.uuid,
            input.data.scheduleId,
            input.data.name,
        );
        return response
            .header("Content-Type", "application/json")
            .send({ scheduleId } satisfies APIv4.DuplicateScheduleResponse);
    });

userApp
    .route("/section")
    .use(jsonParser()) // we need to add this so it can parse json requests
    .post(async function (request: Request, response: Response) {
        if (request.userToken === null) return response.status(401).end();
        const input = APIv4.AddSectionRequest.safeParse(request.body);
        if (!input.success)
            return response
                .status(400)
                .header("Content-Type", "application/json")
                .send(input.error);

        await addSection(
            request.userToken.uuid,
            input.data.scheduleId,
            input.data.section,
        );

        return response.status(201).end();
    })
    .delete(async function (request: Request, response: Response) {
        if (request.userToken === null) return response.status(401).end();

        const input = APIv4.DeleteSectionRequest.safeParse(request.body);
        if (!input.success)
            return response
                .status(400)
                .header("Content-Type", "application/json")
                .send(input.error);

        await deleteSection(
            request.userToken.uuid,
            input.data.scheduleId,
            input.data.section,
        );

        return response.status(204).end();
    })
    .patch(async function (request: Request, response: Response) {
        if (request.userToken === null) return response.status(401).end();

        const input = APIv4.SetSectionAttrRequest.safeParse(request.body);
        if (!input.success)
            return response
                .status(400)
                .header("Content-Type", "application/json")
                .send(input.error);

        await setSectionAttrs(
            request.userToken.uuid,
            input.data.scheduleId,
            input.data.section,
            input.data.attrs,
        );

        return response.status(204).end();
    });

userApp
    .route("/replace-sections")
    .use(jsonParser()) // we need to add this so it can parse json requests
    .post(async function (request: Request, response: Response) {
        if (request.userToken === null) return response.status(401).end();
        const input = APIv4.ReplaceSectionsRequest.safeParse(request.body);
        if (!input.success)
            return response
                .status(400)
                .header("Content-Type", "application/json")
                .send(input.error);

        await replaceSections(
            request.userToken.uuid,
            input.data.scheduleId,
            input.data.sections,
        );
        response.status(204).end();
    });

// POST /schedule-share — share a schedule with an advisor
userApp.post(
    "/schedule-share",
    jsonParser(),
    async function (request: Request, response: Response) {
        if (request.userToken === null) return response.status(401).end();

        const input = APIv4.ShareScheduleRequest.safeParse(request.body);
        if (!input.success)
            return response
                .status(400)
                .header("Content-Type", "application/json")
                .send(input.error);

        const user = await getUser(request.userToken.uuid);
        const schedule = user.schedules[input.data.scheduleId];
        if (!schedule)
            return response.status(404).send("Schedule not found");

        const linked = await studentHasAcceptedAdvisorByEmail(
            user._id,
            input.data.advisorEmail,
        );
        if (!linked) {
            return response.status(403).json({
                error: "You must have an accepted link with this advisor before sharing.",
            });
        }

        const snapshotId = await createScheduleSnapshot({
            studentUserId: user._id,
            studentEppn: user.email ?? user.eppn ?? "",
            studentSchool: user.school,
            advisorEmail: input.data.advisorEmail,
            scheduleId: input.data.scheduleId,
            scheduleName: schedule.name,
            term: schedule.term,
            sections: JSON.parse(JSON.stringify(schedule.sections)),
            sharedAt: new Date().toISOString(),
        });

        return response
            .header("Content-Type", "application/json")
            .send({ snapshotId } satisfies APIv4.ShareScheduleResponse);
    },
);

// GET /my-schedule-snapshots — student lists schedules they've shared
userApp.get(
    "/my-schedule-snapshots",
    async function (request: Request, response: Response) {
        if (request.userToken === null) return response.status(401).end();

        const snapshots = await getScheduleSnapshotsForStudent(
            request.userToken.uuid,
        );

        return response
            .header("Content-Type", "application/json")
            .send({ snapshots } satisfies APIv4.GetScheduleSnapshotsResponse);
    },
);

// DELETE /schedule-snapshots/:snapshotId — student withdraws a share
userApp.delete(
    "/schedule-snapshots/:snapshotId",
    async function (request: Request, response: Response) {
        if (request.userToken === null) return response.status(401).end();

        const snapshotId = request.params
            .snapshotId as APIv4.SharedScheduleSnapshotId;
        const deleted = await deleteScheduleSnapshot(
            snapshotId,
            request.userToken.uuid,
        );
        if (!deleted) return response.status(404).end();
        return response.status(204).end();
    },
);

// POST /hsa-submission — student sends HSA plan to an HSA-typed advisor
userApp.post(
    "/hsa-submission",
    jsonParser(),
    async function (request: Request, response: Response) {
        if (request.userToken === null) return response.status(401).end();

        const input = APIv4.ShareHsaSubmissionRequest.safeParse(request.body);
        if (!input.success)
            return response
                .status(400)
                .header("Content-Type", "application/json")
                .send(input.error);

        const user = await getUser(request.userToken.uuid);

        const link = await getAcceptedLinkByStudentAndAdvisorEmail(
            user._id,
            input.data.advisorEmail,
        );
        if (!link) {
            return response.status(403).json({
                error: "You must have an accepted link with this advisor before sharing.",
            });
        }
        if (link.advisorType !== "hsa") {
            return response.status(403).json({
                error: "This advisor is not marked as your HSA advisor.",
            });
        }

        const submissionId = await createHsaSubmission({
            studentUserId: user._id,
            studentUsername: user.username ?? user.eppn ?? "",
            advisorId: link.advisorId,
            advisorEmail: link.advisorEmail,
            courses: input.data.courses,
            sharedAt: new Date().toISOString(),
        });

        return response
            .header("Content-Type", "application/json")
            .send({
                submissionId,
            } satisfies APIv4.ShareHsaSubmissionResponse);
    },
);

// GET /my-hsa-submissions — student lists HSA plans they've shared
userApp.get(
    "/my-hsa-submissions",
    async function (request: Request, response: Response) {
        if (request.userToken === null) return response.status(401).end();

        const submissions = await getHsaSubmissionsForStudent(
            request.userToken.uuid,
        );

        return response
            .header("Content-Type", "application/json")
            .send({ submissions } satisfies APIv4.GetHsaSubmissionsResponse);
    },
);

// DELETE /hsa-submissions/:submissionId — student withdraws an HSA share
userApp.delete(
    "/hsa-submissions/:submissionId",
    async function (request: Request, response: Response) {
        if (request.userToken === null) return response.status(401).end();

        const submissionId = request.params
            .submissionId as APIv4.HsaSubmissionId;
        const deleted = await deleteHsaSubmission(
            submissionId,
            request.userToken.uuid,
        );
        if (!deleted) return response.status(404).end();
        return response.status(204).end();
    },
);

export { userApp };
