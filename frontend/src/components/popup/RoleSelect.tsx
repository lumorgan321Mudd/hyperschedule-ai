import { memo, useCallback } from "react";
import Css from "./RoleSelect.module.css";
import { apiFetch } from "@lib/api";
import { useUserStore } from "@hooks/store/user";
import useStore from "@hooks/store";
import { toast } from "react-toastify";
import * as Feather from "react-feather";

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
            <div className={Css.header}>
                <Feather.Calendar className={Css.headerIcon} size={32} />
                <h2 className={Css.title}>Welcome to Hyperschedule</h2>
                <p className={Css.subtitle}>
                    Let us know how you'll be using Hyperschedule so we can
                    tailor your experience.
                </p>
            </div>

            <div className={Css.options}>
                <button
                    className={Css.roleCard}
                    onClick={() => handleSelect("student")}
                >
                    <div className={Css.iconCircle}>
                        <Feather.BookOpen size={28} />
                    </div>
                    <span className={Css.roleTitle}>Student</span>
                    <span className={Css.roleDescription}>
                        Search courses, build schedules, plan your graduation,
                        and share plans with your advisor.
                    </span>
                </button>

                <button
                    className={Css.roleCard}
                    onClick={() => handleSelect("advisor")}
                >
                    <div className={Css.iconCircle}>
                        <Feather.Clipboard size={28} />
                    </div>
                    <span className={Css.roleTitle}>Advisor</span>
                    <span className={Css.roleDescription}>
                        Review student graduation plans, check degree progress,
                        and provide approval.
                    </span>
                </button>
            </div>

            <p className={Css.footnote}>
                You can change this anytime in Settings.
            </p>
        </div>
    );
});
