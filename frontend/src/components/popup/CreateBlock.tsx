import { memo, useState, useCallback } from "react";
import Css from "./CreateBlock.module.css";
import AppCss from "@components/App.module.css";
import { apiFetch } from "@lib/api";
import { useUserStore } from "@hooks/store/user";
import useStore from "@hooks/store";
import * as APIv4 from "hyperschedule-shared/api/v4";
import classNames from "classnames";
import { toast } from "react-toastify";

const COLLEGES: { value: APIv4.School; label: string }[] = [
    { value: APIv4.School.HMC, label: "Harvey Mudd College" },
    { value: APIv4.School.POM, label: "Pomona College" },
    { value: APIv4.School.SCR, label: "Scripps College" },
    { value: APIv4.School.CMC, label: "Claremont McKenna College" },
    { value: APIv4.School.PTZ, label: "Pitzer College" },
];

export default memo(function CreateBlock() {
    const setPopup = useStore((store) => store.setPopup);
    const getUser = useUserStore((store) => store.getUser);
    const server = useUserStore((store) => store.server);

    const [name, setName] = useState("");
    const [college, setCollege] = useState<APIv4.School>(
        server?.school ?? APIv4.School.HMC,
    );
    const [major, setMajor] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const handleCreate = useCallback(async () => {
        if (!name.trim()) {
            toast.error("Please enter a plan name");
            return;
        }
        setSubmitting(true);
        try {
            await apiFetch.createBlock({
                name: name.trim(),
                college,
                ...(major.trim() ? { major: major.trim() } : {}),
            });
            await getUser();
            setPopup(null);
            toast.success("Plan created!");
        } catch {
            toast.error("Failed to create plan");
        }
        setSubmitting(false);
    }, [name, college, major, getUser, setPopup]);

    return (
        <div className={Css.container}>
            <h2>Create Graduation Plan</h2>
            <label>
                Plan Name:
                <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., My 4-Year CS Plan"
                    maxLength={100}
                    autoFocus
                />
            </label>
            <label>
                College:
                <select
                    value={college}
                    onChange={(e) =>
                        setCollege(e.target.value as APIv4.School)
                    }
                >
                    {COLLEGES.map((c) => (
                        <option key={c.value} value={c.value}>
                            {c.label}
                        </option>
                    ))}
                </select>
            </label>
            <label>
                Major (optional):
                <input
                    type="text"
                    value={major}
                    onChange={(e) => setMajor(e.target.value)}
                    placeholder="e.g., Computer Science"
                />
            </label>
            <button
                className={classNames(AppCss.defaultButton, Css.createButton)}
                onClick={handleCreate}
                disabled={submitting}
            >
                {submitting ? "Creating..." : "Create Plan"}
            </button>
        </div>
    );
});
