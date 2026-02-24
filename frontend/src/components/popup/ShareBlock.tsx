import { memo, useState, useCallback } from "react";
import Css from "./ShareBlock.module.css";
import AppCss from "@components/App.module.css";
import { apiFetch } from "@lib/api";
import { useUserStore } from "@hooks/store/user";
import useStore from "@hooks/store";
import type * as APIv4 from "hyperschedule-shared/api/v4";
import classNames from "classnames";
import { toast } from "react-toastify";

export default memo(function ShareBlock({
    blockId,
}: {
    blockId: APIv4.GraduationBlockId;
}) {
    const setPopup = useStore((store) => store.setPopup);
    const getUser = useUserStore((store) => store.getUser);

    const [email, setEmail] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const handleShare = useCallback(async () => {
        if (!email.trim() || !email.includes("@")) {
            toast.error("Please enter a valid email address");
            return;
        }
        setSubmitting(true);
        try {
            await apiFetch.shareBlock({
                blockId,
                advisorEmail: email.trim().toLowerCase(),
            });
            await getUser();
            setPopup(null);
            toast.success("Plan shared with advisor!");
        } catch {
            toast.error("Failed to share plan");
        }
        setSubmitting(false);
    }, [blockId, email, getUser, setPopup]);

    return (
        <div className={Css.container}>
            <h2>Share Graduation Plan</h2>
            <p className={Css.description}>
                Enter your advisor's email to share this plan. They will be able
                to view your planned courses and approve or provide feedback.
            </p>
            <label>
                Advisor Email:
                <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="advisor@hmc.edu"
                    autoFocus
                />
            </label>
            <button
                className={classNames(AppCss.defaultButton, Css.shareButton)}
                onClick={handleShare}
                disabled={submitting}
            >
                {submitting ? "Sharing..." : "Share Plan"}
            </button>
        </div>
    );
});
