import { memo, useState, useCallback, useMemo, useRef, useEffect } from "react";
import Css from "./GraduationPlan.module.css";
import AppCss from "@components/App.module.css";
import { useUserStore } from "@hooks/store/user";
import useStore from "@hooks/store";
import { PopupOption } from "@lib/popup";
import { apiBlockAction, apiBlockSemesterAction } from "@lib/api";
import * as APIv4 from "hyperschedule-shared/api/v4";
import {
    stringifyCourseCode,
    stringifySectionCode,
} from "hyperschedule-shared/api/v4";
import classNames from "classnames";
import { toast } from "react-toastify";
import { useSectionsQuery, useAllTermsQuery } from "@hooks/api/query";
import { CURRENT_TERM } from "hyperschedule-shared/api/current-term";
import * as Search from "@lib/search";

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

export default memo(function GraduationPlan() {
    const server = useUserStore((store) => store.server);
    const graduationBlocks = useUserStore((store) => store.graduationBlocks);
    const getUser = useUserStore((store) => store.getUser);
    const setPopup = useStore((store) => store.setPopup);

    const [activeBlockId, setActiveBlockId] = useState<string | null>(null);

    const blockEntries = Object.entries(graduationBlocks);
    const activeBlock = activeBlockId ? graduationBlocks[activeBlockId] : null;

    const handleDeleteBlock = useCallback(
        async (blockId: string) => {
            if (!server) return;
            try {
                const response = await apiBlockAction(blockId, "DELETE");
                if (response.ok) {
                    if (activeBlockId === blockId) setActiveBlockId(null);
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
                    <button
                        className={classNames(
                            AppCss.defaultButton,
                            Css.createButton,
                        )}
                        onClick={() =>
                            setPopup({ option: PopupOption.CreateBlock })
                        }
                    >
                        + New Plan
                    </button>
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
                                [Css.active]: activeBlockId === id,
                            })}
                            onClick={() => setActiveBlockId(id)}
                        >
                            <span className={Css.blockName}>{block.name}</span>
                            <span className={Css.blockMeta}>
                                {APIv4.schoolCodeToName(block.college)}
                                {block.major && ` - ${block.major}`}
                            </span>
                            {block.dirtyAfterShare && (
                                <span className={Css.dirtyBadge}>
                                    Edited since shared
                                </span>
                            )}
                            {block.shares?.some(
                                (s) => s.approvalStatus === "approved",
                            ) && (
                                <span className={Css.approvedBadge}>
                                    &#10003; Approved
                                </span>
                            )}
                            {block.shares?.some(
                                (s) => s.approvalStatus === "rejected",
                            ) &&
                                !block.shares?.some(
                                    (s) => s.approvalStatus === "approved",
                                ) && (
                                    <span className={Css.rejectedBadge}>
                                        Changes requested
                                    </span>
                                )}
                            {block.shares &&
                                block.shares.length > 0 &&
                                !block.shares.some(
                                    (s) => s.approvalStatus,
                                ) && (
                                    <span className={Css.sharedBadge}>
                                        Shared
                                    </span>
                                )}
                        </div>
                    ))}
                </div>
            </div>

            <div className={Css.editor}>
                {!activeBlock ? (
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
                            })
                        }
                        onRefresh={getUser}
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

const BlockEditor = memo(function BlockEditor({
    blockId,
    block,
    onDeleteBlock,
    onAddSemester,
    onDeleteSemester,
    onUpdateSections,
    onShare,
    onRefresh,
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
    onRefresh: () => Promise<void>;
}) {
    const [showAddSemester, setShowAddSemester] = useState(false);

    const semesterEntries = Object.entries(block.semesters).sort(
        ([, a], [, b]) => {
            if (a.term.year !== b.term.year) return a.term.year - b.term.year;
            return a.term.term === APIv4.Term.spring ? -1 : 1;
        },
    );
    const existingTerms = semesterEntries.map(([, s]) => s.term);

    return (
        <div className={Css.blockEditor}>
            <div className={Css.editorHeader}>
                <div>
                    <h2 className={Css.blockTitle}>{block.name}</h2>
                    <p className={Css.blockInfo}>
                        {APIv4.schoolCodeToName(block.college)}
                        {block.major && ` | ${block.major}`}
                        {` | ${semesterEntries.length} semester${semesterEntries.length !== 1 ? "s" : ""}`}
                    </p>
                </div>
                <div className={Css.editorActions}>
                    {block.dirtyAfterShare && (
                        <button
                            className={classNames(
                                AppCss.defaultButton,
                                Css.updateButton,
                            )}
                            onClick={onShare}
                        >
                            Update for Advisor
                        </button>
                    )}
                    <button
                        className={classNames(AppCss.defaultButton)}
                        onClick={onShare}
                    >
                        Share
                    </button>
                    <button
                        className={classNames(AppCss.defaultButton)}
                        onClick={() => setShowAddSemester(true)}
                    >
                        + Semester
                    </button>
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

            {showAddSemester && (
                <AddSemesterPicker
                    existingTerms={existingTerms}
                    onAdd={(term, importSections) => {
                        onAddSemester(blockId, term, importSections);
                        setShowAddSemester(false);
                    }}
                    onCancel={() => setShowAddSemester(false)}
                />
            )}

            {block.shares && block.shares.length > 0 &&
                block.shares.map((share, i) => (
                    <div
                        key={i}
                        className={classNames(Css.shareStatus, {
                            [Css.approvedBanner]:
                                share.approvalStatus === "approved",
                            [Css.rejectedBanner]:
                                share.approvalStatus === "rejected",
                        })}
                    >
                        {share.approvalStatus === "approved" && (
                            <div className={Css.approvalHeader}>
                                <span className={Css.approvalIcon}>
                                    &#10003;
                                </span>
                                <strong>
                                    Approved by {share.approvalAdvisorName}
                                </strong>
                                {share.approvalTimestamp && (
                                    <span className={Css.approvalDate}>
                                        {new Date(
                                            share.approvalTimestamp,
                                        ).toLocaleDateString()}
                                    </span>
                                )}
                            </div>
                        )}
                        {share.approvalStatus === "rejected" && (
                            <div className={Css.approvalHeader}>
                                <span className={Css.approvalIcon}>
                                    &#10007;
                                </span>
                                <strong>
                                    Changes requested by{" "}
                                    {share.approvalAdvisorName}
                                </strong>
                                {share.approvalTimestamp && (
                                    <span className={Css.approvalDate}>
                                        {new Date(
                                            share.approvalTimestamp,
                                        ).toLocaleDateString()}
                                    </span>
                                )}
                            </div>
                        )}
                        {share.approvalComment && (
                            <p className={Css.approvalComment}>
                                &ldquo;{share.approvalComment}&rdquo;
                            </p>
                        )}
                        {!share.approvalStatus && (
                            <div className={Css.shareItem}>
                                Shared with {share.advisorEmail} on{" "}
                                {new Date(
                                    share.lastSharedAt,
                                ).toLocaleDateString()}{" "}
                                &mdash; awaiting review
                            </div>
                        )}
                    </div>
                ))}

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
                    />
                ))}
            </div>
        </div>
    );
});

// --- Course Search within a Semester ---

const CourseSearchBox = memo(function CourseSearchBox({
    term,
    onAdd,
    existingSections,
}: {
    term: APIv4.TermIdentifier;
    onAdd: (section: APIv4.Section) => void;
    existingSections: APIv4.SectionIdentifier[];
}) {
    const [query, setQuery] = useState("");
    const [focused, setFocused] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Fetch sections for this semester's term
    const sectionsData = useSectionsQuery(term).data;

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
                <div className={Css.searchResults}>
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
                    <div className={Css.searchResults}>
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

const SemesterColumn = memo(function SemesterColumn({
    blockId,
    semesterId,
    semester,
    onDelete,
    onUpdateSections,
}: {
    blockId: string;
    semesterId: string;
    semester: APIv4.BlockSemester;
    onDelete: () => void;
    onUpdateSections: (sections: APIv4.UserSection[]) => void;
}) {
    // Resolve term: for future terms, fall back to most recent available
    const allTerms = useAllTermsQuery().data;
    const { resolved: dataTerm, isFallback, fallbackNote } = useMemo(
        () => resolveTerm(semester.term, allTerms),
        [semester.term, allTerms],
    );

    const [showImport, setShowImport] = useState(false);

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
            />
        </div>
    );
});
