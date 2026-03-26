/**
 * Shared utility for HSA requirement computation.
 * Used by GraduationRequirements, HsaPlanEditor, and AdvisorPortal.
 */

export interface SubCategory {
    name: string;
    coursesRequired: number;
    autoDetect?: { areaCode: string };
    tagValue?: string;
    description?: string;
    countMode?: "distinctDepartments" | "largestDepartmentCluster";
}

export interface SubCategoryResult {
    name: string;
    required: number;
    completed: number;
    matched: string[];
    description?: string;
}

/**
 * Normalize course codes for requirement matching.
 * Ignores suffix (A/B/E/L) and affiliation (HM/PO/etc).
 * "CSCI 005 HM" → "CSCI5", "CHEM023A HM" → "CHEM23", "WRIT 001E HM" → "WRIT1"
 */
export function courseBaseKey(code: string): string {
    const compact = code.replace(/\s+/g, "");
    const match = compact.match(/^([A-Z]+)0*(\d+)/);
    if (!match) return compact;
    return match[1]! + match[2]!;
}

/**
 * Compute HSA sub-category progress from course data.
 */
export function computeHsaSubCategories(
    subCategories: SubCategory[],
    areaCodeMatch: string[],
    excludeCourses: string[],
    courseAreaCodes: Map<string, string[]>,
    courseRequirementTags: Map<string, string[]>,
    courseDepartments: Map<string, string>,
): SubCategoryResult[] {
    const excludeKeys = new Set(excludeCourses.map((c) => courseBaseKey(c)));

    return subCategories.map((sub) => {
        const matched: string[] = [];

        if (sub.autoDetect?.areaCode) {
            for (const [baseKey, areas] of courseAreaCodes) {
                if (excludeKeys.has(baseKey)) continue;
                if (areas.includes(sub.autoDetect.areaCode)) {
                    matched.push(baseKey);
                }
            }
        }

        if (sub.tagValue) {
            for (const [baseKey, tags] of courseRequirementTags) {
                if (excludeKeys.has(baseKey)) continue;
                if (matched.includes(baseKey)) continue;
                if (tags.includes(sub.tagValue!)) {
                    matched.push(baseKey);
                }
            }
        }

        let completed: number;
        if (sub.countMode === "largestDepartmentCluster") {
            const deptCounts = new Map<string, number>();
            for (const baseKey of matched) {
                const dept = courseDepartments.get(baseKey);
                if (dept)
                    deptCounts.set(dept, (deptCounts.get(dept) ?? 0) + 1);
            }
            completed =
                deptCounts.size > 0 ? Math.max(...deptCounts.values()) : 0;
        } else if (sub.countMode === "distinctDepartments") {
            const depts = new Set<string>();
            for (const baseKey of matched) {
                const dept = courseDepartments.get(baseKey);
                if (dept) depts.add(dept);
            }
            completed = depts.size;
        } else {
            completed = matched.length;
        }

        return {
            name: sub.name,
            required: sub.coursesRequired,
            completed,
            matched,
            description: sub.description,
        };
    });
}

/** Hard-coded HSA requirement config for HMC */
export const HSA_CONFIG = {
    areaCodeMatch: ["4HSA", "4HSS"],
    excludeCourses: ["HSA 010 HM"],
    subCategories: [
        {
            name: "Writing Intensive",
            coursesRequired: 1,
            autoDetect: { areaCode: "4WRT" },
            description: "At least one HSA Writing Intensive course",
        },
        {
            name: "HMC Faculty",
            coursesRequired: 4,
            autoDetect: { areaCode: "4HSA" },
            description: "At least 4 courses with HMC faculty",
        },
        {
            name: "Concentration",
            coursesRequired: 4,
            tagValue: "hsa-concentration",
            countMode: "largestDepartmentCluster" as const,
            description:
                "4+ courses in a single department (largest cluster counts)",
        },
        {
            name: "Distribution",
            coursesRequired: 5,
            tagValue: "hsa-distribution",
            countMode: "distinctDepartments" as const,
            description: "Courses from 5+ distinct departments",
        },
    ] as SubCategory[],
};
