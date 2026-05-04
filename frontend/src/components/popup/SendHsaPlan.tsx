import { memo, useCallback, useEffect, useMemo, useState } from "react";
import Css from "./SendHsaPlan.module.css";
import AppCss from "@components/App.module.css";
import {
    apiGetAdvisorLinks,
    apiShareHsaSubmission,
} from "@lib/api";
import * as APIv4 from "hyperschedule-shared/api/v4";
import { useUserStore } from "@hooks/store/user";
import useStore from "@hooks/store";
import { PopupOption } from "@lib/popup";
import { stringifySectionCode } from "hyperschedule-shared/api/v4";
import classNames from "classnames";
import { toast } from "react-toastify";

type Label = APIv4.HsaCourseLabel;

interface Row {
    section: APIv4.SectionIdentifier;
    tag: APIv4.HsaCourseTag;
    label: Label;
}

function sectionKey(s: APIv4.SectionIdentifier): string {
    return `${s.department}-${s.courseNumber}-${s.suffix}-${s.affiliation}-${s.sectionNumber}-${s.year}-${s.term}`;
}

export default memo(function SendHsaPlan() {
    const schedules = useUserStore((u) => u.schedules);
    const setPopup = useStore((s) => s.setPopup);

    const [advisors, setAdvisors] = useState<APIv4.AdvisorLink[]>([]);
    const [advisorEmail, setAdvisorEmail] = useState("");
    const [rows, setRows] = useState<Row[]>([]);
    const [submitting, setSubmitting] = useState(false);
    const [loading, setLoading] = useState(true);

    // Build the unique HSA-tagged courses from all schedules (selected only)
    const hsaCourses = useMemo<Row[]>(() => {
        const seen = new Map<string, Row>();
        for (const schedule of Object.values(schedules)) {
            for (const sec of schedule.sections) {
                if (sec.attrs.selected === false) continue;
                const tag = sec.attrs.requirementTags?.[0];
                if (tag !== "hsa-concentration" && tag !== "hsa-distribution")
                    continue;
                const key = sectionKey(sec.section);
                if (seen.has(key)) continue;
                seen.set(key, {
                    section: sec.section,
                    tag:
                        tag === "hsa-concentration"
                            ? "concentration"
                            : "distribution",
                    label: "planned",
                });
            }
        }
        return [...seen.values()];
    }, [schedules]);

    useEffect(() => {
        setRows(hsaCourses);
    }, [hsaCourses]);

    useEffect(() => {
        let cancelled = false;
        async function load() {
            try {
                const data = await apiGetAdvisorLinks();
                if (cancelled) return;
                const hsaLinks = data.asStudent.filter(
                    (l) => l.status === "accepted" && l.advisorType === "hsa",
                );
                setAdvisors(hsaLinks);
            } catch {
                // toast already shown
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        void load();
        return () => {
            cancelled = true;
        };
    }, []);

    const setRowLabel = useCallback((idx: number, label: Label) => {
        setRows((curr) =>
            curr.map((r, i) => (i === idx ? { ...r, label } : r)),
        );
    }, []);

    const handleSubmit = useCallback(async () => {
        if (!advisorEmail) {
            toast.error("Please select an advisor");
            return;
        }
        if (rows.length === 0) {
            toast.error("No HSA-tagged courses to send");
            return;
        }
        setSubmitting(true);
        try {
            await apiShareHsaSubmission({
                advisorEmail,
                courses: rows.map((r) => ({
                    section: r.section,
                    tag: r.tag,
                    label: r.label,
                })),
            });
            toast.success("HSA plan sent for approval");
            setPopup(null);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to send");
        }
        setSubmitting(false);
    }, [advisorEmail, rows, setPopup]);

    return (
        <div className={Css.container}>
            <h2>Send to HSA Advisor</h2>
            <p className={Css.description}>
                Send the courses you've tagged as HSA Concentration or HSA
                Distribution to your HSA advisor for approval. Mark each as
                planned or alternate.
            </p>

            <div className={Css.advisorRow}>
                <span className={Css.label}>HSA advisor</span>
                {loading ? (
                    <p className={Css.empty}>Loading advisors...</p>
                ) : advisors.length === 0 ? (
                    <div>
                        <p className={Css.empty}>
                            You haven't linked an HSA advisor yet. Link with one
                            and mark them HSA in the advisor manager.
                        </p>
                        <button
                            className={classNames(
                                AppCss.defaultButton,
                                Css.actionButton,
                            )}
                            onClick={() =>
                                setPopup({
                                    option: PopupOption.ManageAdvisors,
                                })
                            }
                        >
                            Manage advisors
                        </button>
                    </div>
                ) : (
                    <select
                        value={advisorEmail}
                        onChange={(e) => setAdvisorEmail(e.target.value)}
                        className={Css.input}
                    >
                        <option value="">Select an advisor…</option>
                        {advisors.map((l) => (
                            <option key={l._id} value={l.advisorEmail}>
                                {l.advisorUsername}
                                {l.advisorEmail
                                    ? ` (${l.advisorEmail})`
                                    : ""}
                            </option>
                        ))}
                    </select>
                )}
            </div>

            <div className={Css.coursesSection}>
                <h3 className={Css.sectionTitle}>HSA-tagged courses</h3>
                {rows.length === 0 ? (
                    <p className={Css.empty}>
                        No courses are tagged as HSA Concentration or HSA
                        Distribution. Tag courses on the Schedule tab first.
                    </p>
                ) : (
                    rows.map((r, idx) => (
                        <div key={sectionKey(r.section)} className={Css.courseRow}>
                            <div className={Css.courseMain}>
                                <span className={Css.courseCode}>
                                    {stringifySectionCode(r.section)}
                                </span>
                                <span className={Css.courseTag}>
                                    {r.tag === "concentration"
                                        ? "Concentration"
                                        : "Distribution"}
                                </span>
                            </div>
                            <div className={Css.radioGroup}>
                                <label className={Css.radioLabel}>
                                    <input
                                        type="radio"
                                        name={`label-${idx}`}
                                        checked={r.label === "planned"}
                                        onChange={() =>
                                            setRowLabel(idx, "planned")
                                        }
                                    />
                                    Planned
                                </label>
                                <label className={Css.radioLabel}>
                                    <input
                                        type="radio"
                                        name={`label-${idx}`}
                                        checked={r.label === "alternate"}
                                        onChange={() =>
                                            setRowLabel(idx, "alternate")
                                        }
                                    />
                                    Alternate
                                </label>
                            </div>
                        </div>
                    ))
                )}
            </div>

            <div className={Css.actions}>
                <button
                    className={classNames(
                        AppCss.defaultButton,
                        Css.actionButton,
                        Css.cancelButton,
                    )}
                    onClick={() => setPopup(null)}
                >
                    Cancel
                </button>
                <button
                    className={classNames(
                        AppCss.defaultButton,
                        Css.actionButton,
                    )}
                    onClick={handleSubmit}
                    disabled={
                        submitting ||
                        !advisorEmail ||
                        rows.length === 0 ||
                        advisors.length === 0
                    }
                >
                    {submitting ? "Sending..." : "Send"}
                </button>
            </div>
        </div>
    );
});
