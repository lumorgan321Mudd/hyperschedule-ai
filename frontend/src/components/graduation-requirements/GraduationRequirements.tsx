import { memo, useEffect, useState, useCallback, useMemo } from "react";
import Css from "./GraduationRequirements.module.css";
import AppCss from "@components/App.module.css";
import { useUserStore } from "@hooks/store/user";
import { useActiveSectionsLookup } from "@hooks/section";
import { useSectionsForTermsQuery } from "@hooks/api/query";
import { fetchWithToast } from "@lib/api";
import * as APIv4 from "hyperschedule-shared/api/v4";
import classNames from "classnames";
import { courseBaseKey } from "@lib/hsa-requirements";

interface SchoolOption {
    code: string;
    name: string;
    hasMajorData: boolean;
}

interface RequirementCourse {
    course: string;
    title?: string;
    credits: number;
    alternatives?: string[];
}

interface SubCategory {
    name: string;
    coursesRequired: number;
    autoDetect?: { areaCode: string };
    tagValue?: string;
    description?: string;
    countMode?: "distinctDepartments";
}

interface RequirementGroup {
    name: string;
    description?: string;
    courses: RequirementCourse[];
    creditsRequired?: number;
    coursesRequired?: number;
    areaCodeMatch?: string[];
    excludeCourses?: string[];
    subCategories?: SubCategory[];
}

interface MajorInfo {
    name: string;
    department?: string;
    departments?: string[];
    major_courses?: {
        required?: RequirementCourse[];
        electives?: {
            description: string;
            coursesRequired?: number;
            level?: string;
            courses?: RequirementCourse[];
        };
    };
}

interface SchoolData {
    school: string;
    school_code: string;
    catalog_year: string;
    last_updated?: string;
    general_requirements?: RequirementGroup[];
    majors: Record<string, MajorInfo>;
}

function isCourseCompleted(
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

function schoolCodeFromEnum(school: APIv4.School): string {
    switch (school) {
        case APIv4.School.HMC:
            return "hmc";
        case APIv4.School.POM:
            return "pomona";
        case APIv4.School.SCR:
            return "scripps";
        case APIv4.School.CMC:
            return "cmc";
        case APIv4.School.PTZ:
            return "pitzer";
        default:
            return "hmc";
    }
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
                    if (majorKeys.length > 0) setSelectedMajor(majorKeys[0]!);
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
    const courseAreaCodes = new Map<string, string[]>();
    const courseDisplayNames = new Map<string, string>();
    const courseHsaTags = new Map<string, string>();
    const courseDepartments = new Map<string, string>();

    const addSectionInfo = (s: {
        section: APIv4.SectionIdentifier;
        attrs: { hsaTag?: string };
    }) => {
        const code = APIv4.stringifyCourseCode(s.section);
        const baseKey = courseBaseKey(code);
        completedCourses.add(baseKey);
        courseDisplayNames.set(baseKey, code.trim());
        courseDepartments.set(baseKey, s.section.department);
        if (s.attrs.hsaTag) {
            courseHsaTags.set(baseKey, s.attrs.hsaTag);
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
            for (const sem of Object.values(block.semesters)) {
                for (const s of sem.sections) addSectionInfo(s);
            }
        }
    } else if (checkAgainst.startsWith("schedule:")) {
        const scheduleId = checkAgainst.slice(9);
        const schedule = schedules[scheduleId];
        if (schedule) {
            for (const s of schedule.sections) addSectionInfo(s);
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
                                            courseAreaCodes={courseAreaCodes}
                                            courseDisplayNames={courseDisplayNames}
                                            courseHsaTags={courseHsaTags}
                                            courseDepartments={courseDepartments}
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
                                />
                            )}

                            {selectedMajorData.major_courses?.electives && (
                                <ElectivesView
                                    electives={selectedMajorData.major_courses.electives}
                                    completedCourses={completedCourses}
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

const RequirementGroupView = memo(function RequirementGroupView({
    group,
    completedCourses,
    courseAreaCodes,
    courseDisplayNames,
    courseHsaTags,
    courseDepartments,
}: {
    group: RequirementGroup;
    completedCourses: Set<string>;
    courseAreaCodes: Map<string, string[]>;
    courseDisplayNames: Map<string, string>;
    courseHsaTags: Map<string, string>;
    courseDepartments: Map<string, string>;
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
            for (const [baseKey, tag] of courseHsaTags) {
                if (excludeKeys.has(baseKey)) continue;
                const areas = courseAreaCodes.get(baseKey);
                if (
                    !areas ||
                    !areas.some((a) => group.areaCodeMatch!.includes(a))
                )
                    continue;
                if (tag === sub.tagValue) {
                    matched.push(baseKey);
                }
            }
        }

        let completed: number;
        if (sub.tagValue === "concentration") {
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
        ? areaMatched.length
        : group.courses.filter((c) => isCourseCompleted(c, completedCourses))
              .length;
    const total = group.coursesRequired ?? group.courses.length;
    const percent =
        total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
    const hasCheck = completedCourses.size > 0;

    return (
        <div className={Css.requirementGroup}>
            <div className={Css.groupHeader}>
                <h4>{group.name}</h4>
                {total > 0 && hasCheck && (
                    <span className={Css.progressBadge}>
                        {completed}/{total}
                    </span>
                )}
            </div>
            {total > 0 && hasCheck && (
                <div className={Css.progressBarContainer}>
                    <div
                        className={classNames(Css.progressBarFill, {
                            [Css.progressComplete]: percent === 100,
                        })}
                        style={{ width: `${percent}%` }}
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
                                {sub.matched.map((baseKey) => (
                                    <div
                                        key={baseKey}
                                        className={classNames(
                                            Css.courseItem,
                                            Css.completed,
                                        )}
                                    >
                                        <span
                                            className={Css.completedCheck}
                                        >
                                            &#10003;
                                        </span>
                                        <span className={Css.courseCode}>
                                            {courseDisplayNames.get(
                                                baseKey,
                                            ) ?? baseKey}
                                        </span>
                                    </div>
                                ))}
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
                        />
                    ))}
                </div>
            )}
            {/* Dynamic area-code-matched courses (HSA, PE) — only for groups without sub-categories */}
            {isAreaBased && !subCategoryResults && (
                <div className={Css.courseList}>
                    {areaMatched.map((baseKey) => (
                        <div
                            key={baseKey}
                            className={classNames(
                                Css.courseItem,
                                Css.completed,
                            )}
                        >
                            <span className={Css.completedCheck}>
                                &#10003;
                            </span>
                            <span className={Css.courseCode}>
                                {courseDisplayNames.get(baseKey) ?? baseKey}
                            </span>
                        </div>
                    ))}
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

const MajorRequiredView = memo(function MajorRequiredView({
    courses,
    completedCourses,
}: {
    courses: RequirementCourse[];
    completedCourses: Set<string>;
}) {
    const completed = courses.filter((c) =>
        isCourseCompleted(c, completedCourses),
    ).length;
    const total = courses.length;
    const percent = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
    const hasCheck = completedCourses.size > 0;

    return (
        <div className={Css.requirementGroup}>
            <div className={Css.groupHeader}>
                <h4>Required Courses</h4>
                {total > 0 && hasCheck && (
                    <span className={Css.progressBadge}>
                        {completed}/{total}
                    </span>
                )}
            </div>
            {total > 0 && hasCheck && (
                <div className={Css.progressBarContainer}>
                    <div
                        className={classNames(Css.progressBarFill, {
                            [Css.progressComplete]: percent === 100,
                        })}
                        style={{ width: `${percent}%` }}
                    />
                </div>
            )}
            <div className={Css.courseList}>
                {courses.map((course, i) => (
                    <CourseItem
                        key={i}
                        course={course}
                        completed={isCourseCompleted(course, completedCourses)}
                    />
                ))}
            </div>
        </div>
    );
});

const ElectivesView = memo(function ElectivesView({
    electives,
    completedCourses,
}: {
    electives: {
        description: string;
        coursesRequired?: number;
        courses?: RequirementCourse[];
    };
    completedCourses: Set<string>;
}) {
    const courses = electives.courses ?? [];
    const completed = courses.filter((c) =>
        isCourseCompleted(c, completedCourses),
    ).length;
    const total = electives.coursesRequired ?? courses.length;
    const percent = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
    const hasCheck = completedCourses.size > 0;

    return (
        <div className={Css.requirementGroup}>
            <div className={Css.groupHeader}>
                <h4>Electives</h4>
                {total > 0 && hasCheck && (
                    <span className={Css.progressBadge}>
                        {completed}/{total}
                    </span>
                )}
            </div>
            {total > 0 && hasCheck && (
                <div className={Css.progressBarContainer}>
                    <div
                        className={classNames(Css.progressBarFill, {
                            [Css.progressComplete]: percent === 100,
                        })}
                        style={{ width: `${percent}%` }}
                    />
                </div>
            )}
            <p className={Css.description}>{electives.description}</p>
            {courses.length > 0 && (
                <div className={Css.courseList}>
                    {courses.map((course, i) => (
                        <CourseItem
                            key={i}
                            course={course}
                            completed={isCourseCompleted(course, completedCourses)}
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
}: {
    course: RequirementCourse;
    completed: boolean;
}) {
    return (
        <div
            className={classNames(Css.courseItem, {
                [Css.completed]: completed,
            })}
        >
            {completed && <span className={Css.completedCheck}>&#10003;</span>}
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
            <span className={Css.courseCredits}>
                {course.credits} credit{course.credits !== 1 ? "s" : ""}
            </span>
        </div>
    );
});
