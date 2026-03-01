import { memo, useState, useCallback } from "react";
import Css from "./CreateBlock.module.css";
import AppCss from "@components/App.module.css";
import { apiFetch, apiBlockSemesterAction } from "@lib/api";
import { useUserStore } from "@hooks/store/user";
import useStore from "@hooks/store";
import * as APIv4 from "hyperschedule-shared/api/v4";
import classNames from "classnames";
import { toast } from "react-toastify";
import { CURRENT_TERM } from "hyperschedule-shared/api/current-term";

export default memo(function CreateHsaBlock() {
    const setPopup = useStore((store) => store.setPopup);
    const getUser = useUserStore((store) => store.getUser);
    const server = useUserStore((store) => store.server);

    const [name, setName] = useState("My HSA Plan");
    const [submitting, setSubmitting] = useState(false);

    const handleCreate = useCallback(async () => {
        if (!name.trim()) {
            toast.error("Please enter a plan name");
            return;
        }
        setSubmitting(true);
        try {
            const result = await apiFetch.createBlock({
                name: name.trim(),
                college: server?.school ?? APIv4.School.HMC,
                planType: "hsa",
            });
            const blockId = result.blockId;

            // Auto-create Taken, Proposed, and Alternatives semesters
            await apiBlockSemesterAction(blockId, undefined, "POST", {
                term: CURRENT_TERM,
                name: "Taken",
            });
            await apiBlockSemesterAction(blockId, undefined, "POST", {
                term: CURRENT_TERM,
                name: "Proposed",
            });
            await apiBlockSemesterAction(blockId, undefined, "POST", {
                term: CURRENT_TERM,
                name: "Alternatives",
            });

            await getUser();
            setPopup(null);
            toast.success("HSA Plan created!");
        } catch {
            toast.error("Failed to create HSA plan");
        }
        setSubmitting(false);
    }, [name, server, getUser, setPopup]);

    return (
        <div className={Css.container}>
            <h2>Create HSA Plan</h2>
            <p style={{ fontSize: "0.85rem", color: "var(--fg-2)", margin: 0 }}>
                Create a plan to organize your HSA courses into Taken and
                Proposed categories with Concentration/Distribution tagging.
            </p>
            <label>
                Plan Name:
                <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., My HSA Plan"
                    maxLength={100}
                    autoFocus
                />
            </label>
            <button
                className={classNames(AppCss.defaultButton, Css.createButton)}
                onClick={handleCreate}
                disabled={submitting}
                style={{ backgroundColor: "var(--palette-purple, #8b5cf6)", borderColor: "var(--palette-purple, #8b5cf6)" }}
            >
                {submitting ? "Creating..." : "Create HSA Plan"}
            </button>
        </div>
    );
});
