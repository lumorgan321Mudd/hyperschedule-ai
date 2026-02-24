import { memo, useEffect, useState, useCallback } from "react";
import Css from "./AdvisorPortal.module.css";
import AppCss from "@components/App.module.css";
import { apiFetch, apiApproveSnapshot } from "@lib/api";
import * as APIv4 from "hyperschedule-shared/api/v4";
import { stringifyCourseCode } from "hyperschedule-shared/api/v4";
import classNames from "classnames";
import { toast } from "react-toastify";

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

    const semesterEntries = Object.entries(snapshot.semesters);

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
