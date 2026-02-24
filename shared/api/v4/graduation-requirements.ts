import { z } from "zod";

export const RequirementItem = z.object({
    course: z.string(),
    title: z.string().optional(),
    credits: z.number(),
    alternatives: z.string().array().optional(),
});
export type RequirementItem = z.infer<typeof RequirementItem>;

export const RequirementGroup = z.object({
    name: z.string(),
    description: z.string().optional(),
    courses: RequirementItem.array(),
    creditsRequired: z.number().optional(),
    coursesRequired: z.number().optional(),
});
export type RequirementGroup = z.infer<typeof RequirementGroup>;

export const MajorInfo = z.object({
    name: z.string(),
    department: z.string().optional(),
    departments: z.string().array().optional(),
    semester_credits: z.number().array().optional(),
    sample_schedule: z
        .record(z.string(), RequirementItem.array())
        .optional(),
    major_courses: z.record(z.string(), z.any()).optional(),
});
export type MajorInfo = z.infer<typeof MajorInfo>;

export const SchoolRequirements = z.object({
    school: z.string(),
    school_code: z.string(),
    catalog_year: z.string(),
    last_updated: z.string().optional(),
    general_requirements: RequirementGroup.array().optional(),
    common_core: z.any().optional(),
    hsa_requirements: z.any().optional(),
    pe_requirements: z.any().optional(),
    majors: z.record(z.string(), MajorInfo),
});
export type SchoolRequirements = z.infer<typeof SchoolRequirements>;

export const SchoolListResponse = z.object({
    schools: z
        .object({
            code: z.string(),
            name: z.string(),
            hasMajorData: z.boolean(),
        })
        .array(),
});
export type SchoolListResponse = z.infer<typeof SchoolListResponse>;
