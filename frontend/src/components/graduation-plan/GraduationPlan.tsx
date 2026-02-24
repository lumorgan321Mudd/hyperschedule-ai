import { memo, useState, useCallback } from "react";
import Css from "./GraduationPlan.module.css";
import AppCss from "@components/App.module.css";
import { useUserStore } from "@hooks/store/user";
import useStore from "@hooks/store";
import { PopupOption } from "@lib/popup";
import {
    apiFetch,
    apiBlockAction,
    apiBlockSemesterAction,
} from "@lib/api";
import * as APIv4 from "hyperschedule-shared/api/v4";
import { stringifyCourseCode } from "hyperschedule-shared/api/v4";
import classNames from "classnames";
import { toast } from "react-toastify";

export default memo(function GraduationPlan() {
    const server = useUserStore((store) => store.server);
    const graduationBlocks = useUserStore((store) => store.graduationBlocks);
    const getUser = useUserStore((store) => store.getUser);
    const setPopup = useStore((store) => store.setPopup);

    const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
    const [activeSemesterId, setActiveSemesterId] = useState<string | null>(
        null,
    );

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
        async (blockId: string) => {
            if (!server) return;
            const block = graduationBlocks[blockId];
            // Find the next term after existing semesters
            const existing = block
                ? Object.values(block.semesters).map((s) => s.term)
                : [];
            let nextTerm: APIv4.TermIdentifier;
            if (existing.length === 0) {
                nextTerm = { term: APIv4.Term.spring, year: 2026 };
            } else {
                const sorted = [...existing].sort((a, b) => {
                    if (a.year !== b.year) return a.year - b.year;
                    return a.term === APIv4.Term.spring ? -1 : 1;
                });
                const last = sorted[sorted.length - 1]!;
                if (last.term === APIv4.Term.spring) {
                    nextTerm = { term: APIv4.Term.fall, year: last.year };
                } else {
                    nextTerm = {
                        term: APIv4.Term.spring,
                        year: last.year + 1,
                    };
                }
            }
            const termName =
                (nextTerm.term === APIv4.Term.spring ? "Spring" : "Fall") +
                " " +
                nextTerm.year;
            try {
                const response = await apiBlockSemesterAction(
                    blockId,
                    undefined,
                    "POST",
                    { term: nextTerm, name: termName },
                );
                if (response.ok) {
                    await getUser();
                    toast.success("Semester added");
                }
            } catch {
                toast.error("Failed to add semester");
            }
        },
        [server, getUser, graduationBlocks],
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
                            {block.shares && block.shares.length > 0 && (
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

const BlockEditor = memo(function BlockEditor({
    blockId,
    block,
    onDeleteBlock,
    onAddSemester,
    onDeleteSemester,
    onShare,
    onRefresh,
}: {
    blockId: string;
    block: APIv4.GraduationBlock;
    onDeleteBlock: (id: string) => void;
    onAddSemester: (id: string) => void;
    onDeleteSemester: (blockId: string, semId: string) => void;
    onShare: () => void;
    onRefresh: () => Promise<void>;
}) {
    const semesterEntries = Object.entries(block.semesters);

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
                        onClick={() => onAddSemester(blockId)}
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

            {/* Show share/approval status */}
            {block.shares && block.shares.length > 0 && (
                <div className={Css.shareStatus}>
                    {block.shares.map((share, i) => (
                        <div key={i} className={Css.shareItem}>
                            Shared with {share.advisorEmail} on{" "}
                            {new Date(share.lastSharedAt).toLocaleDateString()}
                        </div>
                    ))}
                </div>
            )}

            <div className={Css.semesterGrid}>
                {semesterEntries.length === 0 && (
                    <p className={Css.emptyMessage}>
                        No semesters yet. Add one to start planning courses.
                    </p>
                )}
                {semesterEntries.map(([semId, semester]) => (
                    <SemesterColumn
                        key={semId}
                        semesterId={semId}
                        semester={semester}
                        onDelete={() => onDeleteSemester(blockId, semId)}
                    />
                ))}
            </div>
        </div>
    );
});

const SemesterColumn = memo(function SemesterColumn({
    semesterId,
    semester,
    onDelete,
}: {
    semesterId: string;
    semester: APIv4.BlockSemester;
    onDelete: () => void;
}) {
    return (
        <div className={Css.semesterColumn}>
            <div className={Css.semesterHeader}>
                <h4>{semester.name}</h4>
                <button
                    className={Css.semesterDeleteButton}
                    onClick={onDelete}
                    title="Remove semester"
                >
                    x
                </button>
            </div>
            {semester.isFutureTerm && (
                <div className={Css.futureBanner}>
                    Future term
                    {semester.sourceTermNote && ` - ${semester.sourceTermNote}`}
                </div>
            )}
            <div className={Css.sectionList}>
                {semester.sections.length === 0 && (
                    <p className={Css.emptySections}>No courses added</p>
                )}
                {semester.sections.map((userSection, i) => (
                    <div key={i} className={Css.sectionItem}>
                        <span className={Css.sectionCode}>
                            {stringifyCourseCode(userSection.section)}
                        </span>
                        <span className={Css.sectionSchool}>
                            {userSection.section.affiliation}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
});
