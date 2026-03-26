import { memo, useEffect, useState, useCallback, useMemo } from "react";
import Css from "./GraduationRequirements.module.css";
import AppCss from "@components/App.module.css";
import { useUserStore } from "@hooks/store/user";
import { useActiveSectionsLookup } from "@hooks/section";
import { useSectionsForTermsQuery } from "@hooks/api/query";
import { fetchWithToast, schoolCodeFromEnum } from "@lib/api";
import * as APIv4 from "hyperschedule-shared/api/v4";
import { termIsBefore } from "hyperschedule-shared/api/v4";
import { CURRENT_TERM } from "hyperschedule-shared/api/current-term";
import classNames from "classnames";
import { courseBaseKey, type SubCategory } from "@lib/hsa-requirements";

interface SchoolOption {
    code: string;
    name: string;
    hasMajorData: boolean;
}

export interface RequirementCourse {
    course: string;
    title?: string;
    credits: number;
    alternatives?: string[];
}

export interface RequirementGroup {
    name: string;
    description?: string;
    courses: RequirementCourse[];
    creditsRequired?: number;
    coursesRequired?: number;
    areaCodeMatch?: string[];
    excludeCourses?: string[];
    subCategories?: SubCategory[];
}

export interface MajorInfo {
    name: string;
    department?: string;
    departments?: string[];
    major_courses?: {
        required?: RequirementCourse[];
        electives?: {
            description: string;
            coursesRequired?: number;
            tagValue?: string;
            level?: string;
            courses?: RequirementCourse[];
        };
    };
}

export interface SchoolData {
    school: string;
    school_code: string;
    catalog_year: string;
    last_updated?: string;
    general_requirements?: RequirementGroup[];
    majors: Record<string, MajorInfo>;
}

export function isCourseCompleted(
    course: RequirementCourse,
    completedCourses: Set<string>,
): boolean {
    if (completedCourses.has(courseBaseKey(course.course))) return true;
    if (course.alternatives) {
        return course.alternatives.some((alt) =>
            completedCourses.has(courseBaseKey(alt)),
        );
    }
    return false;
}

export function isCourseProposed(
    course: RequirementCourse,
    proposedCourses: Set<string>,
): boolean {
    if (proposedCourses.has(courseBaseKey(course.course))) return true;
    if (course.alternatives) {
        return course.alternatives.some((alt) =>
            proposedCourses.has(courseBaseKey(alt)),
        );
    }
    return false;
}

export default memo(function GraduationRequirements() {
    const server = useUserStore((store) => store.server);
    const graduationBlocks = useUserStore((store) => store.graduationBlocks);
    const schedules = useUserStore((store) => store.schedules);

    const [schools, setSchools] = useState<SchoolOption[]>([]);
    const [selectedSchool, setSelectedSchool] = useState<string>("");
    const [schoolData, setSchoolData] = useState<SchoolData | null>(null);
    const [selectedMajor, setSelectedMajor] = useState<string>("");
    const [checkAgainst, setCheckAgainst] = useState<string>("");
    const [loading, setLoading] = useState(false);

    // Section lookups for area-code-based requirement matching (HSA, PE)
    const activeSectionsLookup = useActiveSectionsLookup();

    // Collect terms from selected graduation block for multi-term lookup
    const blockTerms = useMemo(() => {
        if (!checkAgainst.startsWith("block:")) return [];
        const blockId = checkAgainst.slice(6);
        const block = graduationBlocks[blockId];
        if (!block) return [];
        const terms: APIv4.TermIdentifier[] = [];
        const seen = new Set<string>();
        for (const sem of Object.values(block.semesters)) {
            const key = `${sem.term.year}${sem.term.term}`;
            if (!seen.has(key)) {
                seen.add(key);
                terms.push(sem.term);
            }
        }
        return terms;
    }, [checkAgainst, graduationBlocks]);

    const blockSectionsData = useSectionsForTermsQuery(
        blockTerms.length > 0,
        blockTerms,
    );

    // Unified section lookup combining active term + block term sections
    const sectionsLookup = useMemo(() => {
        const lookup = new Map<string, APIv4.Section>();
        for (const [key, section] of activeSectionsLookup) {
            lookup.set(key, section);
        }
        if (blockSectionsData.data) {
            for (const section of blockSectionsData.data) {
                const key = APIv4.stringifySectionCodeLong(section.identifier);
                if (!lookup.has(key)) lookup.set(key, section);
            }
        }
        return lookup;
    }, [activeSectionsLookup, blockSectionsData.data]);

    // Fetch school list
    useEffect(() => {
        fetchWithToast(`${__API_URL__}/v4/major-requirements/schools`, {
            credentials: "include",
        })
            .then((r) => r.json())
            .then((data: { schools: SchoolOption[] }) => {
                setSchools(data.schools);
                const defaultCode = server
                    ? schoolCodeFromEnum(server.school)
                    : "hmc";
                setSelectedSchool(defaultCode);
            })
            .catch(() => {});
    }, []);

    // Fetch school data when selected school changes
    const fetchSchoolData = useCallback(
        async (code: string) => {
            if (!code) return;
            setLoading(true);
            try {
                const response = await fetchWithToast(
                    `${__API_URL__}/v4/major-requirements/${code}`,
                    { credentials: "include" },
                );
                if (response.ok) {
                    const data: SchoolData = await response.json();
                    setSchoolData(data);
                    const majorKeys = Object.keys(data.majors);
                    if (majorKeys.includes("engineering")) setSelectedMajor("engineering");
                    else if (majorKeys.length > 0) setSelectedMajor(majorKeys[0]!);
                    else setSelectedMajor("");
                } else {
                    setSchoolData(null);
                }
            } catch {
                setSchoolData(null);
            }
            setLoading(false);
        },
        [],
    );

    useEffect(() => {
        if (selectedSchool) void fetchSchoolData(selectedSchool);
    }, [selectedSchool, fetchSchoolData]);

    // Get courses from selected block or schedule for requirement checking
    const completedCourses = new Set<string>();
    const proposedCourses = new Set<string>();
    const courseAreaCodes = new Map<string, string[]>();
    const courseDisplayNames = new Map<string, string>();
    const courseRequirementTags = new Map<string, string[]>();
    const courseDepartments = new Map<string, string>();
    /** Reverse map: tag value → base keys of courses that have this tag */
    const tagSatisfiedBy = new Map<string, string>();

    const addSectionInfo = (s: {
        section: APIv4.SectionIdentifier;
        attrs: { requirementTags?: string[] };
    }, targetSet: Set<string>) => {
        const code = APIv4.stringifyCourseCode(s.section);
        const baseKey = courseBaseKey(code);
        targetSet.add(baseKey);
        courseDisplayNames.set(baseKey, code.trim());
        courseDepartments.set(baseKey, s.section.department);
        const tags = s.attrs.requirementTags;
        if (tags && tags.length > 0) {
            courseRequirementTags.set(baseKey, tags);
            for (const tag of tags) {
                targetSet.add(courseBaseKey(tag));
                tagSatisfiedBy.set(courseBaseKey(tag), code.trim());
            }
        }
        const longKey = APIv4.stringifySectionCodeLong(s.section);
        const fullSection = sectionsLookup.get(longKey);
        if (fullSection) {
            courseAreaCodes.set(baseKey, fullSection.courseAreas);
        }
    };

    if (checkAgainst.startsWith("block:")) {
        const blockId = checkAgainst.slice(6);
        const block = graduationBlocks[blockId];
        if (block) {
            const isHsa = block.planType === "hsa";
            for (const sem of Object.values(block.semesters)) {
                if (isHsa && sem.name === "Alternatives") continue;
                const isTaken = isHsa
                    ? sem.name === "Taken"
                    : termIsBefore(sem.term, CURRENT_TERM);
                const targetSet = isTaken ? completedCourses : proposedCourses;
                for (const s of sem.sections) addSectionInfo(s, targetSet);
            }
        }
    } else if (checkAgainst.startsWith("schedule:")) {
        const scheduleId = checkAgainst.slice(9);
        const schedule = schedules[scheduleId];
        if (schedule) {
            // Schedules are current term — treat as proposed
            const isPast = termIsBefore(schedule.term, CURRENT_TERM);
            const targetSet = isPast ? completedCourses : proposedCourses;
            for (const s of schedule.sections) addSectionInfo(s, targetSet);
        }
    }

    const selectedMajorData = schoolData?.majors[selectedMajor];
    const blockEntries = Object.entries(graduationBlocks);
    const scheduleEntries = Object.entries(schedules);

    return (
        <div className={Css.container}>
            <div className={Css.header}>
                <h2 className={Css.title}>Graduation Requirements</h2>
                <div className={Css.selectors}>
                    <label>
                        College:
                        <select
                            value={selectedSchool}
                            onChange={(e) => setSelectedSchool(e.target.value)}
                        >
                            {schools.map((s) => (
                                <option key={s.code} value={s.code}>
                                    {s.name}
                                </option>
                            ))}
                        </select>
                    </label>
                    {schoolData && (
                        <label>
                            Major:
                            <select
                                value={selectedMajor}
                                onChange={(e) =>
                                    setSelectedMajor(e.target.value)
                                }
                            >
                                {Object.entries(schoolData.majors).map(
                                    ([key, major]) => (
                                        <option key={key} value={key}>
                                            {major.name}
                                        </option>
                                    ),
                                )}
                            </select>
                        </label>
                    )}
                    {(scheduleEntries.length > 0 || blockEntries.length > 0) && (
                        <label>
                            Check against:
                            <select
                                value={checkAgainst}
                                onChange={(e) =>
                                    setCheckAgainst(e.target.value)
                                }
                            >
                                <option value="">None</option>
                                {scheduleEntries.length > 0 && (
                                    <optgroup label="Schedules">
                                        {scheduleEntries.map(([id, schedule]) => (
                                            <option key={id} value={`schedule:${id}`}>
                                                {schedule.name}
                                            </option>
                                        ))}
                                    </optgroup>
                                )}
                                {blockEntries.length > 0 && (
                                    <optgroup label="Grad Plans">
                                        {blockEntries.map(([id, block]) => (
                                            <option key={id} value={`block:${id}`}>
                                                {block.name}
                                            </option>
                                        ))}
                                    </optgroup>
                                )}
                            </select>
                        </label>
                    )}
                </div>
            </div>

            {loading && <p className={Css.loading}>Loading requirements...</p>}

            {!loading && schoolData && (
                <div className={Css.content}>
                    <p className={Css.catalogInfo}>
                        Catalog Year: {schoolData.catalog_year}
                        {schoolData.last_updated &&
                            ` | Last updated: ${schoolData.last_updated}`}
                    </p>

                    {schoolData.general_requirements &&
                        schoolData.general_requirements.length > 0 && (
                            <div className={Css.section}>
                                <h3>General Requirements</h3>
                                {schoolData.general_requirements.map(
                                    (group, i) => (
                                        <RequirementGroupView
                                            key={i}
                                            group={group}
                                            completedCourses={completedCourses}
                                            proposedCourses={proposedCourses}
                                            courseAreaCodes={courseAreaCodes}
                                            courseDisplayNames={courseDisplayNames}
                                            courseRequirementTags={courseRequirementTags}
                                            courseDepartments={courseDepartments}
                                            tagSatisfiedBy={tagSatisfiedBy}
                                        />
                                    ),
                                )}
                            </div>
                        )}

                    {selectedMajorData && (
                        <div className={Css.section}>
                            <h3>
                                {selectedMajorData.name} Major
                                {selectedMajorData.department &&
                                    ` (${selectedMajorData.department})`}
                            </h3>

                            {selectedMajorData.major_courses?.required && (
                                <MajorRequiredView
                                    courses={selectedMajorData.major_courses.required}
                                    completedCourses={completedCourses}
                                    proposedCourses={proposedCourses}
                                    tagSatisfiedBy={tagSatisfiedBy}
                                />
                            )}

                            {selectedMajorData.major_courses?.electives && (
                                <ElectivesView
                                    electives={selectedMajorData.major_courses.electives}
                                    completedCourses={completedCourses}
                                    proposedCourses={proposedCourses}
                                    courseRequirementTags={courseRequirementTags}
                                    courseDisplayNames={courseDisplayNames}
                                />
                            )}

                            {!selectedMajorData.major_courses && (
                                <p className={Css.placeholder}>
                                    Detailed course requirements coming soon.
                                </p>
                            )}
                        </div>
                    )}
                </div>
            )}

            {!loading && !schoolData && selectedSchool && (
                <p className={Css.placeholder}>
                    No requirements data available for this college yet.
                </p>
            )}
        </div>
    );
});

export const RequirementGroupView = memo(function RequirementGroupView({
    group,
    completedCourses,
    proposedCourses,
    courseAreaCodes,
    courseDisplayNames,
    courseRequirementTags,
    courseDepartments,
    tagSatisfiedBy,
}: {
    group: RequirementGroup;
    completedCourses: Set<string>;
    proposedCourses?: Set<string>;
    courseAreaCodes: Map<string, string[]>;
    courseDisplayNames: Map<string, string>;
    courseRequirementTags: Map<string, string[]>;
    courseDepartments: Map<string, string>;
    tagSatisfiedBy?: Map<string, string>;
}) {
    // For area-code-based groups (HSA, PE): count courses matching area codes
    const excludeKeys = new Set(
        (group.excludeCourses ?? []).map((c) => courseBaseKey(c)),
    );
    const areaMatched: string[] = [];
    if (group.areaCodeMatch && group.areaCodeMatch.length > 0) {
        for (const [baseKey, areas] of courseAreaCodes) {
            if (excludeKeys.has(baseKey)) continue;
            if (areas.some((a) => group.areaCodeMatch!.includes(a))) {
                areaMatched.push(baseKey);
            }
        }
    }

    // Compute sub-category progress
    const subCategoryResults = group.subCategories?.map((sub) => {
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
            // Count largest single-department cluster
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

    const isAreaBased =
        group.areaCodeMatch !== undefined && group.areaCodeMatch.length > 0;
    const completed = isAreaBased
        ? areaMatched.filter((k) => !proposedCourses || !proposedCourses.has(k) || completedCourses.has(k)).length
        : group.courses.filter((c) => isCourseCompleted(c, completedCourses))
              .length;
    const proposed = proposedCourses
        ? isAreaBased
            ? areaMatched.filter((k) => proposedCourses.has(k) && !completedCourses.has(k)).length
            : group.courses.filter((c) => !isCourseCompleted(c, completedCourses) && isCourseProposed(c, proposedCourses)).length
        : 0;
    const total = group.coursesRequired ?? group.courses.length;
    const completedPercent =
        total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
    const proposedPercent =
        total > 0 ? Math.min(100 - completedPercent, Math.round((proposed / total) * 100)) : 0;
    const hasCheck = completedCourses.size > 0 || (proposedCourses?.size ?? 0) > 0;

    return (
        <div className={Css.requirementGroup}>
            <div className={Css.groupHeader}>
                <h4>{group.name}</h4>
                {total > 0 && hasCheck && (
                    <span className={Css.progressBadge}>
                        {completed + proposed}/{total}
                    </span>
                )}
            </div>
            {total > 0 && hasCheck && (
                <div className={Css.progressBarContainer}>
                    {proposedPercent > 0 && (
                        <div
                            className={Css.progressBarProposed}
                            style={{ width: `${completedPercent + proposedPercent}%` }}
                        />
                    )}
                    <div
                        className={Css.progressBarFill}
                        style={{ width: `${completedPercent}%` }}
                    />
                </div>
            )}
            {group.description && (
                <p className={Css.description}>{group.description}</p>
            )}
            {group.creditsRequired !== undefined && (
                <p className={Css.creditsNote}>
                    Credits required: {group.creditsRequired}
                </p>
            )}
            {/* Sub-categories with course lists (HSA sub-requirements) */}
            {subCategoryResults && (
                <div className={Css.subCategoryList}>
                    {subCategoryResults.map((sub, i) => (
                        <div key={i} className={Css.subCategory}>
                            <div className={Css.subCategoryHeader}>
                                <span className={Css.subCategoryName}>
                                    {sub.name}
                                </span>
                                <span className={Css.subCategoryProgress}>
                                    {sub.completed}/{sub.required}
                                </span>
                            </div>
                            {sub.description && (
                                <span className={Css.subCategoryDesc}>
                                    {sub.description}
                                </span>
                            )}
                            <div className={Css.courseList}>
                                {sub.matched.map((baseKey) => {
                                    const isTaken = completedCourses.has(baseKey);
                                    const isProp = !isTaken && !!proposedCourses?.has(baseKey);
                                    return (
                                        <div
                                            key={baseKey}
                                            className={classNames(
                                                Css.courseItem,
                                                isTaken && Css.completed,
                                                isProp && Css.proposed,
                                            )}
                                        >
                                            {isTaken && <span className={Css.completedCheck}>&#10003;</span>}
                                            {isProp && <span className={Css.proposedCheck}>&#10003;</span>}
                                            <span className={Css.courseCode}>
                                                {courseDisplayNames.get(
                                                    baseKey,
                                                ) ?? baseKey}
                                            </span>
                                        </div>
                                    );
                                })}
                                {Array.from(
                                    { length: Math.max(0, sub.required - sub.completed) },
                                    (_, j) => (
                                        <div
                                            key={`empty-${j}`}
                                            className={Css.courseItem}
                                        >
                                            <span className={Css.courseCode}>
                                                {sub.name} class
                                            </span>
                                        </div>
                                    ),
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
            {/* Static course list (Common Core, etc.) */}
            {group.courses.length > 0 && (
                <div className={Css.courseList}>
                    {group.courses.map((course, i) => (
                        <CourseItem
                            key={i}
                            course={course}
                            completed={isCourseCompleted(
                                course,
                                completedCourses,
                            )}
                            proposed={proposedCourses ? isCourseProposed(course, proposedCourses) : false}
                            tagSatisfiedBy={tagSatisfiedBy}
                        />
                    ))}
                </div>
            )}
            {/* Dynamic area-code-matched courses (HSA, PE) — only for groups without sub-categories */}
            {isAreaBased && !subCategoryResults && (
                <div className={Css.courseList}>
                    {areaMatched.map((baseKey) => {
                        const isTaken = completedCourses.has(baseKey);
                        const isProp = !isTaken && !!proposedCourses?.has(baseKey);
                        return (
                            <div
                                key={baseKey}
                                className={classNames(
                                    Css.courseItem,
                                    isTaken && Css.completed,
                                    isProp && Css.proposed,
                                )}
                            >
                                {isTaken && <span className={Css.completedCheck}>&#10003;</span>}
                                {isProp && <span className={Css.proposedCheck}>&#10003;</span>}
                                <span className={Css.courseCode}>
                                    {courseDisplayNames.get(baseKey) ?? baseKey}
                                </span>
                            </div>
                        );
                    })}
                    {Array.from(
                        { length: Math.max(0, total - areaMatched.length) },
                        (_, j) => (
                            <div
                                key={`empty-${j}`}
                                className={Css.courseItem}
                            >
                                <span className={Css.courseCode}>
                                    {group.name.replace(/ Requirements?$/, "")} class
                                </span>
                            </div>
                        ),
                    )}
                </div>
            )}
        </div>
    );
});

export const MajorRequiredView = memo(function MajorRequiredView({
    courses,
    completedCourses,
    proposedCourses,
    tagSatisfiedBy,
}: {
    courses: RequirementCourse[];
    completedCourses: Set<string>;
    proposedCourses?: Set<string>;
    tagSatisfiedBy?: Map<string, string>;
}) {
    const completed = courses.filter((c) =>
        isCourseCompleted(c, completedCourses),
    ).length;
    const proposed = proposedCourses
        ? courses.filter((c) => !isCourseCompleted(c, completedCourses) && isCourseProposed(c, proposedCourses)).length
        : 0;
    const total = courses.length;
    const completedPercent = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
    const proposedPercent = total > 0 ? Math.min(100 - completedPercent, Math.round((proposed / total) * 100)) : 0;
    const hasCheck = completedCourses.size > 0 || (proposedCourses?.size ?? 0) > 0;

    return (
        <div className={Css.requirementGroup}>
            <div className={Css.groupHeader}>
                <h4>Required Courses</h4>
                {total > 0 && hasCheck && (
                    <span className={Css.progressBadge}>
                        {completed + proposed}/{total}
                    </span>
                )}
            </div>
            {total > 0 && hasCheck && (
                <div className={Css.progressBarContainer}>
                    {proposedPercent > 0 && (
                        <div
                            className={Css.progressBarProposed}
                            style={{ width: `${completedPercent + proposedPercent}%` }}
                        />
                    )}
                    <div
                        className={Css.progressBarFill}
                        style={{ width: `${completedPercent}%` }}
                    />
                </div>
            )}
            <div className={Css.courseList}>
                {courses.map((course, i) => (
                    <CourseItem
                        key={i}
                        course={course}
                        completed={isCourseCompleted(course, completedCourses)}
                        proposed={proposedCourses ? isCourseProposed(course, proposedCourses) : false}
                        tagSatisfiedBy={tagSatisfiedBy}
                    />
                ))}
            </div>
        </div>
    );
});

export const ElectivesView = memo(function ElectivesView({
    electives,
    completedCourses,
    proposedCourses,
    courseRequirementTags,
    courseDisplayNames,
}: {
    electives: {
        description: string;
        coursesRequired?: number;
        tagValue?: string;
        courses?: RequirementCourse[];
    };
    completedCourses: Set<string>;
    proposedCourses?: Set<string>;
    courseRequirementTags?: Map<string, string[]>;
    courseDisplayNames?: Map<string, string>;
}) {
    const total = electives.coursesRequired ?? (electives.courses ?? []).length;
    const hasCheck = completedCourses.size > 0 || (proposedCourses?.size ?? 0) > 0;

    // Tag-based elective counting
    const taggedCompleted: string[] = [];
    const taggedProposed: string[] = [];
    if (electives.tagValue && courseRequirementTags) {
        for (const [baseKey, tags] of courseRequirementTags) {
            if (tags.includes(electives.tagValue!)) {
                if (completedCourses.has(baseKey)) {
                    taggedCompleted.push(baseKey);
                } else if (proposedCourses?.has(baseKey)) {
                    taggedProposed.push(baseKey);
                } else {
                    taggedCompleted.push(baseKey);
                }
            }
        }
    }

    const useTagMode = !!electives.tagValue;
    const completed = useTagMode
        ? taggedCompleted.length
        : (electives.courses ?? []).filter((c) => isCourseCompleted(c, completedCourses)).length;
    const proposed = useTagMode
        ? taggedProposed.length
        : proposedCourses
            ? (electives.courses ?? []).filter((c) => !isCourseCompleted(c, completedCourses) && isCourseProposed(c, proposedCourses)).length
            : 0;
    const completedPercent = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
    const proposedPercent = total > 0 ? Math.min(100 - completedPercent, Math.round((proposed / total) * 100)) : 0;

    return (
        <div className={Css.requirementGroup}>
            <div className={Css.groupHeader}>
                <h4>Electives</h4>
                {total > 0 && hasCheck && (
                    <span className={Css.progressBadge}>
                        {completed + proposed}/{total}
                    </span>
                )}
            </div>
            {total > 0 && hasCheck && (
                <div className={Css.progressBarContainer}>
                    {proposedPercent > 0 && (
                        <div
                            className={Css.progressBarProposed}
                            style={{ width: `${completedPercent + proposedPercent}%` }}
                        />
                    )}
                    <div
                        className={Css.progressBarFill}
                        style={{ width: `${completedPercent}%` }}
                    />
                </div>
            )}
            <p className={Css.description}>{electives.description}</p>
            {useTagMode && hasCheck && (
                <div className={Css.courseList}>
                    {taggedCompleted.map((baseKey) => (
                        <div
                            key={baseKey}
                            className={classNames(Css.courseItem, Css.completed)}
                        >
                            <span className={Css.completedCheck}>&#10003;</span>
                            <span className={Css.courseCode}>
                                {courseDisplayNames?.get(baseKey) ?? baseKey}
                            </span>
                        </div>
                    ))}
                    {taggedProposed.map((baseKey) => (
                        <div
                            key={baseKey}
                            className={classNames(Css.courseItem, Css.proposed)}
                        >
                            <span className={Css.proposedCheck}>&#10003;</span>
                            <span className={Css.courseCode}>
                                {courseDisplayNames?.get(baseKey) ?? baseKey}
                            </span>
                        </div>
                    ))}
                    {Array.from(
                        { length: Math.max(0, total - taggedCompleted.length - taggedProposed.length) },
                        (_, j) => (
                            <div key={`empty-${j}`} className={Css.courseItem}>
                                <span className={Css.courseCode}>
                                    Elective (tag in plan)
                                </span>
                            </div>
                        ),
                    )}
                </div>
            )}
            {/* Non-tag mode: show course list for matching */}
            {!useTagMode && (electives.courses ?? []).length > 0 && (
                <div className={Css.courseList}>
                    {(electives.courses ?? []).map((course, i) => (
                        <CourseItem
                            key={i}
                            course={course}
                            completed={isCourseCompleted(course, completedCourses)}
                            proposed={proposedCourses ? isCourseProposed(course, proposedCourses) : false}
                        />
                    ))}
                </div>
            )}
        </div>
    );
});

const CourseItem = memo(function CourseItem({
    course,
    completed,
    proposed,
    tagSatisfiedBy,
}: {
    course: RequirementCourse;
    completed: boolean;
    proposed?: boolean;
    tagSatisfiedBy?: Map<string, string>;
}) {
    // Check if this requirement is satisfied via a tag from a DIFFERENT course
    const viaNote = useMemo(() => {
        if (!completed || !tagSatisfiedBy) return undefined;
        const satisfier = tagSatisfiedBy.get(courseBaseKey(course.course));
        if (!satisfier) return undefined;
        // Don't show "via" if the satisfying course is the same as the requirement
        if (courseBaseKey(satisfier) === courseBaseKey(course.course))
            return undefined;
        return satisfier;
    }, [completed, tagSatisfiedBy, course.course]);

    const showProposed = !!proposed && !completed;

    return (
        <div
            className={classNames(Css.courseItem, {
                [Css.completed]: completed,
                [Css.proposed]: showProposed,
            })}
        >
            {completed && <span className={Css.completedCheck}>&#10003;</span>}
            {showProposed && <span className={Css.proposedCheck}>&#10003;</span>}
            <span className={Css.courseCode}>
                {course.course}
                {course.alternatives && (
                    <span className={Css.alternatives}>
                        {" or "}
                        {course.alternatives.join(" or ")}
                    </span>
                )}
            </span>
            {course.title && (
                <span className={Css.courseTitle}>{course.title}</span>
            )}
            {viaNote && (
                <span className={Css.viaBadge} title={`Satisfied by ${viaNote}`}>
                    via {viaNote}
                </span>
            )}
            <span className={Css.courseCredits}>
                {course.credits} credit{course.credits !== 1 ? "s" : ""}
            </span>
        </div>
    );
});
