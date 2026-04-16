import Css from "./Login.module.css";
import AppCss from "@components/App.module.css";
import useStore from "@hooks/store";
import { useUserStore } from "@hooks/store/user";
import classNames from "classnames";
import { useState } from "react";
import {
    SUPPORTED_CLASS_YEARS,
    CLASS_YEAR_TO_CATALOG,
} from "hyperschedule-shared/api/v4/graduation-block";

const COLLEGES = [
    "Harvey Mudd College",
    "Pomona College",
    "Claremont McKenna College",
    "Scripps College",
    "Pitzer College",
] as const;

export default function Login(props: { continuation?: () => void }) {
    const confirmGuest = useUserStore((store) => store.confirmGuest);
    const getUser = useUserStore((store) => store.getUser);
    const setPopup = useStore((store) => store.setPopup);

    const [email, setEmail] = useState("student@hmc.edu");
    const [college, setCollege] = useState<string>(COLLEGES[0]);
    const [classYear, setClassYear] = useState<number>(
        SUPPORTED_CLASS_YEARS[SUPPORTED_CLASS_YEARS.length - 1] ?? 2029,
    );
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleLogin() {
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({
                eppn: email,
                org: college,
                classYear: String(classYear),
            });
            const res = await fetch(
                `${__API_URL__}/auth/dev-login?${params}`,
                { method: "POST", credentials: "include" },
            );
            if (!res.ok) {
                throw new Error(`Login failed (${res.status})`);
            }
            await getUser();
            setPopup(null);
            props.continuation?.();
        } catch (e) {
            setError(e instanceof Error ? e.message : "Login failed");
        } finally {
            setLoading(false);
        }
    }

    function handleGuest() {
        confirmGuest();
        setPopup(null);
        props.continuation?.();
    }

    return (
        <div className={Css.loginBox}>
            <div className={Css.loginForm}>
                <h3 className={Css.formTitle}>Log in to Hyperschedule+</h3>

                <label className={Css.field}>
                    <span>Email</span>
                    <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className={Css.input}
                    />
                </label>

                <label className={Css.field}>
                    <span>College</span>
                    <select
                        value={college}
                        onChange={(e) => setCollege(e.target.value)}
                        className={Css.input}
                    >
                        {COLLEGES.map((c) => (
                            <option key={c} value={c}>
                                {c}
                            </option>
                        ))}
                    </select>
                </label>

                <label className={Css.field}>
                    <span>Class Year</span>
                    <select
                        value={classYear}
                        onChange={(e) =>
                            setClassYear(Number(e.target.value))
                        }
                        className={Css.input}
                    >
                        {SUPPORTED_CLASS_YEARS.map((y) => (
                            <option key={y} value={y}>
                                Class of {y} ({CLASS_YEAR_TO_CATALOG[y]}{" "}
                                catalog)
                            </option>
                        ))}
                    </select>
                </label>

                {error && <p className={Css.error}>{error}</p>}

                <div className={Css.actions}>
                    <button
                        className={classNames(
                            AppCss.defaultButton,
                            Css.loginButton,
                        )}
                        onClick={handleLogin}
                        disabled={loading}
                    >
                        {loading ? "Logging in..." : "Log In"}
                    </button>
                    <button
                        className={classNames(
                            AppCss.defaultButton,
                            Css.guestButton,
                        )}
                        onClick={handleGuest}
                    >
                        Continue as Guest
                    </button>
                </div>
            </div>
        </div>
    );
}
