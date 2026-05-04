import { memo, useEffect, useMemo, useState } from "react";
import Css from "./GraduationRequirements.module.css";
import {
    apiGetAdvisorLinks,
    apiGetAdvisorScheduleSnapshots,
    apiGetLinkedStudent,
    schoolCodeFromEnum,
} from "@lib/api";
import * as APIv4 from "hyperschedule-shared/api/v4";
import { useSectionsForTermsQuery } from "@hooks/api/query";
import { courseBaseKey } from "@lib/hsa-requirements";
import {
    RequirementGroupView,
    MajorRequiredView,
    ElectivesView,
    type SchoolData,
} from "./GraduationRequirements";

interface SchoolOption {
    code: string;
    name: string;
    hasMajorData: boolean;
    availableCatalogYears?: string[];
}

export default memo(function AdvisorGraduationRequirements() {
    const [links, setLinks] = useState<APIv4.AdvisorLink[]>([]);
    const [scheduleSnapshots, setScheduleSnapshots] = useState<
        APIv4.SharedScheduleSnapshot[]
    >([]);
    const [selectedLinkId, setSelectedLinkId] = useState<string>("");
    const [studentInfo, setStudentInfo] = useState<APIv4.LinkedStudentInfo | null>(
        null,
    );
    const [schools, setSchools] = useState<SchoolOption[]>([]);
    const [schoolData, setSchoolData] = useState<SchoolData | null>(null);
    const [selectedMajor, setSelectedMajor] = useState<string>("");
    const [catalogYearOverride, setCatalogYearOverride] = useState<string | null>(
        null,
    );
    const [loadingSchool, setLoadingSchool] = useState(false);
    const [loadingStudent, setLoadingStudent] = useState(false);

    const acceptedLinks = useMemo(
        () => links.filter((l) => l.status === "accepted"),
        [links],
    );

    // Initial fetch: links + all schedule snapshots shared with this advisor.
    useEffect(() => {
        Promise.all([
            apiGetAdvisorLinks(),
            apiGetAdvisorScheduleSnapshots(),
        ])
            .then(([linksRes, snapsRes]) => {
                setLinks(linksRes.asAdvisor);
                setScheduleSnapshots(snapsRes.snapshots);
            })
            .catch((e) => console.error("Failed to load advisor data:", e));
    }, []);

    // Fetch school list for catalog year metadata.
    useEffect(() => {
        fetch(`${__API_URL__}/v4/major-requirements/schools`, { cache: "no-cache" })
            .then((r) => r.json())
            .then((data: { schools: SchoolOption[] }) => {
                setSchools(data.schools);
            })
            .catch((e) => console.error("Failed to fetch schools:", e));
    }, []);

    // Fetch the selected student's profile.
    useEffect(() => {
        if (!selectedLinkId) {
            setStudentInfo(null);
            setCatalogYearOverride(null);
            return;
        }
        setLoadingStudent(true);
        apiGetLinkedStudent(selectedLinkId)
            .then((res) => {
                setStudentInfo(res.student);
                setCatalogYearOverride(null);
            })
            .catch((e) => {
                console.error("Failed to fetch linked student:", e);
                setStudentInfo(null);
            })
            .finally(() => setLoadingStudent(false));
    }, [selectedLinkId]);

    const studentSchoolCode = useMemo(
        () => (studentInfo ? schoolCodeFromEnum(studentInfo.school) : null),
        [studentInfo],
    );

    const defaultCatalogYear = useMemo(() => {
        if (!studentInfo?.classYear) return APIv4.DEFAULT_CATALOG_YEAR;
        return (
            APIv4.CLASS_YEAR_TO_CATALOG[studentInfo.classYear] ??
            APIv4.DEFAULT_CATALOG_YEAR
        );
    }, [studentInfo]);

    const catalogYear = catalogYearOverride ?? defaultCatalogYear;

    const availableYears = useMemo(() => {
        if (!studentSchoolCode) return [];
        const school = schools.find((s) => s.code === studentSchoolCode);
        return school?.availableCatalogYears ?? [];
    }, [schools, studentSchoolCode]);

    // Fetch school requirements data.
    useEffect(() => {
        if (!studentSchoolCode) {
            setSchoolData(null);
            return;
        }
        setLoadingSchool(true);
        const url = `${__API_URL__}/v4/major-requirements/${studentSchoolCode}/${catalogYear}`;
        fetch(url, { cache: "no-cache" })
            .then((r) => (r.ok ? r.json() : null))
            .then((data: SchoolData | null) => {
                setSchoolData(data);
                if (data) {
                    const majorKeys = Object.keys(data.majors ?? {});
                    if (majorKeys.includes("engineering"))
                        setSelectedMajor("engineering");
                    else if (majorKeys.length > 0)
                        setSelectedMajor(majorKeys[0]!);
                    else setSelectedMajor("");
                }
            })
            .catch((e) => {
                console.error(`Error fetching requirements from ${url}:`, e);
                setSchoolData(null);
            })
            .finally(() => setLoadingSchool(false));
    }, [studentSchoolCode, catalogYear]);

    // Filter snapshots for this student.
    const studentSnapshots = useMemo(() => {
        if (!studentInfo) return [];
        return scheduleSnapshots.filter(
            (s) => s.studentUserId === studentInfo.studentId,
        );
    }, [scheduleSnapshots, studentInfo]);

    // Collect terms from snapshot sections for area-code lookup.
    const snapshotTerms = useMemo(() => {
        const terms: APIv4.TermIdentifier[] = [];
        const seen = new Set<string>();
        for (const snap of studentSnapshots) {
            for (const s of snap.sections) {
                const key = `${s.section.year}${s.section.term}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    terms.push({
                        year: s.section.year,
                        term: s.section.term as APIv4.Term,
                    });
                }
            }
        }
        return terms;
    }, [studentSnapshots]);

    const sectionsData = useSectionsForTermsQuery(
        snapshotTerms.length > 0,
        snapshotTerms,
    ).data;

    const sectionsLookup = useMemo(() => {
        const lookup = new Map<string, APIv4.Section>();
        if (sectionsData) {
            for (const section of sectionsData) {
                lookup.set(
                    APIv4.stringifySectionCodeLong(section.identifier),
                    section,
                );
            }
        }
        return lookup;
    }, [sectionsData]);

    // Build course sets: approved snapshots → completed (green), pending → proposed (yellow).
    const {
        completedCourses,
        proposedCourses,
        courseAreaCodes,
        courseDisplayNames,
        courseRequirementTags,
        courseDepartments,
        tagSatisfiedBy,
    } = useMemo(() => {
        const completed = new Set<string>();
        const proposed = new Set<string>();
        const areaCodes = new Map<string, string[]>();
        const displayNames = new Map<string, string>();
        const reqTags = new Map<string, string[]>();
        const depts = new Map<string, string>();
        const tagSat = new Map<string, string>();

        for (const snap of studentSnapshots) {
            const latest = snap.approvals?.length
                ? snap.approvals[snap.approvals.length - 1]
                : undefined;
            if (latest?.status === "rejected") continue;
            const isApproved = latest?.status === "approved";
            const targetSet = isApproved ? completed : proposed;

            for (const s of snap.sections) {
                const code = APIv4.stringifyCourseCode(s.section);
                const baseKey = courseBaseKey(code);
                // Approved wins: if already in completed, skip from proposed.
                if (!isApproved && completed.has(baseKey)) continue;
                if (isApproved) proposed.delete(baseKey);
                targetSet.add(baseKey);
                if (!displayNames.has(baseKey))
                    displayNames.set(baseKey, code.trim());
                if (!depts.has(baseKey))
                    depts.set(baseKey, s.section.department);
                const tags = s.attrs.requirementTags;
                if (tags && tags.length > 0) {
                    reqTags.set(baseKey, tags);
                    for (const tag of tags) {
                        const tagKey = courseBaseKey(tag);
                        targetSet.add(tagKey);
                        tagSat.set(tagKey, code.trim());
                    }
                }
                const longKey = APIv4.stringifySectionCodeLong(s.section);
                const fullSection = sectionsLookup.get(longKey);
                if (fullSection && !areaCodes.has(baseKey)) {
                    areaCodes.set(baseKey, fullSection.courseAreas);
                }
            }
        }

        return {
            completedCourses: completed,
            proposedCourses: proposed,
            courseAreaCodes: areaCodes,
            courseDisplayNames: displayNames,
            courseRequirementTags: reqTags,
            courseDepartments: depts,
            tagSatisfiedBy: tagSat,
        };
    }, [studentSnapshots, sectionsLookup]);

    const selectedMajorData = schoolData?.majors[selectedMajor];

    const studentLabel = (l: APIv4.AdvisorLink) =>
        l.studentUsername || l.studentId;

    const approvedCount = studentSnapshots.filter(
        (s) =>
            s.approvals?.[s.approvals.length - 1]?.status === "approved",
    ).length;
    const pendingCount = studentSnapshots.length - approvedCount;

    return (
        <div className={Css.container}>
            <div className={Css.header}>
                <h2 className={Css.title}>Student Graduation Requirements</h2>
                <div className={Css.selectors}>
                    <label>
                        Student:
                        <select
                            value={selectedLinkId}
                            onChange={(e) => setSelectedLinkId(e.target.value)}
                        >
                            <option value="">
                                {acceptedLinks.length === 0
                                    ? "No linked students"
                                    : "Select a student..."}
                            </option>
                            {acceptedLinks.map((l) => (
                                <option key={l._id} value={l._id}>
                                    {studentLabel(l)}
                                </option>
                            ))}
                        </select>
                    </label>
                    {availableYears.length > 1 && (
                        <label>
                            Catalog Year:
                            <select
                                value={catalogYear}
                                onChange={(e) =>
                                    setCatalogYearOverride(e.target.value)
                                }
                            >
                                {availableYears.map((y) => (
                                    <option key={y} value={y}>
                                        {y}
                                    </option>
                                ))}
                            </select>
                        </label>
                    )}
                    {schoolData && (
                        <label>
                            Major:
                            <select
                                value={selectedMajor}
                                onChange={(e) => setSelectedMajor(e.target.value)}
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
                </div>
            </div>

            {acceptedLinks.length === 0 && (
                <p className={Css.placeholder}>
                    No students are linked to you yet. When a student requests a
                    link in their account, accept it in the Advisor tab and they
                    will appear here.
                </p>
            )}

            {selectedLinkId && (loadingStudent || loadingSchool) && (
                <p className={Css.loading}>Loading student data...</p>
            )}

            {selectedLinkId && !loadingStudent && studentInfo && (
                <>
                    <p className={Css.catalogInfo}>
                        Showing requirements for{" "}
                        {APIv4.schoolCodeToName(studentInfo.school)}
                        {studentInfo.classYear &&
                            ` — Class of ${studentInfo.classYear}`}
                        {studentSnapshots.length > 0 &&
                            ` — ${approvedCount} approved, ${pendingCount} pending schedule${
                                studentSnapshots.length === 1 ? "" : "s"
                            }`}
                    </p>
                    {studentSnapshots.length === 0 && (
                        <p className={Css.placeholder}>
                            This student has not shared any schedules with you
                            yet.
                        </p>
                    )}
                </>
            )}

            {!loadingSchool && schoolData && selectedLinkId && (
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
                                            courseRequirementTags={
                                                courseRequirementTags
                                            }
                                            courseDepartments={courseDepartments}
                                            tagSatisfiedBy={tagSatisfiedBy}
                                            canEdit={false}
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
                                    courses={
                                        selectedMajorData.major_courses.required
                                    }
                                    completedCourses={completedCourses}
                                    proposedCourses={proposedCourses}
                                    tagSatisfiedBy={tagSatisfiedBy}
                                />
                            )}

                            {selectedMajorData.major_courses?.electives && (
                                <ElectivesView
                                    electives={
                                        selectedMajorData.major_courses.electives
                                    }
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
        </div>
    );
});
