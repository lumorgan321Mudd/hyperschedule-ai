import Css from "./Login.module.css";
import AppCss from "@components/App.module.css";
import useStore from "@hooks/store";
import { useUserStore } from "@hooks/store/user";
import classNames from "classnames";
import { useState } from "react";

export default function ResetPassword(props: { token: string }) {
    const setPopup = useStore((store) => store.setPopup);
    const getUser = useUserStore((store) => store.getUser);

    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState(false);

    function clearTokenFromUrl() {
        const url = new URL(window.location.href);
        url.searchParams.delete("reset-token");
        window.history.replaceState({}, "", url.toString());
    }

    async function handleSubmit() {
        setLoading(true);
        setError(null);
        try {
            if (password.length < 8) {
                throw new Error("Password must be at least 8 characters");
            }
            if (password !== confirm) {
                throw new Error("Passwords do not match");
            }
            const res = await fetch(`${__API_URL__}/auth/reset-password`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token: props.token, password }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error ?? `Reset failed (${res.status})`);
            }
            setDone(true);
            clearTokenFromUrl();
            await getUser();
        } catch (e) {
            setError(e instanceof Error ? e.message : "Reset failed");
        } finally {
            setLoading(false);
        }
    }

    function close() {
        clearTokenFromUrl();
        setPopup(null);
    }

    return (
        <div className={Css.loginBox}>
            <div className={Css.loginForm}>
                <h3 className={Css.formTitle}>Set a new password</h3>
                {done ? (
                    <>
                        <p className={Css.info}>
                            Password updated. You're now logged in.
                        </p>
                        <div className={Css.actions}>
                            <button
                                className={classNames(
                                    AppCss.defaultButton,
                                    Css.loginButton,
                                )}
                                onClick={close}
                            >
                                Continue
                            </button>
                        </div>
                    </>
                ) : (
                    <>
                        <label className={Css.field}>
                            <span>New password</span>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className={Css.input}
                                placeholder="At least 8 characters"
                            />
                        </label>
                        <label className={Css.field}>
                            <span>Confirm password</span>
                            <input
                                type="password"
                                value={confirm}
                                onChange={(e) => setConfirm(e.target.value)}
                                className={Css.input}
                            />
                        </label>
                        {error && <p className={Css.error}>{error}</p>}
                        <div className={Css.actions}>
                            <button
                                className={classNames(
                                    AppCss.defaultButton,
                                    Css.loginButton,
                                )}
                                onClick={handleSubmit}
                                disabled={loading}
                            >
                                {loading ? "Saving..." : "Save password"}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
