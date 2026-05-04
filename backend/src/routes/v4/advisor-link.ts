import type { Request, Response, NextFunction } from "@tinyhttp/app";
import { App } from "@tinyhttp/app";
import { json as jsonParser } from "milliparsec";
import * as APIv4 from "hyperschedule-shared/api/v4";

import { createLogger } from "../../logger";
import {
    createAdvisorLink,
    deleteAdvisorLink,
    findExistingActiveLink,
    getAdvisorLink,
    getLinksForAdvisor,
    getLinksForStudent,
    respondToAdvisorLink,
} from "../../db/models/advisor-link";
import { getUser, getUserByUsername, setUserRole } from "../../db/models/user";

const logger = createLogger("server.route.advisor-link");

export const advisorLinkApp = new App({
    settings: { xPoweredBy: false },
    onError(err: any, req, res) {
        if (Object.hasOwn(err, "code")) return res.status(err.code).end();
        logger.info("AdvisorLink error: %o", err);
        return res.status(400).send(`${err}`);
    },
})
    .use((req: Request, res: Response, next: NextFunction) => {
        res.header(
            "Cache-Control",
            "private,no-cache,no-store,max-age=0,must-revalidate",
        );
        res.header("Access-Control-Allow-Credentials", "true");
        if (req.method === "OPTIONS") {
            res.header("Access-Control-Allow-Methods", "GET,POST,DELETE")
                .status(204)
                .end();
            return;
        }
        next();
    })
    .use(jsonParser());

// POST / — student requests a link with an advisor by username
advisorLinkApp.post(
    "/",
    async (request: Request, response: Response) => {
        if (request.userToken === null) return response.status(401).end();
        const parsed = APIv4.RequestAdvisorLinkRequest.safeParse(request.body);
        if (!parsed.success) {
            return response.status(400).json({
                error: parsed.error.issues[0]?.message ?? "Invalid request",
            });
        }
        const student = await getUser(request.userToken.uuid);
        const advisor = await getUserByUsername(parsed.data.advisorUsername);
        if (advisor === null) {
            return response
                .status(404)
                .json({ error: "No user with that username" });
        }
        if (advisor._id === student._id) {
            return response
                .status(400)
                .json({ error: "You cannot link to yourself" });
        }
        const existing = await findExistingActiveLink(student._id, advisor._id);
        if (existing !== null) {
            return response.status(409).json({
                error:
                    existing.status === "accepted"
                        ? "Already linked with this advisor"
                        : "A request to this advisor is already pending",
            });
        }
        const link = await createAdvisorLink({
            studentId: student._id,
            studentUsername: student.username ?? student.eppn ?? "",
            advisorId: advisor._id,
            advisorUsername: advisor.username ?? "",
            advisorEmail: advisor.email ?? advisor.eppn ?? "",
        });
        return response
            .status(200)
            .json({ link } satisfies APIv4.RequestAdvisorLinkResponse);
    },
);

// GET /mine — list all links for the current user (in either role)
advisorLinkApp.get(
    "/mine",
    async (request: Request, response: Response) => {
        if (request.userToken === null) return response.status(401).end();
        const userId = request.userToken.uuid;
        const [asStudent, asAdvisor] = await Promise.all([
            getLinksForStudent(userId),
            getLinksForAdvisor(userId),
        ]);
        return response
            .header("Content-Type", "application/json")
            .send({
                asStudent,
                asAdvisor,
            } satisfies APIv4.GetAdvisorLinksResponse);
    },
);

// POST /:linkId/respond — advisor accepts or rejects a pending request
advisorLinkApp.post(
    "/:linkId/respond",
    async (request: Request, response: Response) => {
        if (request.userToken === null) return response.status(401).end();
        const linkId = request.params.linkId as APIv4.AdvisorLinkId;
        const parsed = APIv4.RespondAdvisorLinkRequest.safeParse(request.body);
        if (!parsed.success) {
            return response.status(400).json({ error: "Invalid request" });
        }
        const link = await getAdvisorLink(linkId);
        if (link === null) {
            return response.status(404).json({ error: "Link not found" });
        }
        if (link.advisorId !== request.userToken.uuid) {
            return response.status(403).json({ error: "Not authorized" });
        }
        if (link.status !== "pending") {
            return response
                .status(400)
                .json({ error: "Link is no longer pending" });
        }
        await respondToAdvisorLink(linkId, parsed.data.accept);

        // First time accepting any link → promote to advisor role for UI access
        if (parsed.data.accept) {
            const user = await getUser(request.userToken.uuid);
            if (!user.role) {
                await setUserRole(request.userToken.uuid, "advisor");
            }
        }
        return response.status(200).json({ ok: true });
    },
);

// GET /:linkId/student — advisor fetches profile snippet for a linked student
advisorLinkApp.get(
    "/:linkId/student",
    async (request: Request, response: Response) => {
        if (request.userToken === null) return response.status(401).end();
        const linkId = request.params.linkId as APIv4.AdvisorLinkId;
        const link = await getAdvisorLink(linkId);
        if (link === null) {
            return response.status(404).json({ error: "Link not found" });
        }
        if (link.advisorId !== request.userToken.uuid) {
            return response.status(403).json({ error: "Not authorized" });
        }
        if (link.status !== "accepted") {
            return response.status(403).json({ error: "Link is not accepted" });
        }
        const student = await getUser(link.studentId);
        const info: APIv4.LinkedStudentInfo = {
            studentId: student._id,
            username: student.username,
            eppn: student.eppn,
            email: student.email,
            school: student.school,
            classYear: student.classYear,
        };
        return response
            .header("Content-Type", "application/json")
            .send({ student: info } satisfies APIv4.GetLinkedStudentResponse);
    },
);

// DELETE /:linkId — either party may break/cancel a link
advisorLinkApp.delete(
    "/:linkId",
    async (request: Request, response: Response) => {
        if (request.userToken === null) return response.status(401).end();
        const linkId = request.params.linkId as APIv4.AdvisorLinkId;
        const link = await getAdvisorLink(linkId);
        if (link === null) {
            return response.status(404).json({ error: "Link not found" });
        }
        if (
            link.studentId !== request.userToken.uuid &&
            link.advisorId !== request.userToken.uuid
        ) {
            return response.status(403).json({ error: "Not authorized" });
        }
        await deleteAdvisorLink(linkId);
        return response.status(204).end();
    },
);
