import { collections } from "../collections";
import { uuid4 } from "../utils";
import * as APIv4 from "hyperschedule-shared/api/v4";
import { staticMode, staticAdvisorLinks } from "../static-store";
import { createLogger } from "../../logger";

const logger = createLogger("db.advisor-link");

export async function createAdvisorLink(args: {
    studentId: APIv4.UserId;
    studentUsername: string;
    advisorId: APIv4.UserId;
    advisorUsername: string;
    advisorEmail: string;
}): Promise<APIv4.AdvisorLink> {
    const link: APIv4.AdvisorLink = {
        _id: uuid4("link") as APIv4.AdvisorLinkId,
        studentId: args.studentId,
        studentUsername: args.studentUsername,
        advisorId: args.advisorId,
        advisorUsername: args.advisorUsername,
        advisorEmail: args.advisorEmail,
        status: "pending",
        requestedAt: new Date().toISOString(),
    };
    if (staticMode) {
        staticAdvisorLinks.set(link._id, link);
    } else {
        await collections.advisorLinks.insertOne(link);
    }
    logger.info(
        `Created advisor link ${link._id} (student=${args.studentUsername} → advisor=${args.advisorUsername})`,
    );
    return link;
}

export async function findExistingActiveLink(
    studentId: APIv4.UserId,
    advisorId: APIv4.UserId,
): Promise<APIv4.AdvisorLink | null> {
    if (staticMode) {
        for (const l of staticAdvisorLinks.values()) {
            if (
                l.studentId === studentId &&
                l.advisorId === advisorId &&
                l.status !== "rejected"
            ) {
                return l;
            }
        }
        return null;
    }
    return collections.advisorLinks.findOne({
        studentId,
        advisorId,
        status: { $in: ["pending", "accepted"] },
    });
}

export async function getLinksForStudent(
    studentId: APIv4.UserId,
): Promise<APIv4.AdvisorLink[]> {
    if (staticMode) {
        return [...staticAdvisorLinks.values()].filter(
            (l) => l.studentId === studentId,
        );
    }
    return collections.advisorLinks.find({ studentId }).toArray();
}

export async function getLinksForAdvisor(
    advisorId: APIv4.UserId,
): Promise<APIv4.AdvisorLink[]> {
    if (staticMode) {
        return [...staticAdvisorLinks.values()].filter(
            (l) => l.advisorId === advisorId,
        );
    }
    return collections.advisorLinks.find({ advisorId }).toArray();
}

export async function getAdvisorLink(
    linkId: APIv4.AdvisorLinkId,
): Promise<APIv4.AdvisorLink | null> {
    if (staticMode) {
        return staticAdvisorLinks.get(linkId) ?? null;
    }
    return collections.advisorLinks.findOne({ _id: linkId });
}

export async function respondToAdvisorLink(
    linkId: APIv4.AdvisorLinkId,
    accept: boolean,
): Promise<void> {
    const status: APIv4.AdvisorLinkStatus = accept ? "accepted" : "rejected";
    const respondedAt = new Date().toISOString();
    if (staticMode) {
        const link = staticAdvisorLinks.get(linkId);
        if (!link) throw Error("Link not found");
        link.status = status;
        link.respondedAt = respondedAt;
        return;
    }
    await collections.advisorLinks.updateOne(
        { _id: linkId },
        { $set: { status, respondedAt } },
    );
}

export async function deleteAdvisorLink(
    linkId: APIv4.AdvisorLinkId,
): Promise<void> {
    if (staticMode) {
        staticAdvisorLinks.delete(linkId);
        return;
    }
    await collections.advisorLinks.deleteOne({ _id: linkId });
}

/**
 * Returns true if the student has an accepted link with an advisor
 * whose registered email matches `advisorEmail`.
 */
export async function studentHasAcceptedAdvisorByEmail(
    studentId: APIv4.UserId,
    advisorEmail: string,
): Promise<boolean> {
    const lc = advisorEmail.toLowerCase();
    if (staticMode) {
        for (const l of staticAdvisorLinks.values()) {
            if (
                l.studentId === studentId &&
                l.status === "accepted" &&
                l.advisorEmail.toLowerCase() === lc
            ) {
                return true;
            }
        }
        return false;
    }
    const found = await collections.advisorLinks.findOne({
        studentId,
        status: "accepted",
        advisorEmail: lc,
    });
    return found !== null;
}
