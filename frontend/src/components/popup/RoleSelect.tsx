import { memo, useCallback } from "react";
import Css from "./RoleSelect.module.css";
import AppCss from "@components/App.module.css";
import { apiFetch } from "@lib/api";
import { useUserStore } from "@hooks/store/user";
import useStore from "@hooks/store";
import classNames from "classnames";
import { toast } from "react-toastify";

export default memo(function RoleSelect() {
    const setPopup = useStore((store) => store.setPopup);
    const getUser = useUserStore((store) => store.getUser);

    const handleSelect = useCallback(
        async (role: "student" | "advisor") => {
            try {
                await apiFetch.setRole({ role });
                await getUser();
                setPopup(null);
                toast.success(
                    role === "student"
                        ? "Welcome, student!"
                        : "Welcome, advisor!",
                );
            } catch {
                toast.error("Failed to set role");
            }
        },
        [getUser, setPopup],
    );

    return (
        <div className={Css.container}>
            <h2 className={Css.title}>Welcome to Hyperschedule!</h2>
            <p className={Css.description}>
                How will you be using Hyperschedule? You can change this later in
                Settings.
            </p>
            <div className={Css.options}>
                <button
                    className={classNames(AppCss.defaultButton, Css.roleButton)}
                    onClick={() => handleSelect("student")}
                >
                    <span className={Css.roleTitle}>Student</span>
                    <span className={Css.roleDescription}>
                        Search courses, plan schedules, and track graduation
                        progress
                    </span>
                </button>
                <button
                    className={classNames(AppCss.defaultButton, Css.roleButton)}
                    onClick={() => handleSelect("advisor")}
                >
                    <span className={Css.roleTitle}>Advisor</span>
                    <span className={Css.roleDescription}>
                        Review and approve student graduation plans
                    </span>
                </button>
            </div>
        </div>
    );
});
