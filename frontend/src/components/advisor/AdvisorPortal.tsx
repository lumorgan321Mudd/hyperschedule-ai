import { memo, useEffect, useState, useCallback, useMemo } from "react";
import Css from "./AdvisorPortal.module.css";
import AppCss from "@components/App.module.css";
import { apiFetch, apiApproveSnapshot, fetchWithToast, schoolCodeFromEnum } from "@lib/api";
import * as APIv4 from "hyperschedule-shared/api/v4";
import { stringifyCourseCode, stringifySectionCodeLong, termIsBefore } from "hyperschedule-shared/api/v4";
import { CURRENT_TERM } from "hyperschedule-shared/api/current-term";
import classNames from "classnames";
import { toast } from "react-toastify";
import { useSectionsForTermsQuery } from "@hooks/api/query";
import { courseBaseKey, computeHsaSubCategories, HSA_CONFIG, type SubCategory } from "@lib/hsa-requirements";

// --- Shared requirement types (same as GraduationRequirements) ---

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

export default memo(function AdvisorPortal() {
    const [snapshots, setSnapshots] = useState<APIv4.SharedBlockSnapshot[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    const fetchSnapshots = useCallback(async () => {
        try {
            const result = await apiFetch.getSharedSnapshots();
            setSnapshots(result.snapshots);
        } catch {
            toast.error("Failed to load shared plans");
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        void fetchSnapshots();
    }, [fetchSnapshots]);

    const selectedSnapshot = snapshots.find((s) => s._id === selectedId);

    return (
        <div className={Css.container}>
            <div className={Css.sidebar}>
                <div className={Css.sidebarHeader}>
                    <h3>Shared Plans</h3>
                    <button
                        className={classNames(
                            AppCss.defaultButton,
                            Css.refreshButton,
                        )}
                        onClick={fetchSnapshots}
                    >
                        Refresh
                    </button>
                </div>
                <div className={Css.snapshotList}>
                    {loading && (
                        <p className={Css.emptyMessage}>Loading...</p>
                    )}
                    {!loading && snapshots.length === 0 && (
                        <p className={Css.emptyMessage}>
                            No plans have been shared with you yet.
                        </p>
                    )}
                    {snapshots.map((snap) => (
                        <div
                            key={snap._id}
                            className={classNames(Css.snapshotItem, {
                                [Css.active]: selectedId === snap._id,
                            })}
                            onClick={() => setSelectedId(snap._id)}
                        >
                            <span className={Css.snapshotName}>
                                {snap.blockName}
                                {snap.planType === "hsa" && (
                                    <span className={Css.hsaBadge}>HSA</span>
                                )}
                                {snap.requirementOverrides &&
                                    Object.keys(snap.requirementOverrides).length > 0 && (
                                        <span className={Css.overrideBadge}>
                                            {Object.keys(snap.requirementOverrides).length} override{Object.keys(snap.requirementOverrides).length !== 1 ? "s" : ""}
                                        </span>
                                    )}
                            </span>
                            <span className={Css.snapshotStudent}>
                                {snap.studentEppn}
                            </span>
                            <span className={Css.snapshotDate}>
                                Shared{" "}
                                {new Date(snap.sharedAt).toLocaleDateString()}
                            </span>
                            {snap.approvals && snap.approvals.length > 0 && (
                                <span
                                    className={classNames(Css.statusBadge, {
                                        [Css.approved]:
                                            snap.approvals[
                                                snap.approvals.length - 1
                                            ]?.status === "approved",
                                        [Css.rejected]:
                                            snap.approvals[
                                                snap.approvals.length - 1
                                            ]?.status === "rejected",
                                    })}
                                >
                                    {
                                        snap.approvals[
                                            snap.approvals.length - 1
                                        ]?.status
                                    }
                                </span>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            <div className={Css.detail}>
                {!selectedSnapshot ? (
                    <div className={Css.emptyDetail}>
                        <p>Select a shared plan to review.</p>
                    </div>
                ) : (
                    <SnapshotDetail
                        snapshot={selectedSnapshot}
                        onRefresh={fetchSnapshots}
                    />
                )}
            </div>
        </div>
    );
});

const SnapshotDetail = memo(function SnapshotDetail({
    snapshot,
    onRefresh,
}: {
    snapshot: APIv4.SharedBlockSnapshot;
    onRefresh: () => Promise<void>;
}) {
    const [comment, setComment] = useState("");
    const [signature, setSignature] = useState("");
    const [advisorName, setAdvisorName] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [schoolData, setSchoolData] = useState<SchoolData | null>(null);
    const [reqLoading, setReqLoading] = useState(false);

    const semesterEntries = Object.entries(snapshot.semesters);

    // Fetch graduation requirements for this snapshot's college
    useEffect(() => {
        const code = schoolCodeFromEnum(snapshot.college);
        setReqLoading(true);
        fetchWithToast(
            `${__API_URL__}/v4/major-requirements/${code}`,
            { credentials: "include" },
        )
            .then((r) => (r.ok ? r.json() : null))
            .then((data: SchoolData | null) => setSchoolData(data))
            .catch(() => setSchoolData(null))
            .finally(() => setReqLoading(false));
    }, [snapshot.college]);

    // Derive unique terms from snapshot sections for area-code lookups
    const snapshotTerms = useMemo(() => {
        const terms: APIv4.TermIdentifier[] = [];
        const seen = new Set<string>();
        for (const sem of Object.values(snapshot.semesters)) {
            for (const s of sem.sections) {
                const key = `${s.section.year}${s.section.term}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    terms.push({ year: s.section.year, term: s.section.term as APIv4.Term });
                }
            }
        }
        return terms;
    }, [snapshot.semesters]);

    const sectionsData = useSectionsForTermsQuery(snapshotTerms.length > 0, snapshotTerms).data;

    // Build a lookup from section long key to full Section data
    const sectionsLookup = useMemo(() => {
        const lookup = new Map<string, APIv4.Section>();
        if (sectionsData) {
            for (const section of sectionsData) {
                lookup.set(stringifySectionCodeLong(section.identifier), section);
            }
        }
        return lookup;
    }, [sectionsData]);

    // Build completed/proposed courses sets + area code maps from the snapshot's semesters
    const completedCourses = new Set<string>();
    const proposedCourses = new Set<string>();
    const courseAreaCodes = new Map<string, string[]>();
    const courseDisplayNames = new Map<string, string>();
    const courseRequirementTags = new Map<string, string[]>();
    const courseDepartments = new Map<string, string>();
    const isHsa = snapshot.planType === "hsa";
    for (const sem of Object.values(snapshot.semesters)) {
        if (isHsa && sem.name === "Alternatives") continue;
        const isTaken = isHsa
            ? sem.name === "Taken"
            : termIsBefore(sem.term, CURRENT_TERM);
        const targetSet = isTaken ? completedCourses : proposedCourses;
        for (const s of sem.sections) {
            const code = stringifyCourseCode(s.section);
            const baseKey = courseBaseKey(code);
            targetSet.add(baseKey);
            courseDisplayNames.set(baseKey, code.trim());
            courseDepartments.set(baseKey, s.section.department);
            const tags = s.attrs.requirementTags;
            if (tags && tags.length > 0) {
                courseRequirementTags.set(baseKey, tags);
                for (const tag of tags) {
                    targetSet.add(courseBaseKey(tag));
                }
            }
            const longKey = stringifySectionCodeLong(s.section);
            const fullSection = sectionsLookup.get(longKey);
            if (fullSection) {
                courseAreaCodes.set(baseKey, fullSection.courseAreas);
            }
        }
    }

    // Try to match major from snapshot to requirements data
    const majorKey = schoolData
        ? Object.keys(schoolData.majors).find(
              (k) =>
                  k.toLowerCase() === snapshot.major?.toLowerCase() ||
                  schoolData.majors[k]?.name.toLowerCase() ===
                      snapshot.major?.toLowerCase(),
          )
        : undefined;
    const majorData = majorKey ? schoolData?.majors[majorKey] : undefined;

    const handleApproval = useCallback(
        async (status: "approved" | "rejected") => {
            if (!signature.trim() || !advisorName.trim()) {
                toast.error("Please provide your name and signature");
                return;
            }
            setSubmitting(true);
            try {
                const response = await apiApproveSnapshot(snapshot._id, {
                    status,
                    comment,
                    signature,
                    advisorName,
                });
                if (response.ok) {
                    toast.success(
                        status === "approved"
                            ? "Plan approved"
                            : "Plan rejected",
                    );
                    setComment("");
                    setSignature("");
                    setAdvisorName("");
                    await onRefresh();
                }
            } catch {
                toast.error("Failed to submit review");
            }
            setSubmitting(false);
        },
        [snapshot._id, comment, signature, advisorName, onRefresh],
    );

    return (
        <div className={Css.snapshotDetail}>
            <div className={Css.detailHeader}>
                <h2>{snapshot.blockName}</h2>
                <p className={Css.detailMeta}>
                    Student: {snapshot.studentEppn} |{" "}
                    {APIv4.schoolCodeToName(snapshot.college)}
                    {snapshot.major && ` | ${snapshot.major}`} | Shared{" "}
                    {new Date(snapshot.sharedAt).toLocaleDateString()}
                </p>
            </div>

            {/* Requirement overrides from student */}
            {snapshot.requirementOverrides &&
                Object.keys(snapshot.requirementOverrides).length > 0 && (
                    <div className={Css.overrideSection}>
                        <h4>Student Requirement Overrides</h4>
                        <p className={Css.overrideWarning}>
                            The student has made {Object.keys(snapshot.requirementOverrides).length} override(s) to the standard graduation requirements.
                        </p>
                        {Object.entries(snapshot.requirementOverrides).map(
                            ([id, ov]) => (
                                <div key={id} className={Css.overrideItem}>
                                    <strong>{ov.requirementGroupName}</strong>
                                    <span className={Css.overrideSection2}>
                                        ({ov.requirementSection})
                                    </span>
                                    <ul className={Css.overrideDetails}>
                                        {ov.markedSatisfied && (
                                            <li>Marked as satisfied</li>
                                        )}
                                        {ov.coursesRequiredOverride !==
                                            undefined && (
                                            <li>
                                                Courses required changed to{" "}
                                                {ov.coursesRequiredOverride}
                                            </li>
                                        )}
                                        {ov.addedCourses &&
                                            ov.addedCourses.length > 0 && (
                                                <li>
                                                    Added{" "}
                                                    {ov.addedCourses.length}{" "}
                                                    custom course(s)
                                                </li>
                                            )}
                                    </ul>
                                    {ov.note && (
                                        <p className={Css.overrideNote}>
                                            Student note: {ov.note}
                                        </p>
                                    )}
                                </div>
                            ),
                        )}
                    </div>
                )}

            {/* Approval history */}
            {snapshot.approvals && snapshot.approvals.length > 0 && (
                <div className={Css.approvalHistory}>
                    <h4>Review History</h4>
                    {snapshot.approvals.map((approval, i) => (
                        <div
                            key={i}
                            className={classNames(Css.approvalItem, {
                                [Css.approved]:
                                    approval.status === "approved",
                                [Css.rejected]:
                                    approval.status === "rejected",
                            })}
                        >
                            <span className={Css.approvalStatus}>
                                {approval.status === "approved"
                                    ? "Approved"
                                    : "Rejected"}
                            </span>
                            <span>by {approval.advisorName}</span>
                            <span className={Css.approvalDate}>
                                {new Date(
                                    approval.timestamp,
                                ).toLocaleDateString()}
                            </span>
                            {approval.comment && (
                                <p className={Css.approvalComment}>
                                    {approval.comment}
                                </p>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* HSA Plan view */}
            {snapshot.planType === "hsa" ? (
                <HsaSnapshotView snapshot={snapshot} />
            ) : (
                <>
                    {/* Semester view */}
                    <div className={Css.semesterGrid}>
                        {semesterEntries.map(([semId, semester]) => (
                            <div key={semId} className={Css.semesterColumn}>
                                <h4 className={Css.semesterName}>{semester.name}</h4>
                                {semester.isFutureTerm && (
                                    <div className={Css.futureBanner}>
                                        Future term
                                    </div>
                                )}
                                <div className={Css.sectionList}>
                                    {semester.sections.length === 0 && (
                                        <p className={Css.emptySections}>
                                            No courses
                                        </p>
                                    )}
                                    {semester.sections.map((s, i) => (
                                        <div key={i} className={Css.sectionItem}>
                                            <span className={Css.sectionCode}>
                                                {stringifyCourseCode(s.section)}
                                            </span>
                                            <span className={Css.sectionSchool}>
                                                {s.section.affiliation}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Graduation requirements progress */}
                    {reqLoading && (
                        <p className={Css.reqLoading}>Loading requirements...</p>
                    )}
                    {!reqLoading && schoolData && (
                        <div className={Css.requirementsSection}>
                            <h3>Graduation Requirements Progress</h3>
                            <p className={Css.reqCatalogInfo}>
                                {schoolData.school} &mdash; Catalog Year:{" "}
                                {schoolData.catalog_year}
                            </p>

                            {schoolData.general_requirements &&
                                schoolData.general_requirements.length > 0 && (
                                    <div className={Css.reqCategory}>
                                        <h4 className={Css.reqCategoryTitle}>
                                            General Requirements
                                        </h4>
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
                                                />
                                            ),
                                        )}
                                    </div>
                                )}

                            {majorData && (
                                <div className={Css.reqCategory}>
                                    <h4 className={Css.reqCategoryTitle}>
                                        {majorData.name} Major
                                    </h4>

                                    {majorData.major_courses?.required && (
                                        <div className={Css.reqGroup}>
                                            <h5 className={Css.reqGroupTitle}>
                                                Required Courses
                                            </h5>
                                            <div className={Css.reqCourseList}>
                                                {majorData.major_courses.required.map(
                                                    (course, i) => (
                                                        <ReqCourseItem
                                                            key={i}
                                                            course={course}
                                                            completed={completedCourses.has(
                                                                courseBaseKey(
                                                                    course.course,
                                                                ),
                                                            )}
                                                            proposed={proposedCourses.has(
                                                                courseBaseKey(
                                                                    course.course,
                                                                ),
                                                            )}
                                                        />
                                                    ),
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {majorData.major_courses?.electives && (
                                        <div className={Css.reqGroup}>
                                            <h5 className={Css.reqGroupTitle}>
                                                Electives
                                            </h5>
                                            <p className={Css.reqDescription}>
                                                {
                                                    majorData.major_courses.electives
                                                        .description
                                                }
                                            </p>
                                        </div>
                                    )}

                                    {majorData.major_courses?.clinic && (
                                        <div className={Css.reqGroup}>
                                            <h5 className={Css.reqGroupTitle}>
                                                Clinic
                                            </h5>
                                            <p className={Css.reqDescription}>
                                                {
                                                    majorData.major_courses.clinic
                                                        .description
                                                }
                                            </p>
                                        </div>
                                    )}

                                    {!majorData.major_courses && (
                                        <p className={Css.reqDescription}>
                                            Detailed course requirements coming soon.
                                        </p>
                                    )}
                                </div>
                            )}

                            {snapshot.major && !majorData && (
                                <p className={Css.reqDescription}>
                                    Could not match major &ldquo;{snapshot.major}
                                    &rdquo; to available requirements data.
                                </p>
                            )}
                        </div>
                    )}
                </>
            )}

            {/* Approval form */}
            <div className={Css.approvalForm}>
                <h3>Submit Review</h3>
                <label>
                    Your Name:
                    <input
                        type="text"
                        value={advisorName}
                        onChange={(e) => setAdvisorName(e.target.value)}
                        placeholder="Dr. Jane Smith"
                    />
                </label>
                <label>
                    Comments:
                    <textarea
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        placeholder="Optional feedback for the student..."
                        rows={3}
                    />
                </label>
                <label>
                    Typed Signature:
                    <input
                        type="text"
                        value={signature}
                        onChange={(e) => setSignature(e.target.value)}
                        placeholder="Type your full name as signature"
                    />
                </label>
                <div className={Css.approvalButtons}>
                    <button
                        className={classNames(
                            AppCss.defaultButton,
                            Css.approveButton,
                        )}
                        onClick={() => handleApproval("approved")}
                        disabled={submitting}
                    >
                        Approve
                    </button>
                    <button
                        className={classNames(
                            AppCss.defaultButton,
                            Css.rejectButton,
                        )}
                        onClick={() => handleApproval("rejected")}
                        disabled={submitting}
                    >
                        Reject
                    </button>
                </div>
            </div>
        </div>
    );
});

// --- Requirement display components (mirrors GraduationRequirements tab styling) ---

const RequirementGroupView = memo(function RequirementGroupView({
    group,
    completedCourses,
    proposedCourses,
    courseAreaCodes,
    courseDisplayNames,
    courseRequirementTags,
    courseDepartments,
}: {
    group: RequirementGroup;
    completedCourses: Set<string>;
    proposedCourses?: Set<string>;
    courseAreaCodes?: Map<string, string[]>;
    courseDisplayNames?: Map<string, string>;
    courseRequirementTags?: Map<string, string[]>;
    courseDepartments?: Map<string, string>;
}) {
    // Area-code-based matching (HSA, PE)
    const excludeKeys = new Set(
        (group.excludeCourses ?? []).map((c) => courseBaseKey(c)),
    );
    const areaMatched: string[] = [];
    if (group.areaCodeMatch && group.areaCodeMatch.length > 0 && courseAreaCodes) {
        for (const [baseKey, areas] of courseAreaCodes) {
            if (excludeKeys.has(baseKey)) continue;
            if (areas.some((a) => group.areaCodeMatch!.includes(a))) {
                areaMatched.push(baseKey);
            }
        }
    }

    // Sub-category progress
    const subCategoryResults = group.subCategories?.map((sub) => {
        const matched: string[] = [];

        if (sub.autoDetect?.areaCode && courseAreaCodes) {
            for (const [baseKey, areas] of courseAreaCodes) {
                if (excludeKeys.has(baseKey)) continue;
                if (areas.includes(sub.autoDetect.areaCode)) {
                    matched.push(baseKey);
                }
            }
        }

        if (sub.tagValue && courseRequirementTags) {
            for (const [baseKey, tags] of courseRequirementTags) {
                if (excludeKeys.has(baseKey)) continue;
                if (matched.includes(baseKey)) continue;
                if (tags.includes(sub.tagValue!)) {
                    matched.push(baseKey);
                }
            }
        }

        let completed: number;
        if (sub.countMode === "largestDepartmentCluster" && courseDepartments) {
            const deptCounts = new Map<string, number>();
            for (const baseKey of matched) {
                const dept = courseDepartments.get(baseKey);
                if (dept) deptCounts.set(dept, (deptCounts.get(dept) ?? 0) + 1);
            }
            completed = deptCounts.size > 0 ? Math.max(...deptCounts.values()) : 0;
        } else if (sub.countMode === "distinctDepartments" && courseDepartments) {
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

    const isAreaBased = group.areaCodeMatch !== undefined && group.areaCodeMatch.length > 0;
    const completed = isAreaBased
        ? areaMatched.filter((k) => !proposedCourses || !proposedCourses.has(k) || completedCourses.has(k)).length
        : group.courses.filter((c) => completedCourses.has(courseBaseKey(c.course))).length;
    const proposed = proposedCourses
        ? isAreaBased
            ? areaMatched.filter((k) => proposedCourses.has(k) && !completedCourses.has(k)).length
            : group.courses.filter((c) =>
                !completedCourses.has(courseBaseKey(c.course)) &&
                proposedCourses.has(courseBaseKey(c.course)),
            ).length
        : 0;
    const total = group.coursesRequired ?? group.courses.length;
    const hasCheck = completedCourses.size > 0 || (proposedCourses?.size ?? 0) > 0;

    return (
        <div className={Css.reqGroup}>
            <h5 className={Css.reqGroupTitle}>
                {group.name}
                {total > 0 && hasCheck && (
                    <span className={Css.reqProgressBadge}>
                        {completed + proposed}/{total}
                    </span>
                )}
            </h5>
            {group.description && (
                <p className={Css.reqDescription}>{group.description}</p>
            )}
            {group.creditsRequired !== undefined && (
                <p className={Css.reqCreditsNote}>
                    Credits required: {group.creditsRequired}
                </p>
            )}
            {/* Sub-categories (HSA concentration/distribution/etc.) */}
            {subCategoryResults && (
                <div className={Css.reqSubCategoryList}>
                    {subCategoryResults.map((sub, i) => (
                        <div key={i} className={Css.reqSubCategory}>
                            <div className={Css.reqSubCategoryHeader}>
                                <span className={Css.reqSubCategoryName}>
                                    {sub.name}
                                </span>
                                <span className={Css.reqSubCategoryProgress}>
                                    {sub.completed}/{sub.required}
                                </span>
                            </div>
                            {sub.description && (
                                <span className={Css.reqSubCategoryDesc}>
                                    {sub.description}
                                </span>
                            )}
                            <div className={Css.reqCourseList}>
                                {sub.matched.map((baseKey) => {
                                    const isTaken = completedCourses.has(baseKey);
                                    const isProp = !isTaken && !!proposedCourses?.has(baseKey);
                                    return (
                                        <div
                                            key={baseKey}
                                            className={classNames(
                                                Css.reqCourseItem,
                                                isTaken && Css.reqCompleted,
                                                isProp && Css.reqProposed,
                                            )}
                                        >
                                            {isTaken && <span className={Css.reqCompletedCheck}>&#10003;</span>}
                                            {isProp && <span className={Css.reqProposedCheck}>&#10003;</span>}
                                            <span className={Css.reqCourseCode}>
                                                {courseDisplayNames?.get(baseKey) ?? baseKey}
                                            </span>
                                        </div>
                                    );
                                })}
                                {Array.from(
                                    { length: Math.max(0, sub.required - sub.completed) },
                                    (_, j) => (
                                        <div key={`empty-${j}`} className={Css.reqCourseItem}>
                                            <span className={Css.reqCourseCode}>
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
                <div className={Css.reqCourseList}>
                    {group.courses.map((course, i) => (
                        <ReqCourseItem
                            key={i}
                            course={course}
                            completed={completedCourses.has(
                                courseBaseKey(course.course),
                            )}
                            proposed={proposedCourses?.has(
                                courseBaseKey(course.course),
                            )}
                        />
                    ))}
                </div>
            )}
            {/* Dynamic area-code-matched courses — only for groups without sub-categories */}
            {isAreaBased && !subCategoryResults && (
                <div className={Css.reqCourseList}>
                    {areaMatched.map((baseKey) => {
                        const isTaken = completedCourses.has(baseKey);
                        const isProp = !isTaken && !!proposedCourses?.has(baseKey);
                        return (
                            <div
                                key={baseKey}
                                className={classNames(
                                    Css.reqCourseItem,
                                    isTaken && Css.reqCompleted,
                                    isProp && Css.reqProposed,
                                )}
                            >
                                {isTaken && <span className={Css.reqCompletedCheck}>&#10003;</span>}
                                {isProp && <span className={Css.reqProposedCheck}>&#10003;</span>}
                                <span className={Css.reqCourseCode}>
                                    {courseDisplayNames?.get(baseKey) ?? baseKey}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
});

const ReqCourseItem = memo(function ReqCourseItem({
    course,
    completed,
    proposed,
}: {
    course: RequirementCourse;
    completed: boolean;
    proposed?: boolean;
}) {
    const showProposed = !!proposed && !completed;

    return (
        <div
            className={classNames(Css.reqCourseItem, {
                [Css.reqCompleted]: completed,
                [Css.reqProposed]: showProposed,
            })}
        >
            {completed && (
                <span className={Css.reqCompletedCheck}>&#10003;</span>
            )}
            {showProposed && (
                <span className={Css.reqProposedCheck}>&#10003;</span>
            )}
            <span className={Css.reqCourseCode}>{course.course}</span>
            {course.title && (
                <span className={Css.reqCourseTitle}>{course.title}</span>
            )}
            <span className={Css.reqCourseCredits}>
                {course.credits} credit{course.credits !== 1 ? "s" : ""}
            </span>
        </div>
    );
});

// --- HSA Snapshot View ---

const HSA_GROUPS: { key: string | undefined; label: string }[] = [
    { key: undefined, label: "Undecided" },
    { key: "hsa-concentration", label: "Concentration" },
    { key: "hsa-distribution", label: "Distribution" },
];

const HsaSnapshotView = memo(function HsaSnapshotView({
    snapshot,
}: {
    snapshot: APIv4.SharedBlockSnapshot;
}) {
    const semesterEntries = Object.entries(snapshot.semesters);
    const takenEntry = semesterEntries.find(([, s]) => s.name === "Taken");
    const proposedEntry = semesterEntries.find(([, s]) => s.name === "Proposed");
    const alternativesEntry = semesterEntries.find(([, s]) => s.name === "Alternatives");

    // Exclude "Alternatives" from requirement calculations
    const gradEntries = useMemo(
        () => semesterEntries.filter(([, s]) => s.name !== "Alternatives"),
        [semesterEntries],
    );

    // Derive terms from actual section identifiers for area code lookup
    const blockTerms = useMemo(() => {
        const terms: APIv4.TermIdentifier[] = [];
        const seen = new Set<string>();
        for (const [, sem] of gradEntries) {
            for (const s of sem.sections) {
                const key = `${s.section.year}${s.section.term}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    terms.push({ year: s.section.year, term: s.section.term as APIv4.Term });
                }
            }
        }
        return terms;
    }, [gradEntries]);

    const sectionsData = useSectionsForTermsQuery(
        blockTerms.length > 0,
        blockTerms,
    );

    const sectionsLookup = useMemo(() => {
        const lookup = new Map<string, APIv4.Section>();
        if (sectionsData.data) {
            for (const section of sectionsData.data) {
                const key = stringifySectionCodeLong(section.identifier);
                lookup.set(key, section);
            }
        }
        return lookup;
    }, [sectionsData.data]);

    // Build course maps, splitting into taken/proposed
    const { takenKeys, proposedKeys, courseAreaCodes, courseRequirementTags, courseDepartments, courseDisplayNames } =
        useMemo(() => {
            const taken = new Set<string>();
            const proposed = new Set<string>();
            const areaCodes = new Map<string, string[]>();
            const reqTags = new Map<string, string[]>();
            const depts = new Map<string, string>();
            const displayNames = new Map<string, string>();

            for (const [, sem] of gradEntries) {
                const isTaken = sem.name === "Taken";
                const targetSet = isTaken ? taken : proposed;

                for (const s of sem.sections) {
                    const code = stringifyCourseCode(s.section);
                    const bk = courseBaseKey(code);
                    targetSet.add(bk);
                    displayNames.set(bk, code.trim());
                    depts.set(bk, s.section.department);
                    const tags = s.attrs.requirementTags;
                    if (tags && tags.length > 0) reqTags.set(bk, tags);

                    const longKey = stringifySectionCodeLong(s.section);
                    const fullSection = sectionsLookup.get(longKey);
                    if (fullSection) {
                        areaCodes.set(bk, fullSection.courseAreas);
                    }
                }
            }

            return {
                takenKeys: taken,
                proposedKeys: proposed,
                courseAreaCodes: areaCodes,
                courseRequirementTags: reqTags,
                courseDepartments: depts,
                courseDisplayNames: displayNames,
            };
        }, [gradEntries, sectionsLookup]);

    const subCategoryResults = useMemo(
        () =>
            computeHsaSubCategories(
                HSA_CONFIG.subCategories,
                HSA_CONFIG.areaCodeMatch,
                HSA_CONFIG.excludeCourses,
                courseAreaCodes,
                courseRequirementTags,
                courseDepartments,
            ),
        [courseAreaCodes, courseRequirementTags, courseDepartments],
    );

    const renderCategory = (
        label: string,
        entry: [string, APIv4.BlockSemester] | undefined,
    ) => {
        if (!entry) return null;
        const [, semester] = entry;

        return (
            <div className={Css.hsaCategory}>
                <h4 className={Css.hsaCategoryTitle}>{label}</h4>
                <div className={Css.hsaGroupGrid}>
                    {HSA_GROUPS.map(({ key, label: groupLabel }) => {
                        const sections = semester.sections.filter((s) => {
                            const tags = s.attrs.requirementTags;
                            return key === undefined
                                ? !tags || tags.length === 0
                                : tags?.includes(key) ?? false;
                        });
                        return (
                            <div key={groupLabel} className={Css.hsaGroup}>
                                <span className={Css.hsaGroupLabel}>
                                    {groupLabel}
                                </span>
                                {sections.map((s, i) => (
                                    <div key={i} className={Css.hsaCourseItem}>
                                        <span className={Css.sectionCode}>
                                            {stringifyCourseCode(s.section)}
                                        </span>
                                    </div>
                                ))}
                                {sections.length === 0 && (
                                    <span className={Css.hsaEmptyGroup}>
                                        No courses
                                    </span>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

    return (
        <>
            {renderCategory("Taken", takenEntry)}
            {renderCategory("Proposed", proposedEntry)}
            {renderCategory("Alternatives", alternativesEntry)}

            {/* HSA Requirements Progress */}
            <div className={Css.requirementsSection}>
                <h3>HSA Requirements Progress</h3>
                {subCategoryResults.map((sub, i) => (
                    <div key={i} className={Css.reqGroup}>
                        <h5 className={Css.reqGroupTitle}>
                            {sub.name}
                            <span className={Css.reqProgressBadge}>
                                {sub.completed}/{sub.required}
                            </span>
                        </h5>
                        <div className={Css.reqCourseList}>
                            {sub.matched.map((bk) => {
                                const isTaken = takenKeys.has(bk);
                                const isProp = !isTaken && proposedKeys.has(bk);
                                return (
                                    <div
                                        key={bk}
                                        className={classNames(
                                            Css.reqCourseItem,
                                            isTaken && Css.reqCompleted,
                                            isProp && Css.reqProposed,
                                        )}
                                    >
                                        {(isTaken || isProp) && (
                                            <span className={isTaken ? Css.reqCompletedCheck : Css.reqProposedCheck}>
                                                &#10003;
                                            </span>
                                        )}
                                        <span className={Css.reqCourseCode}>
                                            {courseDisplayNames.get(bk) ?? bk}
                                        </span>
                                    </div>
                                );
                            })}
                            {Array.from(
                                {
                                    length: Math.max(
                                        0,
                                        sub.required - sub.completed,
                                    ),
                                },
                                (_, j) => (
                                    <div
                                        key={`empty-${j}`}
                                        className={Css.reqCourseItem}
                                    >
                                        <span className={Css.reqCourseCode}>
                                            {sub.name} class
                                        </span>
                                    </div>
                                ),
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </>
    );
});
