import { memo, useEffect, useState, useCallback } from "react";
import Css from "./GraduationRequirements.module.css";
import AppCss from "@components/App.module.css";
import { useUserStore } from "@hooks/store/user";
import { fetchWithToast } from "@lib/api";
import * as APIv4 from "hyperschedule-shared/api/v4";
import classNames from "classnames";

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

interface RequirementGroup {
    name: string;
    description?: string;
    courses: RequirementCourse[];
    creditsRequired?: number;
    coursesRequired?: number;
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
        };
        clinic?: {
            description: string;
            courses: RequirementCourse[];
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

    const [schools, setSchools] = useState<SchoolOption[]>([]);
    const [selectedSchool, setSelectedSchool] = useState<string>("");
    const [schoolData, setSchoolData] = useState<SchoolData | null>(null);
    const [selectedMajor, setSelectedMajor] = useState<string>("");
    const [selectedBlockId, setSelectedBlockId] = useState<string>("");
    const [loading, setLoading] = useState(false);

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

    // Get courses from selected block for requirement checking
    const blockCourses = new Set<string>();
    if (selectedBlockId && graduationBlocks[selectedBlockId]) {
        const block = graduationBlocks[selectedBlockId]!;
        for (const sem of Object.values(block.semesters)) {
            for (const s of sem.sections) {
                const code = APIv4.stringifyCourseCode(s.section);
                blockCourses.add(code);
            }
        }
    }

    const selectedMajorData = schoolData?.majors[selectedMajor];
    const blockEntries = Object.entries(graduationBlocks);

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
                    {blockEntries.length > 0 && (
                        <label>
                            Check against plan:
                            <select
                                value={selectedBlockId}
                                onChange={(e) =>
                                    setSelectedBlockId(e.target.value)
                                }
                            >
                                <option value="">None</option>
                                {blockEntries.map(([id, block]) => (
                                    <option key={id} value={id}>
                                        {block.name}
                                    </option>
                                ))}
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
                                            completedCourses={blockCourses}
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
                                <div className={Css.requirementGroup}>
                                    <h4>Required Courses</h4>
                                    <div className={Css.courseList}>
                                        {selectedMajorData.major_courses.required.map(
                                            (course, i) => (
                                                <CourseItem
                                                    key={i}
                                                    course={course}
                                                    completed={blockCourses.has(
                                                        course.course,
                                                    )}
                                                />
                                            ),
                                        )}
                                    </div>
                                </div>
                            )}

                            {selectedMajorData.major_courses?.electives && (
                                <div className={Css.requirementGroup}>
                                    <h4>Electives</h4>
                                    <p className={Css.description}>
                                        {
                                            selectedMajorData.major_courses
                                                .electives.description
                                        }
                                    </p>
                                </div>
                            )}

                            {selectedMajorData.major_courses?.clinic && (
                                <div className={Css.requirementGroup}>
                                    <h4>Clinic</h4>
                                    <p className={Css.description}>
                                        {
                                            selectedMajorData.major_courses
                                                .clinic.description
                                        }
                                    </p>
                                </div>
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
}: {
    group: RequirementGroup;
    completedCourses: Set<string>;
}) {
    const completed = group.courses.filter((c) =>
        completedCourses.has(c.course),
    ).length;
    const total =
        group.coursesRequired ?? group.courses.length;

    return (
        <div className={Css.requirementGroup}>
            <h4>
                {group.name}
                {total > 0 && completedCourses.size > 0 && (
                    <span className={Css.progressBadge}>
                        {completed}/{total}
                    </span>
                )}
            </h4>
            {group.description && (
                <p className={Css.description}>{group.description}</p>
            )}
            {group.creditsRequired !== undefined && (
                <p className={Css.creditsNote}>
                    Credits required: {group.creditsRequired}
                </p>
            )}
            {group.courses.length > 0 && (
                <div className={Css.courseList}>
                    {group.courses.map((course, i) => (
                        <CourseItem
                            key={i}
                            course={course}
                            completed={completedCourses.has(course.course)}
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
            <span className={Css.courseCode}>{course.course}</span>
            {course.title && (
                <span className={Css.courseTitle}>{course.title}</span>
            )}
            <span className={Css.courseCredits}>
                {course.credits} credit{course.credits !== 1 ? "s" : ""}
            </span>
        </div>
    );
});
