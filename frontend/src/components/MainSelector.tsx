import Css from "./MainSelector.module.css";

import classNames from "classnames";

import useStore, { MainTab } from "@hooks/store";
import { useUserStore } from "@hooks/store/user";
import { memo } from "react";

const TAB_ORDER_STUDENT = [
    MainTab.CourseSearch,
    MainTab.Schedule,
    MainTab.GradRequirements,
    MainTab.GradPlan,
] as const;

const TAB_ORDER_ADVISOR = [
    MainTab.CourseSearch,
    MainTab.Schedule,
    MainTab.GradRequirements,
    MainTab.GradPlan,
    MainTab.Advisor,
] as const;

const TAB_LABELS: Record<string, string> = {
    [MainTab.CourseSearch]: "Course Search",
    [MainTab.Schedule]: "Schedule",
    [MainTab.GradRequirements]: "Grad Requirements",
    [MainTab.GradPlan]: "Grad Plan",
    [MainTab.Advisor]: "Advisor",
};

export default memo(function MainSelector() {
    const mainTab = useStore((store) => store.mainTab);
    const setMainTab = useStore((store) => store.setMainTab);
    const server = useUserStore((store) => store.server);

    const isAdvisor = server?.role === "advisor";
    const tabs = isAdvisor ? TAB_ORDER_ADVISOR : TAB_ORDER_STUDENT;
    const activeIndex = tabs.indexOf(mainTab as any);

    return (
        <div
            className={classNames(Css.container, {
                [Css.advisor]: isAdvisor,
            })}
            style={
                {
                    "--active-index": activeIndex >= 0 ? activeIndex : 0,
                } as React.CSSProperties
            }
        >
            {tabs.map((tab) => (
                <button
                    key={tab}
                    className={classNames(Css.tabButton, {
                        [Css.active]: mainTab === tab,
                    })}
                    onClick={() => setMainTab(tab)}
                >
                    {TAB_LABELS[tab]}
                </button>
            ))}
            <div className={Css.showSidebar} />
        </div>
    );
});
