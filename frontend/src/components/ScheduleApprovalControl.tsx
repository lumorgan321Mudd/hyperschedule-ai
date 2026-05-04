import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useUserStore } from "@hooks/store/user";
import useStore from "@hooks/store";
import { PopupOption } from "@lib/popup";
import {
    apiShareSchedule,
    apiGetMyScheduleSnapshots,
    apiDeleteScheduleSnapshot,
    apiGetAdvisorLinks,
} from "@lib/api";
import * as APIv4 from "hyperschedule-shared/api/v4";
import AppCss from "@components/App.module.css";
import Css from "./ScheduleApprovalControl.module.css";
import classNames from "classnames";
import { toast } from "react-toastify";
import * as Feather from "react-feather";

export default memo(function ScheduleApprovalControl() {
    const activeScheduleId = useUserStore((s) => s.activeScheduleId);
    const schedules = useUserStore((s) => s.schedules);
    const server = useUserStore((s) => s.server);
    const setPopup = useStore((s) => s.setPopup);
    const isHmcStudent =
        server?.school === APIv4.School.HMC && server?.role !== "advisor";

    const [snapshots, setSnapshots] = useState<APIv4.SharedScheduleSnapshot[]>(
        [],
    );
    const [linkedAdvisors, setLinkedAdvisors] = useState<APIv4.AdvisorLink[]>(
        [],
    );
    const [loading, setLoading] = useState(false);
    const [showShareForm, setShowShareForm] = useState(false);
    const [advisorEmail, setAdvisorEmail] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const refresh = useCallback(async () => {
        if (!server) return;
        setLoading(true);
        try {
            const [r, links] = await Promise.all([
                apiGetMyScheduleSnapshots(),
                apiGetAdvisorLinks(),
            ]);
            setSnapshots(r.snapshots);
            // Exclude HSA-typed advisors — they're sent to via the
            // dedicated "Send to HSA Advisor" flow.
            setLinkedAdvisors(
                links.asStudent.filter(
                    (l) =>
                        l.status === "accepted" && l.advisorType !== "hsa",
                ),
            );
        } catch {
            // toast already shown
        } finally {
            setLoading(false);
        }
    }, [server]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    // Find the most recent snapshot for the active schedule
    const currentSnapshot = useMemo(() => {
        if (!activeScheduleId) return undefined;
        const matching = snapshots.filter(
            (s) => s.scheduleId === activeScheduleId,
        );
        matching.sort(
            (a, b) =>
                new Date(b.sharedAt).getTime() -
                new Date(a.sharedAt).getTime(),
        );
        return matching[0];
    }, [snapshots, activeScheduleId]);

    const latestApproval = currentSnapshot?.approvals?.length
        ? currentSnapshot.approvals[currentSnapshot.approvals.length - 1]
        : undefined;

    const status: "none" | "pending" | "approved" | "rejected" = !currentSnapshot
        ? "none"
        : !latestApproval
          ? "pending"
          : latestApproval.status;

    const handleSubmit = useCallback(
        async (e: React.FormEvent) => {
            e.preventDefault();
            if (!activeScheduleId || !advisorEmail.trim()) return;
            setSubmitting(true);
            try {
                await apiShareSchedule({
                    scheduleId: activeScheduleId,
                    advisorEmail: advisorEmail.trim(),
                });
                toast.success("Schedule sent for approval");
                setShowShareForm(false);
                setAdvisorEmail("");
                await refresh();
            } catch {
                // toast shown
            } finally {
                setSubmitting(false);
            }
        },
        [activeScheduleId, advisorEmail, refresh],
    );

    const handleWithdraw = useCallback(async () => {
        if (!currentSnapshot) return;
        if (!confirm("Withdraw this submission?")) return;
        try {
            await apiDeleteScheduleSnapshot(currentSnapshot._id);
            toast.success("Submission withdrawn");
            await refresh();
        } catch {
            // toast shown
        }
    }, [currentSnapshot, refresh]);

    // Hide entirely for guests / no active schedule
    if (!server || !activeScheduleId || !schedules[activeScheduleId])
        return null;

    return (
        <div className={Css.container}>
            <div className={Css.advisorsRow}>
                <span className={Css.label}>
                    My advisors{" "}
                    {linkedAdvisors.length > 0 && `(${linkedAdvisors.length})`}
                </span>
                <button
                    className={classNames(
                        AppCss.defaultButton,
                        Css.actionButton,
                    )}
                    onClick={() =>
                        setPopup({ option: PopupOption.ManageAdvisors })
                    }
                >
                    <Feather.Users size={12} /> Manage
                </button>
                {isHmcStudent && (
                    <button
                        className={classNames(
                            AppCss.defaultButton,
                            Css.actionButton,
                        )}
                        onClick={() =>
                            setPopup({ option: PopupOption.SendHsaPlan })
                        }
                        title="Send your HSA-tagged courses to your HSA advisor"
                    >
                        Send to HSA Advisor
                    </button>
                )}
            </div>
            <div className={Css.statusRow}>
                <span className={Css.label}>Advisor approval:</span>
                <span
                    className={classNames(Css.badge, {
                        [Css.approved]: status === "approved",
                        [Css.rejected]: status === "rejected",
                        [Css.pending]: status === "pending",
                        [Css.none]: status === "none",
                    })}
                >
                    {status === "approved" && (
                        <>
                            <Feather.Check size={12} /> Approved
                        </>
                    )}
                    {status === "rejected" && (
                        <>
                            <Feather.X size={12} /> Revoked
                        </>
                    )}
                    {status === "pending" && "Pending"}
                    {status === "none" && "Not submitted"}
                </span>
                {!showShareForm && status === "none" && (
                    <button
                        className={classNames(
                            AppCss.defaultButton,
                            Css.actionButton,
                        )}
                        onClick={() => setShowShareForm(true)}
                        disabled={loading}
                    >
                        Send for approval
                    </button>
                )}
                {currentSnapshot && (
                    <button
                        className={classNames(
                            AppCss.defaultButton,
                            Css.actionButton,
                            Css.withdrawButton,
                        )}
                        onClick={handleWithdraw}
                        title="Withdraw your submission"
                    >
                        Withdraw
                    </button>
                )}
            </div>

            {latestApproval?.comment && (
                <div className={Css.comment}>
                    <strong>{latestApproval.advisorName}:</strong>{" "}
                    {latestApproval.comment}
                </div>
            )}

            {showShareForm &&
                (linkedAdvisors.length === 0 ? (
                    <div className={Css.form}>
                        <p className={Css.noAdvisorsHint}>
                            You don't have any linked advisors yet. Link with an
                            advisor before sharing.
                        </p>
                        <div className={Css.formActions}>
                            <button
                                type="button"
                                className={classNames(
                                    AppCss.defaultButton,
                                    Css.actionButton,
                                )}
                                onClick={() => {
                                    setShowShareForm(false);
                                    setPopup({ option: PopupOption.ManageAdvisors });
                                }}
                            >
                                Manage advisors
                            </button>
                            <button
                                type="button"
                                className={classNames(
                                    AppCss.defaultButton,
                                    Css.actionButton,
                                    Css.cancelButton,
                                )}
                                onClick={() => setShowShareForm(false)}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                ) : (
                    <form className={Css.form} onSubmit={handleSubmit}>
                        <select
                            required
                            value={advisorEmail}
                            onChange={(e) => setAdvisorEmail(e.target.value)}
                            className={Css.input}
                            autoFocus
                        >
                            <option value="">Select an advisor…</option>
                            {linkedAdvisors.map((l) => (
                                <option key={l._id} value={l.advisorEmail}>
                                    {l.advisorUsername}
                                    {l.advisorEmail ? ` (${l.advisorEmail})` : ""}
                                </option>
                            ))}
                        </select>
                        <div className={Css.formActions}>
                            <button
                                type="button"
                                className={Css.linkButton}
                                onClick={() =>
                                    setPopup({
                                        option: PopupOption.ManageAdvisors,
                                    })
                                }
                            >
                                Manage advisors
                            </button>
                            <button
                                type="submit"
                                disabled={submitting || !advisorEmail}
                                className={classNames(
                                    AppCss.defaultButton,
                                    Css.actionButton,
                                )}
                            >
                                {submitting ? "Sending..." : "Send"}
                            </button>
                            <button
                                type="button"
                                className={classNames(
                                    AppCss.defaultButton,
                                    Css.actionButton,
                                    Css.cancelButton,
                                )}
                                onClick={() => {
                                    setShowShareForm(false);
                                    setAdvisorEmail("");
                                }}
                            >
                                Cancel
                            </button>
                        </div>
                    </form>
                ))}
        </div>
    );
});
