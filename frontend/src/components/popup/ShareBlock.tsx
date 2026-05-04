import { memo, useState, useCallback, useEffect } from "react";
import Css from "./ShareBlock.module.css";
import AppCss from "@components/App.module.css";
import { apiFetch, apiGetAdvisorLinks } from "@lib/api";
import { useUserStore } from "@hooks/store/user";
import useStore from "@hooks/store";
import { PopupOption } from "@lib/popup";
import type * as APIv4 from "hyperschedule-shared/api/v4";
import classNames from "classnames";
import { toast } from "react-toastify";

export default memo(function ShareBlock({
    blockId,
    planType,
}: {
    blockId: APIv4.GraduationBlockId;
    planType?: string;
}) {
    const isHsa = planType === "hsa";
    const setPopup = useStore((store) => store.setPopup);
    const getUser = useUserStore((store) => store.getUser);

    const [advisorEmail, setAdvisorEmail] = useState("");
    const [linkedAdvisors, setLinkedAdvisors] = useState<APIv4.AdvisorLink[]>(
        [],
    );
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const links = await apiGetAdvisorLinks();
                if (cancelled) return;
                setLinkedAdvisors(
                    links.asStudent.filter((l) => l.status === "accepted"),
                );
            } catch {
                // toast already shown
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const handleShare = useCallback(async () => {
        if (!advisorEmail) {
            toast.error("Please select an advisor");
            return;
        }
        setSubmitting(true);
        try {
            await apiFetch.shareBlock({
                blockId,
                advisorEmail,
            });
            await getUser();
            setPopup(null);
            toast.success("Plan shared with advisor!");
        } catch {
            toast.error("Failed to share plan");
        }
        setSubmitting(false);
    }, [blockId, advisorEmail, getUser, setPopup]);

    return (
        <div className={Css.container}>
            <h2>{isHsa ? "Share HSA Plan" : "Share Graduation Plan"}</h2>
            <p className={Css.description}>
                {isHsa
                    ? "Pick your HSA advisor to share this plan. They'll be able to view your HSA courses and approve or provide feedback."
                    : "Pick your advisor to share this plan. They'll be able to view your planned courses and approve or provide feedback."}
            </p>
            {loading ? (
                <p className={Css.description}>Loading…</p>
            ) : linkedAdvisors.length === 0 ? (
                <>
                    <p className={Css.description}>
                        You don't have any linked advisors yet. Link with an
                        advisor before sharing.
                    </p>
                    <button
                        className={classNames(AppCss.defaultButton, Css.shareButton)}
                        onClick={() =>
                            setPopup({ option: PopupOption.ManageAdvisors })
                        }
                    >
                        Manage advisors
                    </button>
                </>
            ) : (
                <>
                    <label>
                        Advisor:
                        <select
                            value={advisorEmail}
                            onChange={(e) => setAdvisorEmail(e.target.value)}
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
                    </label>
                    <button
                        className={classNames(AppCss.defaultButton, Css.shareButton)}
                        onClick={handleShare}
                        disabled={submitting || !advisorEmail}
                    >
                        {submitting ? "Sharing..." : "Share Plan"}
                    </button>
                </>
            )}
        </div>
    );
});
