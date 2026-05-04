import { z } from "zod";
import { UserId, Username } from "./user";
import { SchoolEnum } from "./course";

export const AdvisorLinkId = z
    .string()
    .regex(/^link~[A-Za-z0-9\-_]{22}$/);
export type AdvisorLinkId = z.infer<typeof AdvisorLinkId>;

export const AdvisorLinkStatus = z.enum(["pending", "accepted", "rejected"]);
export type AdvisorLinkStatus = z.infer<typeof AdvisorLinkStatus>;

export const AdvisorLink = z.object({
    _id: AdvisorLinkId,
    studentId: UserId,
    studentUsername: z.string(),
    advisorId: UserId,
    advisorUsername: z.string(),
    advisorEmail: z.string(),
    status: AdvisorLinkStatus,
    requestedAt: z.string(),
    respondedAt: z.string().optional(),
});
export type AdvisorLink = z.infer<typeof AdvisorLink>;

export const RequestAdvisorLinkRequest = z.object({
    advisorUsername: Username,
});
export type RequestAdvisorLinkRequest = z.infer<
    typeof RequestAdvisorLinkRequest
>;

export const RequestAdvisorLinkResponse = z.object({
    link: AdvisorLink,
});
export type RequestAdvisorLinkResponse = z.infer<
    typeof RequestAdvisorLinkResponse
>;

export const RespondAdvisorLinkRequest = z.object({
    accept: z.boolean(),
});
export type RespondAdvisorLinkRequest = z.infer<
    typeof RespondAdvisorLinkRequest
>;

export const GetAdvisorLinksResponse = z.object({
    asStudent: AdvisorLink.array(),
    asAdvisor: AdvisorLink.array(),
});
export type GetAdvisorLinksResponse = z.infer<typeof GetAdvisorLinksResponse>;

export const LinkedStudentInfo = z.object({
    studentId: UserId,
    username: z.string().optional(),
    eppn: z.string().optional(),
    email: z.string().optional(),
    school: SchoolEnum,
    classYear: z.number().optional(),
});
export type LinkedStudentInfo = z.infer<typeof LinkedStudentInfo>;

export const GetLinkedStudentResponse = z.object({
    student: LinkedStudentInfo,
});
export type GetLinkedStudentResponse = z.infer<typeof GetLinkedStudentResponse>;
