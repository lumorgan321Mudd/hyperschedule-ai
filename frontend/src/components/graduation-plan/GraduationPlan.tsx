import { memo, useState, useCallback, useMemo, useRef, useEffect } from "react";
import Css from "./GraduationPlan.module.css";
import AppCss from "@components/App.module.css";
import { useUserStore } from "@hooks/store/user";
import useStore from "@hooks/store";
import { PopupOption } from "@lib/popup";
import { apiBlockAction, apiBlockSemesterAction, apiFetch, apiDeleteSnapshot } from "@lib/api";
import * as APIv4 from "hyperschedule-shared/api/v4";
import {
    stringifyCourseCode,
    stringifySectionCode,
    stringifySectionCodeLong,
    termIsBefore,
} from "hyperschedule-shared/api/v4";
import classNames from "classnames";
import { toast } from "react-toastify";
import { useSectionsQuery, useAllTermsQuery, useSectionsForTermsQuery } from "@hooks/api/query";
import { CURRENT_TERM } from "hyperschedule-shared/api/current-term";
import * as Search from "@lib/search";
import { courseBaseKey, computeHsaSubCategories, HSA_CONFIG } from "@lib/hsa-requirements";
import { fetchWithToast, schoolCodeFromEnum } from "@lib/api";
import {
    RequirementGroupView,
    MajorRequiredView,
    ElectivesView,
    type SchoolData,
} from "@components/graduation-requirements/GraduationRequirements";

/**
 * For future terms without real data, find the best available fallback.
 * Prefers same season from the most recent year, otherwise CURRENT_TERM.
 */
function resolveTerm(
    term: APIv4.TermIdentifier,
    availableTerms: APIv4.TermIdentifier[] | undefined,
): { resolved: APIv4.TermIdentifier; isFallback: boolean; fallbackNote: string } {
    if (!availableTerms || availableTerms.length === 0)
        return { resolved: CURRENT_TERM, isFallback: true, fallbackNote: `Using ${CURRENT_TERM.term === "SP" ? "Spring" : "Fall"} ${CURRENT_TERM.year} data` };

    // Check if exact term exists
    if (availableTerms.some((t) => t.term === term.term && t.year === term.year))
        return { resolved: term, isFallback: false, fallbackNote: "" };

    // Find most recent term with same season
    const sameSeason = availableTerms
        .filter((t) => t.term === term.term)
        .sort((a, b) => b.year - a.year);
    if (sameSeason.length > 0) {
        const fb = sameSeason[0]!;
        return {
            resolved: fb,
            isFallback: true,
            fallbackNote: `Using ${fb.term === "SP" ? "Spring" : "Fall"} ${fb.year} courses`,
        };
    }

    return { resolved: CURRENT_TERM, isFallback: true, fallbackNote: `Using ${CURRENT_TERM.term === "SP" ? "Spring" : "Fall"} ${CURRENT_TERM.year} data` };
}

type ActiveView =
    | { type: "block"; id: string }
    | { type: "snapshot"; id: string }
    | null;

/** Derive snapshot status from its approvals array. */
function snapshotStatus(
    snap: APIv4.SharedBlockSnapshot,
): "pending" | "approved" | "rejected" {
    if (!snap.approvals || snap.approvals.length === 0) return "pending";
    const last = snap.approvals[snap.approvals.length - 1]!;
    return last.status;
}

export default memo(function GraduationPlan() {
    const server = useUserStore((store) => store.server);
    const graduationBlocks = useUserStore((store) => store.graduationBlocks);
    const getUser = useUserStore((store) => store.getUser);
    const setPopup = useStore((store) => store.setPopup);

    const [activeView, setActiveView] = useState<ActiveView>(null);
    const [mySnapshots, setMySnapshots] = useState<APIv4.SharedBlockSnapshot[]>([]);

    const activeBlockId = activeView?.type === "block" ? activeView.id : null;

    const blockEntries = Object.entries(graduationBlocks);
    const activeBlock = activeBlockId ? graduationBlocks[activeBlockId] : null;
    const activeSnapshot =
        activeView?.type === "snapshot"
            ? mySnapshots.find((s) => s._id === activeView.id) ?? null
            : null;

    // Fetch student's snapshots
    const fetchSnapshots = useCallback(async () => {
        try {
            const result = await apiFetch.getMySnapshots();
            if (result) setMySnapshots(result.snapshots);
        } catch {
            // silently fail — snapshots are supplementary
        }
    }, []);

    useEffect(() => {
        if (server) fetchSnapshots();
    }, [server, fetchSnapshots]);

    // Group snapshots by status
    const snapshotGroups = useMemo(() => {
        const pending: APIv4.SharedBlockSnapshot[] = [];
        const approved: APIv4.SharedBlockSnapshot[] = [];
        const rejected: APIv4.SharedBlockSnapshot[] = [];
        for (const snap of mySnapshots) {
            const status = snapshotStatus(snap);
            if (status === "approved") approved.push(snap);
            else if (status === "rejected") rejected.push(snap);
            else pending.push(snap);
        }
        return { pending, approved, rejected };
    }, [mySnapshots]);

    const handleDeleteSnapshot = useCallback(
        async (snapshotId: string) => {
            try {
                const response = await apiDeleteSnapshot(snapshotId);
                if (response.ok) {
                    if (activeView?.type === "snapshot" && activeView.id === snapshotId) {
                        setActiveView(null);
                    }
                    await fetchSnapshots();
                    toast.success("Snapshot deleted");
                }
            } catch {
                toast.error("Failed to delete snapshot");
            }
        },
        [activeView, fetchSnapshots],
    );

    const handleDeleteBlock = useCallback(
        async (blockId: string) => {
            if (!server) return;
            try {
                const response = await apiBlockAction(blockId, "DELETE");
                if (response.ok) {
                    if (activeBlockId === blockId) setActiveView(null);
                    await getUser();
                    toast.success("Block deleted");
                }
            } catch {
                toast.error("Failed to delete block");
            }
        },
        [server, activeBlockId, getUser],
    );

    const handleAddSemester = useCallback(
        async (
            blockId: string,
            term: APIv4.TermIdentifier,
            importSections?: APIv4.UserSection[],
        ) => {
            if (!server) return;
            const termName =
                (term.term === APIv4.Term.spring ? "Spring" : "Fall") +
                " " +
                term.year;
            try {
                const response = await apiBlockSemesterAction(
                    blockId,
                    undefined,
                    "POST",
                    { term, name: termName },
                );
                if (response.ok) {
                    const data = await response.json();
                    const semesterId = data.semesterId as string;

                    // If schedules were selected, import their sections
                    if (importSections && importSections.length > 0) {
                        await apiBlockSemesterAction(
                            blockId,
                            semesterId,
                            "PATCH",
                            { sections: importSections },
                        );
                        toast.success(
                            `${termName} added with ${importSections.length} course${importSections.length !== 1 ? "s" : ""}`,
                        );
                    } else {
                        toast.success(`${termName} added`);
                    }
                    await getUser();
                }
            } catch {
                toast.error("Failed to add semester");
            }
        },
        [server, getUser],
    );

    const handleDeleteSemester = useCallback(
        async (blockId: string, semId: string) => {
            if (!server) return;
            try {
                const response = await apiBlockSemesterAction(
                    blockId,
                    semId,
                    "DELETE",
                );
                if (response.ok) {
                    await getUser();
                    toast.success("Semester removed");
                }
            } catch {
                toast.error("Failed to delete semester");
            }
        },
        [server, getUser],
    );

    const handleUpdateSections = useCallback(
        async (
            blockId: string,
            semId: string,
            sections: APIv4.UserSection[],
        ) => {
            if (!server) return;
            try {
                const response = await apiBlockSemesterAction(
                    blockId,
                    semId,
                    "PATCH",
                    { sections },
                );
                if (response.ok) {
                    await getUser();
                }
            } catch {
                toast.error("Failed to update courses");
            }
        },
        [server, getUser],
    );

    if (!server) {
        return (
            <div className={Css.container}>
                <div className={Css.notLoggedIn}>
                    <p>Please log in to create and manage graduation plans.</p>
                    <button
                        className={classNames(AppCss.defaultButton)}
                        onClick={() =>
                            setPopup({ option: PopupOption.Login })
                        }
                    >
                        Log in
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className={Css.container}>
            <div className={Css.sidebar}>
                <div className={Css.sidebarHeader}>
                    <h3>My Plans</h3>
                    <div className={Css.sidebarButtons}>
                        <button
                            className={classNames(
                                AppCss.defaultButton,
                                Css.createButton,
                            )}
                            onClick={() =>
                                setPopup({ option: PopupOption.CreateBlock })
                            }
                        >
                            + Plan
                        </button>
                        <button
                            className={classNames(
                                AppCss.defaultButton,
                                Css.createButton,
                                Css.createHsaButton,
                            )}
                            onClick={() =>
                                setPopup({ option: PopupOption.CreateHsaBlock })
                            }
                        >
                            + HSA Plan
                        </button>
                    </div>
                </div>
                <div className={Css.blockList}>
                    {blockEntries.length === 0 && (
                        <p className={Css.emptyMessage}>
                            No graduation plans yet. Create one to get started!
                        </p>
                    )}
                    {blockEntries.map(([id, block]) => (
                        <div
                            key={id}
                            className={classNames(Css.blockItem, {
                                [Css.active]: activeView?.type === "block" && activeView.id === id,
                            })}
                            onClick={() => setActiveView({ type: "block", id })}
                        >
                            <span className={Css.blockName}>
                                {block.name}
                                {block.planType === "hsa" && (
                                    <span className={Css.hsaBadge}>HSA</span>
                                )}
                            </span>
                            <span className={Css.blockMeta}>
                                {APIv4.schoolCodeToName(block.college)}
                                {block.major && ` - ${block.major}`}
                            </span>
                        </div>
                    ))}
                </div>

                {/* Shared Snapshots */}
                {mySnapshots.length > 0 && (
                    <div className={Css.snapshotSection}>
                        <div className={Css.snapshotSectionHeader}>
                            <h3>Shared Snapshots</h3>
                        </div>
                        {snapshotGroups.pending.length > 0 && (
                            <>
                                <span className={Css.snapshotGroupLabel}>Pending</span>
                                {snapshotGroups.pending.map((snap) => (
                                    <div
                                        key={snap._id}
                                        className={classNames(Css.snapshotItem, {
                                            [Css.active]: activeView?.type === "snapshot" && activeView.id === snap._id,
                                        })}
                                        onClick={() => setActiveView({ type: "snapshot", id: snap._id })}
                                    >
                                        <span className={Css.blockName}>{snap.blockName}</span>
                                        <span className={Css.blockMeta}>
                                            {new Date(snap.sharedAt).toLocaleDateString()}
                                            {" \u2022 "}
                                            {snap.advisorEmail}
                                        </span>
                                        <span className={Css.sharedBadge}>Pending</span>
                                    </div>
                                ))}
                            </>
                        )}
                        {snapshotGroups.approved.length > 0 && (
                            <>
                                <span className={Css.snapshotGroupLabel}>Accepted</span>
                                {snapshotGroups.approved.map((snap) => (
                                    <div
                                        key={snap._id}
                                        className={classNames(Css.snapshotItem, {
                                            [Css.active]: activeView?.type === "snapshot" && activeView.id === snap._id,
                                        })}
                                        onClick={() => setActiveView({ type: "snapshot", id: snap._id })}
                                    >
                                        <span className={Css.blockName}>{snap.blockName}</span>
                                        <span className={Css.blockMeta}>
                                            {new Date(snap.sharedAt).toLocaleDateString()}
                                            {" \u2022 "}
                                            {snap.advisorEmail}
                                        </span>
                                        <span className={Css.approvedBadge}>&#10003; Accepted</span>
                                    </div>
                                ))}
                            </>
                        )}
                        {snapshotGroups.rejected.length > 0 && (
                            <>
                                <span className={Css.snapshotGroupLabel}>Denied</span>
                                {snapshotGroups.rejected.map((snap) => (
                                    <div
                                        key={snap._id}
                                        className={classNames(Css.snapshotItem, {
                                            [Css.active]: activeView?.type === "snapshot" && activeView.id === snap._id,
                                        })}
                                        onClick={() => setActiveView({ type: "snapshot", id: snap._id })}
                                    >
                                        <span className={Css.blockName}>{snap.blockName}</span>
                                        <span className={Css.blockMeta}>
                                            {new Date(snap.sharedAt).toLocaleDateString()}
                                            {" \u2022 "}
                                            {snap.advisorEmail}
                                        </span>
                                        <span className={Css.rejectedBadge}>Denied</span>
                                    </div>
                                ))}
                            </>
                        )}
                    </div>
                )}
            </div>

            <div className={Css.editor}>
                {activeSnapshot ? (
                    <SnapshotViewer
                        snapshot={activeSnapshot}
                        onDelete={handleDeleteSnapshot}
                    />
                ) : !activeBlock ? (
                    <div className={Css.emptyEditor}>
                        <p>
                            {blockEntries.length === 0
                                ? "Create a graduation plan to get started."
                                : "Select a plan from the sidebar."}
                        </p>
                    </div>
                ) : (
                    <BlockEditor
                        blockId={activeBlockId!}
                        block={activeBlock}
                        onDeleteBlock={handleDeleteBlock}
                        onAddSemester={handleAddSemester}
                        onDeleteSemester={handleDeleteSemester}
                        onUpdateSections={handleUpdateSections}
                        onShare={() =>
                            setPopup({
                                option: PopupOption.ShareBlock,
                                blockId:
                                    activeBlockId! as APIv4.GraduationBlockId,
                                planType: activeBlock.planType,
                            })
                        }
                    />
                )}
            </div>
        </div>
    );
});

// --- Add Semester Picker ---

const AddSemesterPicker = memo(function AddSemesterPicker({
    existingTerms,
    onAdd,
    onCancel,
}: {
    existingTerms: APIv4.TermIdentifier[];
    onAdd: (
        term: APIv4.TermIdentifier,
        importSections?: APIv4.UserSection[],
    ) => void;
    onCancel: () => void;
}) {
    const schedules = useUserStore((store) => store.schedules);
    const [season, setSeason] = useState<APIv4.Term>(APIv4.Term.fall);
    const [year, setYear] = useState(CURRENT_TERM.year);
    const [selectedScheduleIds, setSelectedScheduleIds] = useState<Set<string>>(
        new Set(),
    );

    const isDuplicate = existingTerms.some(
        (t) => t.term === season && t.year === year,
    );

    const currentYear = CURRENT_TERM.year;
    const years: number[] = [];
    for (let y = currentYear - 4; y <= currentYear + 6; y++) years.push(y);

    // All schedules, sorted so matching term appears first
    const allSchedules = useMemo(() => {
        const entries = Object.entries(schedules);
        return entries.sort(([, a], [, b]) => {
            const aMatch =
                a.term.term === season && a.term.year === year ? 0 : 1;
            const bMatch =
                b.term.term === season && b.term.year === year ? 0 : 1;
            if (aMatch !== bMatch) return aMatch - bMatch;
            if (a.term.year !== b.term.year) return b.term.year - a.term.year;
            return a.name.localeCompare(b.name);
        });
    }, [schedules, season, year]);

    const handleToggleSchedule = useCallback((scheduleId: string) => {
        setSelectedScheduleIds((prev) => {
            const next = new Set(prev);
            if (next.has(scheduleId)) next.delete(scheduleId);
            else next.add(scheduleId);
            return next;
        });
    }, []);

    // Group selected schedules' sections by their actual term
    const termGroups = useMemo(() => {
        const groups = new Map<
            string,
            { term: APIv4.TermIdentifier; sections: APIv4.UserSection[] }
        >();
        for (const id of selectedScheduleIds) {
            const schedule = schedules[id];
            if (!schedule) continue;
            const termKey = APIv4.stringifyTermIdentifier(schedule.term);
            if (!groups.has(termKey)) {
                groups.set(termKey, { term: schedule.term, sections: [] });
            }
            const group = groups.get(termKey)!;
            const seen = new Set(
                group.sections.map((s) => stringifySectionCode(s.section)),
            );
            for (const section of schedule.sections) {
                const key = stringifySectionCode(section.section);
                if (!seen.has(key)) {
                    seen.add(key);
                    group.sections.push({
                        section: section.section,
                        attrs: { selected: true },
                    });
                }
            }
        }
        return groups;
    }, [selectedScheduleIds, schedules]);

    const totalImportCourses = useMemo(() => {
        let count = 0;
        for (const group of termGroups.values()) count += group.sections.length;
        return count;
    }, [termGroups]);

    const handleAdd = useCallback(() => {
        if (termGroups.size === 0) {
            // No schedules selected — create empty semester with dropdown term
            onAdd({ term: season, year });
        } else {
            // Create a semester for each unique term from selected schedules
            for (const group of termGroups.values()) {
                onAdd(group.term, group.sections);
            }
        }
    }, [termGroups, onAdd, season, year]);

    const allTermsCovered =
        termGroups.size > 0 &&
        [...termGroups.values()].every((g) =>
            existingTerms.some(
                (t) => t.term === g.term.term && t.year === g.term.year,
            ),
        );
    const addDisabled = termGroups.size === 0 ? isDuplicate : allTermsCovered;

    const buttonLabel = useMemo(() => {
        if (termGroups.size === 0) return "Add";
        if (termGroups.size === 1) {
            return `Add with ${totalImportCourses} course${totalImportCourses !== 1 ? "s" : ""}`;
        }
        return `Add ${termGroups.size} semesters (${totalImportCourses} courses)`;
    }, [termGroups, totalImportCourses]);

    return (
        <div className={Css.addSemesterPicker}>
            <div className={Css.addSemesterRow}>
                <select
                    value={season}
                    onChange={(e) => setSeason(e.target.value as APIv4.Term)}
                    className={Css.termSelect}
                >
                    <option value={APIv4.Term.spring}>Spring</option>
                    <option value={APIv4.Term.fall}>Fall</option>
                </select>
                <select
                    value={year}
                    onChange={(e) => setYear(parseInt(e.target.value))}
                    className={Css.termSelect}
                >
                    {years.map((y) => (
                        <option key={y} value={y}>
                            {y}
                        </option>
                    ))}
                </select>
                <button
                    className={classNames(AppCss.defaultButton, Css.addSemBtn)}
                    onClick={handleAdd}
                    disabled={addDisabled}
                    title={addDisabled ? "Semester(s) already exist" : ""}
                >
                    {buttonLabel}
                </button>
                <button className={Css.cancelBtn} onClick={onCancel}>
                    Cancel
                </button>
            </div>
            {allSchedules.length > 0 && (
                <div className={Css.addSemesterSchedules}>
                    <span className={Css.addSemesterSchedulesLabel}>
                        Import from schedule:
                    </span>
                    {allSchedules.map(([id, schedule]) => (
                        <label key={id} className={Css.importItem}>
                            <input
                                type="checkbox"
                                checked={selectedScheduleIds.has(id)}
                                onChange={() => handleToggleSchedule(id)}
                            />
                            <span className={Css.importScheduleName}>
                                {schedule.name}
                            </span>
                            <span className={Css.importScheduleMeta}>
                                {schedule.sections.length} course
                                {schedule.sections.length !== 1 ? "s" : ""}
                                {` \u00B7 ${APIv4.stringifyTermIdentifier(schedule.term)}`}
                            </span>
                        </label>
                    ))}
                </div>
            )}
        </div>
    );
});

// --- Block Editor ---

interface RequirementOption {
    value: string;
    label: string;
    group: string;
    courseCode?: string;
}

/** Derive ALL requirement options from school requirements data for the tag popup */
function deriveAllRequirements(
    schoolData: SchoolData | null,
    majorKey: string | undefined,
): RequirementOption[] {
    if (!schoolData) return [];
    const options: RequirementOption[] = [];

    for (const group of schoolData.general_requirements ?? []) {
        // Required courses (Common Core, etc.)
        for (const course of group.courses) {
            options.push({
                value: course.course,
                label: course.title ?? course.course,
                group: group.name,
                courseCode: course.course,
            });
        }
        // Sub-category tags (HSA concentration/distribution)
        if (group.subCategories) {
            for (const sub of group.subCategories) {
                if (sub.tagValue) {
                    options.push({
                        value: sub.tagValue as string,
                        label: sub.name,
                        group: group.name,
                    });
                }
            }
        }
    }

    // Major courses — resolve key by exact match or by name
    if (majorKey) {
        let major = schoolData.majors[majorKey];
        if (!major) {
            // Fallback: find by matching .name (case-insensitive)
            const lowerKey = majorKey.toLowerCase();
            for (const [k, m] of Object.entries(schoolData.majors)) {
                if (k.toLowerCase() === lowerKey || m.name.toLowerCase() === lowerKey) {
                    major = m;
                    break;
                }
            }
        }
        if (major?.major_courses?.required) {
            for (const course of major.major_courses.required) {
                options.push({
                    value: course.course,
                    label: course.title ?? course.course,
                    group: `${major.name} Required`,
                    courseCode: course.course,
                });
            }
        }
        if (major?.major_courses?.electives?.tagValue) {
            const elec = major.major_courses.electives;
            options.push({
                value: elec.tagValue!,
                label: `${major.name} Elective`,
                group: `${major.name} Electives`,
            });
        }
    }

    return options;
}

const BlockEditor = memo(function BlockEditor({
    blockId,
    block,
    onDeleteBlock,
    onAddSemester,
    onDeleteSemester,
    onUpdateSections,
    onShare,
}: {
    blockId: string;
    block: APIv4.GraduationBlock;
    onDeleteBlock: (id: string) => void;
    onAddSemester: (
        id: string,
        term: APIv4.TermIdentifier,
        importSections?: APIv4.UserSection[],
    ) => void;
    onDeleteSemester: (blockId: string, semId: string) => void;
    onUpdateSections: (
        blockId: string,
        semId: string,
        sections: APIv4.UserSection[],
    ) => void;
    onShare: () => void;
}) {
    const getUser = useUserStore((store) => store.getUser);
    const [showAddSemester, setShowAddSemester] = useState(false);
    const isHsa = block.planType === "hsa";

    // Fetch requirements data for tag options
    const [requirementsData, setRequirementsData] = useState<SchoolData | null>(null);
    useEffect(() => {
        const code = schoolCodeFromEnum(block.college);
        fetchWithToast(`${__API_URL__}/v4/major-requirements/${code}`, {
            credentials: "include",
        })
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => { if (data) setRequirementsData(data as SchoolData); })
            .catch(() => {});
    }, [block.college]);

    const availableMajors = useMemo(() => {
        if (!requirementsData) return [];
        return Object.entries(requirementsData.majors).map(([key, m]) => ({
            key,
            name: m.name,
        }));
    }, [requirementsData]);

    // Resolve the stored major to a valid key; default to "engineering" if none set
    const resolvedMajorKey = useMemo(() => {
        if (!requirementsData) return block.major ?? "";
        const majorVal = block.major || "engineering";
        if (requirementsData.majors[majorVal]) return majorVal;
        const lower = majorVal.toLowerCase();
        for (const [k, m] of Object.entries(requirementsData.majors)) {
            if (k.toLowerCase() === lower || m.name.toLowerCase() === lower)
                return k;
        }
        return majorVal;
    }, [block.major, requirementsData]);

    const allRequirements = useMemo(
        () => deriveAllRequirements(requirementsData, resolvedMajorKey || block.major),
        [requirementsData, resolvedMajorKey, block.major],
    );

    const handleMajorChange = useCallback(
        async (newMajor: string) => {
            await apiBlockAction(blockId, "PATCH", {
                name: block.name,
                college: block.college,
                major: newMajor || undefined,
            });
            await getUser();
        },
        [blockId, block.name, block.college, getUser],
    );

    const semesterEntries = Object.entries(block.semesters).sort(
        ([, a], [, b]) => {
            if (a.term.year !== b.term.year) return a.term.year - b.term.year;
            return a.term.term === APIv4.Term.spring ? -1 : 1;
        },
    );
    const existingTerms = semesterEntries.map(([, s]) => s.term);

    const shareLabel = isHsa ? "Share with HSA Advisor" : "Share with Advisor";

    return (
        <div className={Css.blockEditor}>
            <div className={Css.editorHeader}>
                <div>
                    <h2 className={Css.blockTitle}>
                        {block.name}
                        {isHsa && <span className={Css.hsaBadge}>HSA</span>}
                    </h2>
                    <p className={Css.blockInfo}>
                        {APIv4.schoolCodeToName(block.college)}
                        {!isHsa && availableMajors.length > 0 && (
                            <>
                                {" | Major: "}
                                <select
                                    value={resolvedMajorKey}
                                    onChange={(e) => handleMajorChange(e.target.value)}
                                    className={Css.inlineMajorSelect}
                                >
                                    <option value="">None</option>
                                    {availableMajors.map((m) => (
                                        <option key={m.key} value={m.key}>
                                            {m.name}
                                        </option>
                                    ))}
                                </select>
                            </>
                        )}
                        {isHsa && block.major && ` | ${block.major}`}
                        {!isHsa && ` | ${semesterEntries.length} semester${semesterEntries.length !== 1 ? "s" : ""}`}
                    </p>
                </div>
                <div className={Css.editorActions}>
                    <button
                        className={classNames(
                            AppCss.defaultButton,
                            isHsa ? Css.createHsaButton : undefined,
                        )}
                        onClick={onShare}
                    >
                        {shareLabel}
                    </button>
                    {!isHsa && (
                        <button
                            className={classNames(AppCss.defaultButton)}
                            onClick={() => setShowAddSemester(true)}
                        >
                            + Semester
                        </button>
                    )}
                    <button
                        className={classNames(
                            AppCss.defaultButton,
                            Css.deleteButton,
                        )}
                        onClick={() => onDeleteBlock(blockId)}
                    >
                        Delete
                    </button>
                </div>
            </div>

            {!isHsa && showAddSemester && (
                <AddSemesterPicker
                    existingTerms={existingTerms}
                    onAdd={(term, importSections) => {
                        onAddSemester(blockId, term, importSections);
                        setShowAddSemester(false);
                    }}
                    onCancel={() => setShowAddSemester(false)}
                />
            )}

            {isHsa ? (
                <HsaPlanEditor
                    blockId={blockId}
                    block={block}
                    semesterEntries={semesterEntries}
                    onUpdateSections={onUpdateSections}
                />
            ) : (
                <>
                    <div className={Css.semesterGrid}>
                        {semesterEntries.length === 0 && (
                            <p className={Css.emptyMessage}>
                                No semesters yet. Click "+ Semester" to start planning.
                            </p>
                        )}
                        {semesterEntries.map(([semId, semester]) => (
                            <SemesterColumn
                                key={semId}
                                blockId={blockId}
                                semesterId={semId}
                                semester={semester}
                                onDelete={() => onDeleteSemester(blockId, semId)}
                                onUpdateSections={(sections) =>
                                    onUpdateSections(blockId, semId, sections)
                                }
                                allRequirements={allRequirements}
                            />
                        ))}
                    </div>
                    <StandardRequirementsPanel
                        college={block.college}
                        semesterEntries={semesterEntries}
                        majorKey={resolvedMajorKey}
                    />
                </>
            )}
        </div>
    );
});

// --- Course Search within a Semester ---

const CourseSearchBox = memo(function CourseSearchBox({
    term,
    terms,
    onAdd,
    existingSections,
    dropUp,
}: {
    term?: APIv4.TermIdentifier;
    terms?: APIv4.TermIdentifier[];
    onAdd: (section: APIv4.Section) => void;
    existingSections: APIv4.SectionIdentifier[];
    dropUp?: boolean;
}) {
    const [query, setQuery] = useState("");
    const [focused, setFocused] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Fetch sections — single term or multi-term
    const singleData = useSectionsQuery(term ?? CURRENT_TERM).data;
    const multiData = useSectionsForTermsQuery(!!terms && terms.length > 0, terms ?? []).data;
    const sectionsData = terms ? multiData : singleData;

    // Build a set of already-added section codes for quick lookup
    const existingKeys = useMemo(() => {
        const keys = new Set<string>();
        for (const s of existingSections) {
            keys.add(stringifySectionCode(s));
        }
        return keys;
    }, [existingSections]);

    // Filter and score sections based on query
    const results = useMemo(() => {
        if (!sectionsData || query.trim().length === 0) return [];
        const scored: { section: APIv4.Section; score: number }[] = [];
        for (const section of sectionsData) {
            const score = Search.matchesText(query, section);
            if (score !== null) {
                scored.push({ section, score });
            }
        }
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, 30);
    }, [sectionsData, query]);

    // Close dropdown on outside click
    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (
                containerRef.current &&
                !containerRef.current.contains(e.target as Node)
            ) {
                setFocused(false);
            }
        }
        document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, []);

    const showResults = focused && query.trim().length > 0 && results.length > 0;

    return (
        <div className={Css.courseSearch} ref={containerRef}>
            <input
                ref={inputRef}
                type="text"
                placeholder="Search courses..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onFocus={() => setFocused(true)}
                className={Css.searchInput}
            />
            {showResults && (
                <div className={classNames(Css.searchResults, dropUp && Css.searchResultsUp)}>
                    {results.map(({ section }) => {
                        const key = stringifySectionCode(
                            section.identifier,
                        );
                        const alreadyAdded = existingKeys.has(key);
                        return (
                            <button
                                key={key}
                                className={classNames(Css.searchResult, {
                                    [Css.alreadyAdded]: alreadyAdded,
                                })}
                                onClick={() => {
                                    if (!alreadyAdded) {
                                        onAdd(section);
                                        setQuery("");
                                        inputRef.current?.focus();
                                    }
                                }}
                                disabled={alreadyAdded}
                            >
                                <span className={Css.resultCode}>
                                    {stringifyCourseCode(section.identifier)}
                                </span>
                                <span className={Css.resultTitle}>
                                    {section.course.title}
                                </span>
                                {alreadyAdded && (
                                    <span className={Css.addedLabel}>
                                        Added
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>
            )}
            {focused &&
                query.trim().length > 0 &&
                results.length === 0 &&
                sectionsData && (
                    <div className={classNames(Css.searchResults, dropUp && Css.searchResultsUp)}>
                        <div className={Css.noResults}>No courses found</div>
                    </div>
                )}
        </div>
    );
});

// --- Import Schedules Picker ---

const ImportSchedulesPicker = memo(function ImportSchedulesPicker({
    semesterTerm,
    existingSections,
    onImport,
}: {
    semesterTerm: APIv4.TermIdentifier;
    existingSections: APIv4.UserSection[];
    onImport: (sections: APIv4.UserSection[]) => void;
}) {
    const schedules = useUserStore((store) => store.schedules);
    const [showAll, setShowAll] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    const matchingSchedules = useMemo(() => {
        return Object.entries(schedules).filter(
            ([, schedule]) =>
                showAll ||
                (schedule.term.term === semesterTerm.term &&
                    schedule.term.year === semesterTerm.year),
        );
    }, [schedules, semesterTerm, showAll]);

    const existingKeys = useMemo(() => {
        const keys = new Set<string>();
        for (const s of existingSections) {
            keys.add(stringifySectionCode(s.section));
        }
        return keys;
    }, [existingSections]);

    const newSectionsCount = useMemo(() => {
        const seen = new Set(existingKeys);
        let count = 0;
        for (const id of selectedIds) {
            const schedule = schedules[id];
            if (!schedule) continue;
            for (const section of schedule.sections) {
                const key = stringifySectionCode(section.section);
                if (!seen.has(key)) {
                    seen.add(key);
                    count++;
                }
            }
        }
        return count;
    }, [selectedIds, schedules, existingKeys]);

    const handleToggle = useCallback((scheduleId: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(scheduleId)) next.delete(scheduleId);
            else next.add(scheduleId);
            return next;
        });
    }, []);

    const handleImport = useCallback(() => {
        const seen = new Set(existingKeys);
        const newSections: APIv4.UserSection[] = [];
        for (const id of selectedIds) {
            const schedule = schedules[id];
            if (!schedule) continue;
            for (const section of schedule.sections) {
                const key = stringifySectionCode(section.section);
                if (!seen.has(key)) {
                    seen.add(key);
                    newSections.push({
                        section: section.section,
                        attrs: { selected: true },
                    });
                }
            }
        }
        if (newSections.length > 0) {
            onImport(newSections);
        }
    }, [selectedIds, schedules, existingKeys, onImport]);

    const totalSchedules = Object.keys(schedules).length;

    return (
        <div className={Css.importPicker}>
            {matchingSchedules.length === 0 ? (
                <p className={Css.importEmpty}>
                    No schedules for this term.
                    {!showAll && totalSchedules > 0 && (
                        <button
                            className={Css.showAllBtn}
                            onClick={() => setShowAll(true)}
                        >
                            Show all schedules
                        </button>
                    )}
                </p>
            ) : (
                <>
                    <div className={Css.importList}>
                        {matchingSchedules.map(([id, schedule]) => (
                            <label key={id} className={Css.importItem}>
                                <input
                                    type="checkbox"
                                    checked={selectedIds.has(id)}
                                    onChange={() => handleToggle(id)}
                                />
                                <span className={Css.importScheduleName}>
                                    {schedule.name}
                                </span>
                                <span className={Css.importScheduleMeta}>
                                    {schedule.sections.length} course
                                    {schedule.sections.length !== 1 ? "s" : ""}
                                    {showAll &&
                                        ` \u00B7 ${APIv4.stringifyTermIdentifier(schedule.term)}`}
                                </span>
                            </label>
                        ))}
                    </div>
                    {!showAll && totalSchedules > matchingSchedules.length && (
                        <button
                            className={Css.showAllBtn}
                            onClick={() => setShowAll(true)}
                        >
                            Show all schedules
                        </button>
                    )}
                    {selectedIds.size > 0 && (
                        <button
                            className={classNames(
                                AppCss.defaultButton,
                                Css.importButton,
                            )}
                            onClick={handleImport}
                            disabled={newSectionsCount === 0}
                        >
                            {newSectionsCount > 0
                                ? `Import ${newSectionsCount} new course${newSectionsCount !== 1 ? "s" : ""}`
                                : "All courses already added"}
                        </button>
                    )}
                </>
            )}
        </div>
    );
});

// --- Semester Column ---

/** Get short display label for a requirement tag */
function tagLabel(tag: string, options: RequirementOption[]): string {
    const opt = options.find((o) => o.value === tag);
    if (opt) return opt.label;
    return tag;
}

// --- Requirement Tag Popup ---

const RequirementTagPopup = memo(function RequirementTagPopup({
    currentTags,
    options,
    courseCode,
    onSave,
    onClose,
}: {
    currentTags: string[];
    options: RequirementOption[];
    courseCode: string;
    onSave: (tags: string[]) => void;
    onClose: () => void;
}) {
    const [search, setSearch] = useState("");

    // Auto-detect: find requirement options whose courseCode matches this course
    const autoDetected = useMemo(() => {
        const bk = courseBaseKey(courseCode);
        const matches = new Set<string>();
        for (const opt of options) {
            if (opt.courseCode && courseBaseKey(opt.courseCode) === bk) {
                matches.add(opt.value);
            }
        }
        return matches;
    }, [courseCode, options]);

    const [selected, setSelected] = useState<Set<string>>(() => {
        const init = new Set(currentTags);
        // Include auto-detected matches
        for (const v of autoDetected) init.add(v);
        return init;
    });
    const searchRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        searchRef.current?.focus();
    }, []);

    // Close on Escape
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                onSave([...selected]);
                onClose();
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [onClose, onSave, selected]);

    const filtered = useMemo(() => {
        if (!search) return options;
        const lower = search.toLowerCase();
        return options.filter(
            (o) =>
                o.label.toLowerCase().includes(lower) ||
                o.value.toLowerCase().includes(lower) ||
                o.group.toLowerCase().includes(lower),
        );
    }, [options, search]);

    const grouped = useMemo(() => {
        const map = new Map<string, RequirementOption[]>();
        for (const opt of filtered) {
            const arr = map.get(opt.group) ?? [];
            arr.push(opt);
            map.set(opt.group, arr);
        }
        return map;
    }, [filtered]);

    const toggleTag = useCallback(
        (value: string) => {
            setSelected((prev) => {
                const next = new Set(prev);
                if (next.has(value)) {
                    next.delete(value);
                } else {
                    next.add(value);
                }
                return next;
            });
        },
        [],
    );

    const handleClose = useCallback(() => {
        onSave([...selected]);
        onClose();
    }, [onSave, onClose, selected]);

    return (
        <div className={Css.tagPopupOverlay} onClick={handleClose}>
            <div
                className={Css.tagPopup}
                onClick={(e) => e.stopPropagation()}
            >
                <div className={Css.tagPopupHeader}>
                    <h3>Assign Requirements</h3>
                    <button
                        className={Css.tagPopupCloseBtn}
                        onClick={handleClose}
                    >
                        x
                    </button>
                </div>
                <input
                    ref={searchRef}
                    className={Css.tagPopupSearch}
                    placeholder="Search requirements..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
                {selected.size > 0 && (
                    <button
                        className={Css.tagPopupClear}
                        onClick={() => setSelected(new Set())}
                    >
                        Clear all ({selected.size})
                    </button>
                )}
                <div className={Css.tagPopupList}>
                    {[...grouped.entries()].map(([group, opts]) => (
                        <div key={group} className={Css.tagPopupGroup}>
                            <div className={Css.tagPopupGroupLabel}>
                                {group}
                            </div>
                            {opts.map((opt) => (
                                <button
                                    key={opt.value}
                                    className={classNames(
                                        Css.tagPopupItem,
                                        {
                                            [Css.tagPopupItemActive]:
                                                selected.has(opt.value),
                                        },
                                    )}
                                    onClick={() => toggleTag(opt.value)}
                                >
                                    {selected.has(opt.value) && (
                                        <span className={Css.tagPopupCheck}>
                                            &#10003;
                                        </span>
                                    )}
                                    <span className={Css.tagPopupItemLabel}>
                                        {opt.label}
                                    </span>
                                    {autoDetected.has(opt.value) && (
                                        <span className={Css.tagPopupAuto}>
                                            auto
                                        </span>
                                    )}
                                    {opt.courseCode && (
                                        <span
                                            className={
                                                Css.tagPopupItemCode
                                            }
                                        >
                                            {opt.courseCode}
                                        </span>
                                    )}
                                </button>
                            ))}
                        </div>
                    ))}
                    {filtered.length === 0 && (
                        <p className={Css.tagPopupEmpty}>
                            No matching requirements
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
});

const SemesterColumn = memo(function SemesterColumn({
    blockId,
    semesterId,
    semester,
    onDelete,
    onUpdateSections,
    allRequirements,
}: {
    blockId: string;
    semesterId: string;
    semester: APIv4.BlockSemester;
    onDelete: () => void;
    onUpdateSections: (sections: APIv4.UserSection[]) => void;
    allRequirements: RequirementOption[];
}) {
    // Resolve term: for future terms, fall back to most recent available
    const allTerms = useAllTermsQuery().data;
    const { resolved: dataTerm, isFallback, fallbackNote } = useMemo(
        () => resolveTerm(semester.term, allTerms),
        [semester.term, allTerms],
    );

    const [showImport, setShowImport] = useState(false);
    const [tagPopupIndex, setTagPopupIndex] = useState<number | null>(null);

    const handleAddCourse = useCallback(
        (section: APIv4.Section) => {
            const newUserSection: APIv4.UserSection = {
                section: section.identifier,
                attrs: { selected: true },
            };
            onUpdateSections([...semester.sections, newUserSection]);
        },
        [semester.sections, onUpdateSections],
    );

    const handleRemoveCourse = useCallback(
        (index: number) => {
            const updated = semester.sections.filter((_, i) => i !== index);
            onUpdateSections(updated);
        },
        [semester.sections, onUpdateSections],
    );

    const handleSetTag = useCallback(
        (index: number, tags: string[]) => {
            const updatedSections = semester.sections.map((s, j) =>
                j === index
                    ? {
                          ...s,
                          attrs: {
                              ...s.attrs,
                              requirementTags:
                                  tags.length > 0 ? tags : undefined,
                          },
                      }
                    : s,
            );
            onUpdateSections(updatedSections as APIv4.UserSection[]);
        },
        [semester.sections, onUpdateSections],
    );

    const handleImportSections = useCallback(
        (newSections: APIv4.UserSection[]) => {
            onUpdateSections([...semester.sections, ...newSections]);
            setShowImport(false);
            toast.success(
                `Imported ${newSections.length} course${newSections.length !== 1 ? "s" : ""}`,
            );
        },
        [semester.sections, onUpdateSections],
    );

    // Fetch sections using the resolved (possibly fallback) term
    const sectionsData = useSectionsQuery(dataTerm).data;
    const sectionLookup = useMemo(() => {
        const map = new Map<string, APIv4.Section>();
        if (!sectionsData) return map;
        for (const s of sectionsData) {
            map.set(stringifySectionCode(s.identifier), s);
        }
        return map;
    }, [sectionsData]);

    const totalCredits = useMemo(() => {
        let credits = 0;
        for (const us of semester.sections) {
            const full = sectionLookup.get(
                stringifySectionCode(us.section),
            );
            if (full) credits += full.credits;
        }
        return credits;
    }, [semester.sections, sectionLookup]);

    return (
        <div className={Css.semesterColumn}>
            <div className={Css.semesterHeader}>
                <div>
                    <h4>{semester.name}</h4>
                    {semester.sections.length > 0 && (
                        <span className={Css.creditCount}>
                            {totalCredits} credits
                        </span>
                    )}
                </div>
                <div className={Css.semesterActions}>
                    <button
                        className={classNames(Css.importToggleBtn, {
                            [Css.importToggleActive]: showImport,
                        })}
                        onClick={() => setShowImport(!showImport)}
                        title="Import from schedule"
                    >
                        Import
                    </button>
                    <button
                        className={Css.semesterDeleteButton}
                        onClick={onDelete}
                        title="Remove semester"
                    >
                        x
                    </button>
                </div>
            </div>
            {isFallback && (
                <div className={Css.futureBanner}>
                    {fallbackNote}
                </div>
            )}
            {!isFallback && semester.isFutureTerm && (
                <div className={Css.futureBanner}>
                    Future term
                    {semester.sourceTermNote && ` - ${semester.sourceTermNote}`}
                </div>
            )}
            <div className={Css.sectionList}>
                {semester.sections.map((userSection, i) => {
                    const fullSection = sectionLookup.get(
                        stringifySectionCode(userSection.section),
                    );
                    const courseCode = stringifyCourseCode(
                        userSection.section,
                    );
                    const currentReqTags = userSection.attrs.requirementTags ?? [];
                    return (
                        <div key={i} className={Css.sectionItem}>
                            <div className={Css.sectionInfo}>
                                <span className={Css.sectionCode}>
                                    {courseCode}
                                </span>
                                {fullSection && (
                                    <span className={Css.sectionTitle}>
                                        {fullSection.course.title}
                                    </span>
                                )}
                                {currentReqTags.map((t) => (
                                    <span key={t} className={Css.requirementBadge}>
                                        {tagLabel(t, allRequirements)}
                                    </span>
                                ))}
                            </div>
                            {allRequirements.length > 0 && (
                                <button
                                    className={classNames(
                                        Css.settingsBtn,
                                        { [Css.settingsBtnActive]: currentReqTags.length > 0 },
                                    )}
                                    onClick={() => setTagPopupIndex(i)}
                                    title="Assign requirement"
                                >
                                    &#9881;
                                </button>
                            )}
                            <button
                                className={Css.removeCourseBtn}
                                onClick={() => handleRemoveCourse(i)}
                                title="Remove course"
                            >
                                x
                            </button>
                        </div>
                    );
                })}
                {semester.sections.length === 0 && (
                    <p className={Css.emptySections}>
                        Search below to add courses
                    </p>
                )}
            </div>
            {showImport && (
                <ImportSchedulesPicker
                    semesterTerm={semester.term}
                    existingSections={semester.sections}
                    onImport={handleImportSections}
                />
            )}
            <CourseSearchBox
                term={dataTerm}
                onAdd={handleAddCourse}
                existingSections={semester.sections.map((s) => s.section)}
                dropUp
            />
            {tagPopupIndex !== null && (
                <RequirementTagPopup
                    currentTags={
                        semester.sections[tagPopupIndex]?.attrs
                            .requirementTags ?? []
                    }
                    courseCode={stringifyCourseCode(
                        semester.sections[tagPopupIndex]!.section,
                    )}
                    options={allRequirements}
                    onSave={(tags) => {
                        handleSetTag(tagPopupIndex, tags);
                        setTagPopupIndex(null);
                    }}
                    onClose={() => setTagPopupIndex(null)}
                />
            )}
        </div>
    );
});

// --- HSA Plan Editor ---

type HsaTag = "hsa-concentration" | "hsa-distribution" | undefined;

// Generate terms spanning last 5 years for "Taken" course search
const TAKEN_SEARCH_TERMS: APIv4.TermIdentifier[] = [];
for (let y = CURRENT_TERM.year - 5; y <= CURRENT_TERM.year; y++) {
    TAKEN_SEARCH_TERMS.push({ year: y, term: APIv4.Term.spring });
    TAKEN_SEARCH_TERMS.push({ year: y, term: APIv4.Term.fall });
}

const HSA_GROUPS: { key: HsaTag; label: string }[] = [
    { key: undefined, label: "Undecided" },
    { key: "hsa-concentration", label: "Concentration" },
    { key: "hsa-distribution", label: "Distribution" },
];

const HsaPlanEditor = memo(function HsaPlanEditor({
    blockId,
    block,
    semesterEntries,
    onUpdateSections,
}: {
    blockId: string;
    block: APIv4.GraduationBlock;
    semesterEntries: [string, APIv4.BlockSemester][];
    onUpdateSections: (
        blockId: string,
        semId: string,
        sections: APIv4.UserSection[],
    ) => void;
}) {
    const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);

    // Group semesters into Taken, Proposed, and Alternatives
    const takenEntry = semesterEntries.find(([, s]) => s.name === "Taken");
    const proposedEntry = semesterEntries.find(([, s]) => s.name === "Proposed");
    const alternativesEntry = semesterEntries.find(([, s]) => s.name === "Alternatives");

    const handleDragStart = useCallback(
        (e: React.DragEvent, semId: string, sectionIndex: number) => {
            e.dataTransfer.setData(
                "application/json",
                JSON.stringify({ semId, sectionIndex }),
            );
            e.dataTransfer.effectAllowed = "move";
        },
        [],
    );

    const handleDragOver = useCallback(
        (e: React.DragEvent, targetKey: string) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setDragOverTarget(targetKey);
        },
        [],
    );

    const handleDragLeave = useCallback(() => {
        setDragOverTarget(null);
    }, []);

    const handleDrop = useCallback(
        (e: React.DragEvent, targetSemId: string, targetTag: HsaTag) => {
            e.preventDefault();
            setDragOverTarget(null);
            try {
                const data = JSON.parse(
                    e.dataTransfer.getData("application/json"),
                ) as { semId: string; sectionIndex: number };

                const sourceSem = block.semesters[data.semId];
                if (!sourceSem) return;
                const section = sourceSem.sections[data.sectionIndex];
                if (!section) return;

                if (data.semId === targetSemId) {
                    // Same semester — just update the requirementTags
                    const updated = sourceSem.sections.map((s, i) =>
                        i === data.sectionIndex
                            ? {
                                  ...s,
                                  attrs: {
                                      ...s.attrs,
                                      requirementTags: targetTag
                                          ? [targetTag]
                                          : undefined,
                                  },
                              }
                            : s,
                    );
                    onUpdateSections(
                        blockId,
                        targetSemId,
                        updated as APIv4.UserSection[],
                    );
                } else {
                    // Cross-semester: remove from source, add to target
                    const sourceUpdated = sourceSem.sections.filter(
                        (_, i) => i !== data.sectionIndex,
                    );
                    const targetSem = block.semesters[targetSemId];
                    if (!targetSem) return;
                    const newSection: APIv4.UserSection = {
                        section: section.section,
                        attrs: {
                            ...section.attrs,
                            requirementTags: targetTag
                                ? [targetTag]
                                : undefined,
                        },
                    };
                    const targetUpdated = [...targetSem.sections, newSection];

                    onUpdateSections(
                        blockId,
                        data.semId,
                        sourceUpdated as APIv4.UserSection[],
                    );
                    onUpdateSections(
                        blockId,
                        targetSemId,
                        targetUpdated as APIv4.UserSection[],
                    );
                }
            } catch {
                // ignore malformed drag data
            }
        },
        [block.semesters, blockId, onUpdateSections],
    );

    const handleRemoveCourse = useCallback(
        (semId: string, index: number) => {
            const sem = block.semesters[semId];
            if (!sem) return;
            const updated = sem.sections.filter((_, i) => i !== index);
            onUpdateSections(blockId, semId, updated);
        },
        [block.semesters, blockId, onUpdateSections],
    );

    const handleAddCourse = useCallback(
        (semId: string, section: APIv4.Section) => {
            const sem = block.semesters[semId];
            if (!sem) return;
            const newUserSection: APIv4.UserSection = {
                section: section.identifier,
                attrs: { selected: true },
            };
            onUpdateSections(blockId, semId, [
                ...sem.sections,
                newUserSection,
            ]);
        },
        [block.semesters, blockId, onUpdateSections],
    );

    const renderCategory = (
        label: string,
        semEntry: [string, APIv4.BlockSemester] | undefined,
    ) => {
        if (!semEntry) return null;
        const [semId, semester] = semEntry;

        return (
            <div className={Css.hsaCategory}>
                <h3 className={Css.hsaCategoryTitle}>{label}</h3>
                <div className={Css.hsaGroupGrid}>
                    {HSA_GROUPS.map(({ key, label: groupLabel }) => {
                        const targetKey = `${semId}:${key ?? "undecided"}`;
                        const sections = semester.sections
                            .map((s, i) => ({ ...s, _idx: i }))
                            .filter((s) => {
                                const tags = s.attrs.requirementTags;
                                return key === undefined
                                    ? !tags || tags.length === 0
                                    : tags?.includes(key) ?? false;
                            });
                        return (
                            <div
                                key={targetKey}
                                className={classNames(Css.hsaGroup, {
                                    [Css.dropTarget]:
                                        dragOverTarget === targetKey,
                                })}
                                onDragOver={(e) =>
                                    handleDragOver(e, targetKey)
                                }
                                onDragLeave={handleDragLeave}
                                onDrop={(e) =>
                                    handleDrop(e, semId, key)
                                }
                            >
                                <span className={Css.hsaGroupLabel}>
                                    {groupLabel}
                                </span>
                                {sections.map((s) => {
                                    const code = stringifyCourseCode(
                                        s.section,
                                    );
                                    return (
                                        <div
                                            key={s._idx}
                                            className={Css.hsaCourseItem}
                                            draggable
                                            onDragStart={(e) =>
                                                handleDragStart(
                                                    e,
                                                    semId,
                                                    s._idx,
                                                )
                                            }
                                        >
                                            <span
                                                className={
                                                    Css.hsaCourseCode
                                                }
                                            >
                                                {code}
                                            </span>
                                            <button
                                                className={
                                                    Css.removeCourseBtn
                                                }
                                                onClick={() =>
                                                    handleRemoveCourse(
                                                        semId,
                                                        s._idx,
                                                    )
                                                }
                                                title="Remove"
                                            >
                                                x
                                            </button>
                                        </div>
                                    );
                                })}
                                {sections.length === 0 && (
                                    <span className={Css.hsaDropHint}>
                                        Drag here
                                    </span>
                                )}
                            </div>
                        );
                    })}
                </div>
                <CourseSearchBox
                    term={label !== "Taken" ? CURRENT_TERM : undefined}
                    terms={label === "Taken" ? TAKEN_SEARCH_TERMS : undefined}
                    onAdd={(section) => handleAddCourse(semId, section)}
                    existingSections={semester.sections.map((s) => s.section)}
                />
            </div>
        );
    };

    return (
        <div className={Css.hsaPlanEditor}>
            {renderCategory("Taken", takenEntry)}
            {renderCategory("Proposed", proposedEntry)}
            {renderCategory("Alternatives", alternativesEntry)}
            <HsaRequirementsPanel
                semesterEntries={semesterEntries}
            />
        </div>
    );
});

// --- Standard Graduation Requirements Panel ---

const StandardRequirementsPanel = memo(function StandardRequirementsPanel({
    college,
    semesterEntries,
    majorKey,
}: {
    college: APIv4.School;
    semesterEntries: [string, APIv4.BlockSemester][];
    majorKey: string;
}) {
    const [schoolData, setSchoolData] = useState<SchoolData | null>(null);

    // Fetch school data
    useEffect(() => {
        const code = schoolCodeFromEnum(college);
        fetchWithToast(`${__API_URL__}/v4/major-requirements/${code}`, {
            credentials: "include",
        })
            .then((r) => r.json())
            .then((data: SchoolData) => {
                setSchoolData(data);
            })
            .catch(() => {});
    }, [college]);

    // Collect terms for section lookup
    const blockTerms = useMemo(() => {
        const terms: APIv4.TermIdentifier[] = [];
        const seen = new Set<string>();
        for (const [, sem] of semesterEntries) {
            const key = `${sem.term.year}${sem.term.term}`;
            if (!seen.has(key)) {
                seen.add(key);
                terms.push(sem.term);
            }
        }
        return terms;
    }, [semesterEntries]);

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

    // Build course maps from plan semesters, splitting into taken (past) and proposed (current/future)
    const { completedCourses, proposedCourses, courseAreaCodes, courseRequirementTags, courseDepartments, courseDisplayNames, tagSatisfiedBy } =
        useMemo(() => {
            const completed = new Set<string>();
            const proposed = new Set<string>();
            const areaCodes = new Map<string, string[]>();
            const reqTags = new Map<string, string[]>();
            const depts = new Map<string, string>();
            const displayNames = new Map<string, string>();
            const satisfiedBy = new Map<string, string>();

            for (const [, sem] of semesterEntries) {
                const isPast = termIsBefore(sem.term, CURRENT_TERM);
                const targetSet = isPast ? completed : proposed;

                for (const s of sem.sections) {
                    const code = stringifyCourseCode(s.section);
                    const baseKey = courseBaseKey(code);
                    targetSet.add(baseKey);
                    displayNames.set(baseKey, code.trim());
                    depts.set(baseKey, s.section.department);
                    const tags = s.attrs.requirementTags;
                    if (tags && tags.length > 0) {
                        reqTags.set(baseKey, tags);
                        for (const tag of tags) {
                            targetSet.add(courseBaseKey(tag));
                            satisfiedBy.set(courseBaseKey(tag), code.trim());
                        }
                    }

                    const longKey = stringifySectionCodeLong(s.section);
                    const fullSection = sectionsLookup.get(longKey);
                    if (fullSection) {
                        areaCodes.set(baseKey, fullSection.courseAreas);
                    }
                }
            }

            return {
                completedCourses: completed,
                proposedCourses: proposed,
                courseAreaCodes: areaCodes,
                courseRequirementTags: reqTags,
                courseDepartments: depts,
                courseDisplayNames: displayNames,
                tagSatisfiedBy: satisfiedBy,
            };
        }, [semesterEntries, sectionsLookup]);

    if (!schoolData) return null;

    const selectedMajorData = majorKey ? schoolData.majors[majorKey] : undefined;

    return (
        <div className={Css.standardRequirements}>
            <div className={Css.standardReqHeader}>
                <h3>Graduation Requirements</h3>
            </div>

            {schoolData.general_requirements &&
                schoolData.general_requirements.length > 0 &&
                schoolData.general_requirements.map((group, i) => (
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
                ))}

            {selectedMajorData && (
                <>
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
                </>
            )}
        </div>
    );
});

// --- HSA Requirements Panel ---

const HsaRequirementsPanel = memo(function HsaRequirementsPanel({
    semesterEntries,
}: {
    semesterEntries: [string, APIv4.BlockSemester][];
}) {
    // Exclude "Alternatives" from requirement calculations
    const gradEntries = useMemo(
        () => semesterEntries.filter(([, s]) => s.name !== "Alternatives"),
        [semesterEntries],
    );

    // Derive terms from actual section identifiers (not semester term field)
    // so area code lookup works for courses from older terms
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

    // Build course maps, splitting into taken vs proposed
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
                    const baseKey = courseBaseKey(code);
                    targetSet.add(baseKey);
                    displayNames.set(baseKey, code.trim());
                    depts.set(baseKey, s.section.department);
                    const tags = s.attrs.requirementTags;
                    if (tags && tags.length > 0) reqTags.set(baseKey, tags);

                    const longKey = stringifySectionCodeLong(s.section);
                    const fullSection = sectionsLookup.get(longKey);
                    if (fullSection) {
                        areaCodes.set(baseKey, fullSection.courseAreas);
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

    return (
        <div className={Css.hsaRequirements}>
            <h3 className={Css.hsaReqTitle}>HSA Requirements Progress</h3>
            {subCategoryResults.map((sub, i) => (
                <div key={i} className={Css.hsaReqRow}>
                    <div className={Css.hsaReqHeader}>
                        <span className={Css.hsaReqName}>{sub.name}</span>
                        <span className={Css.hsaReqProgress}>
                            {sub.completed}/{sub.required}
                        </span>
                    </div>
                    <div className={Css.hsaReqCourses}>
                        {sub.matched.map((baseKey) => {
                            const isTaken = takenKeys.has(baseKey);
                            const isProp = !isTaken && proposedKeys.has(baseKey);
                            return (
                                <span
                                    key={baseKey}
                                    className={classNames(
                                        Css.hsaReqCourse,
                                        isTaken && Css.hsaReqCompleted,
                                        isProp && Css.hsaReqProposed,
                                    )}
                                >
                                    &#10003;{" "}
                                    {courseDisplayNames.get(baseKey) ?? baseKey}
                                </span>
                            );
                        })}
                        {Array.from(
                            { length: Math.max(0, sub.required - sub.completed) },
                            (_, j) => (
                                <span
                                    key={`empty-${j}`}
                                    className={Css.hsaReqCourse}
                                >
                                    {sub.name} class
                                </span>
                            ),
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
});

// --- Snapshot Viewer (read-only) ---

const SnapshotViewer = memo(function SnapshotViewer({
    snapshot,
    onDelete,
}: {
    snapshot: APIv4.SharedBlockSnapshot;
    onDelete: (id: string) => void;
}) {
    const isHsa = snapshot.planType === "hsa";
    const semesterEntries = Object.entries(snapshot.semesters).sort(
        ([, a], [, b]) => {
            if (a.term.year !== b.term.year) return a.term.year - b.term.year;
            return a.term.term === APIv4.Term.spring ? -1 : 1;
        },
    );

    const status = snapshotStatus(snapshot);

    return (
        <div className={Css.snapshotViewer}>
            <div className={Css.editorHeader}>
                <div>
                    <h2 className={Css.blockTitle}>
                        {snapshot.blockName}
                        {isHsa && <span className={Css.hsaBadge}>HSA</span>}
                        <span className={classNames(Css.snapshotStatusBadge, {
                            [Css.snapshotPending]: status === "pending",
                            [Css.snapshotApproved]: status === "approved",
                            [Css.snapshotRejected]: status === "rejected",
                        })}>
                            {status === "pending" ? "Pending" : status === "approved" ? "Accepted" : "Denied"}
                        </span>
                    </h2>
                    <p className={Css.blockInfo}>
                        {APIv4.schoolCodeToName(snapshot.college)}
                        {snapshot.major && ` | ${snapshot.major}`}
                        {` | Shared ${new Date(snapshot.sharedAt).toLocaleDateString()}`}
                        {` | To: ${snapshot.advisorEmail}`}
                    </p>
                </div>
                <div className={Css.editorActions}>
                    <button
                        className={classNames(
                            AppCss.defaultButton,
                            Css.deleteButton,
                        )}
                        onClick={() => onDelete(snapshot._id)}
                    >
                        Delete Snapshot
                    </button>
                </div>
            </div>

            {/* Approval history */}
            {snapshot.approvals && snapshot.approvals.length > 0 && (
                <div className={Css.approvalHistory}>
                    {snapshot.approvals.map((approval, i) => (
                        <div
                            key={i}
                            className={classNames(Css.shareStatus, {
                                [Css.approvedBanner]: approval.status === "approved",
                                [Css.rejectedBanner]: approval.status === "rejected",
                            })}
                        >
                            <div className={Css.approvalHeader}>
                                <span className={Css.approvalIcon}>
                                    {approval.status === "approved" ? "\u2713" : "\u2717"}
                                </span>
                                <strong>
                                    {approval.status === "approved" ? "Approved" : "Changes requested"} by {approval.advisorName}
                                </strong>
                                <span className={Css.approvalDate}>
                                    {new Date(approval.timestamp).toLocaleDateString()}
                                </span>
                            </div>
                            {approval.comment && (
                                <p className={Css.approvalComment}>
                                    &ldquo;{approval.comment}&rdquo;
                                </p>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Read-only semester view */}
            {isHsa ? (
                <HsaSnapshotView semesterEntries={semesterEntries} />
            ) : (
                <div className={Css.semesterGrid}>
                    {semesterEntries.map(([semId, semester]) => (
                        <ReadOnlySemesterColumn key={semId} semester={semester} />
                    ))}
                </div>
            )}
        </div>
    );
});

/** Read-only semester column for snapshot viewer. */
const ReadOnlySemesterColumn = memo(function ReadOnlySemesterColumn({
    semester,
}: {
    semester: APIv4.BlockSemester;
}) {
    const allTerms = useAllTermsQuery().data;
    const { resolved: dataTerm, isFallback, fallbackNote } = useMemo(
        () => resolveTerm(semester.term, allTerms),
        [semester.term, allTerms],
    );
    const sectionsData = useSectionsQuery(dataTerm).data;
    const sectionLookup = useMemo(() => {
        const map = new Map<string, APIv4.Section>();
        if (!sectionsData) return map;
        for (const s of sectionsData) {
            map.set(stringifySectionCode(s.identifier), s);
        }
        return map;
    }, [sectionsData]);

    const totalCredits = useMemo(() => {
        let credits = 0;
        for (const us of semester.sections) {
            const full = sectionLookup.get(stringifySectionCode(us.section));
            if (full) credits += full.credits;
        }
        return credits;
    }, [semester.sections, sectionLookup]);

    return (
        <div className={Css.semesterColumn}>
            <div className={Css.semesterHeader}>
                <div>
                    <h4>{semester.name}</h4>
                    {semester.sections.length > 0 && (
                        <span className={Css.creditCount}>
                            {totalCredits} credits
                        </span>
                    )}
                </div>
            </div>
            {isFallback && (
                <div className={Css.futureBanner}>{fallbackNote}</div>
            )}
            <div className={Css.sectionList}>
                {semester.sections.map((userSection, i) => {
                    const fullSection = sectionLookup.get(
                        stringifySectionCode(userSection.section),
                    );
                    return (
                        <div key={i} className={Css.sectionItem}>
                            <div className={Css.sectionInfo}>
                                <span className={Css.sectionCode}>
                                    {stringifyCourseCode(userSection.section)}
                                </span>
                                {fullSection && (
                                    <span className={Css.sectionTitle}>
                                        {fullSection.course.title}
                                    </span>
                                )}
                            </div>
                        </div>
                    );
                })}
                {semester.sections.length === 0 && (
                    <p className={Css.emptySections}>No courses</p>
                )}
            </div>
        </div>
    );
});

/** Read-only HSA snapshot view -- shows sub-category groups without drag-and-drop. */
const HsaSnapshotView = memo(function HsaSnapshotView({
    semesterEntries,
}: {
    semesterEntries: [string, APIv4.BlockSemester][];
}) {
    const takenEntry = semesterEntries.find(([, s]) => s.name === "Taken");
    const proposedEntry = semesterEntries.find(([, s]) => s.name === "Proposed");
    const alternativesEntry = semesterEntries.find(([, s]) => s.name === "Alternatives");

    const renderCategory = (
        label: string,
        semEntry: [string, APIv4.BlockSemester] | undefined,
    ) => {
        if (!semEntry) return null;
        const [, semester] = semEntry;

        return (
            <div className={Css.hsaCategory}>
                <h3 className={Css.hsaCategoryTitle}>{label}</h3>
                <div className={Css.hsaGroupGrid}>
                    {HSA_GROUPS.map(({ key, label: groupLabel }) => {
                        const sections = semester.sections.filter((s) => {
                            const tags = s.attrs.requirementTags;
                            return key === undefined
                                ? !tags || tags.length === 0
                                : tags?.includes(key) ?? false;
                        });
                        return (
                            <div key={key ?? "undecided"} className={Css.hsaGroup}>
                                <span className={Css.hsaGroupLabel}>
                                    {groupLabel}
                                </span>
                                {sections.map((s, i) => (
                                    <div key={i} className={Css.hsaCourseItem} style={{ cursor: "default" }}>
                                        <span className={Css.hsaCourseCode}>
                                            {stringifyCourseCode(s.section)}
                                        </span>
                                    </div>
                                ))}
                                {sections.length === 0 && (
                                    <span className={Css.hsaDropHint}>--</span>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

    return (
        <div className={Css.hsaPlanEditor}>
            {renderCategory("Taken", takenEntry)}
            {renderCategory("Proposed", proposedEntry)}
            {renderCategory("Alternatives", alternativesEntry)}
        </div>
    );
});
