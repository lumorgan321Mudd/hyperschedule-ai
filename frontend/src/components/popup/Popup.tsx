import useStore from "@hooks/store";
import { PopupOption } from "@lib/popup";
import Css from "./Popup.module.css";
import * as Feather from "react-feather";
import Login from "./Login";
import SectionDetails from "./SectionDetails";
import Filter from "./Filter";
import ManageSchedules from "@components/popup/ManageSchedules";
import classNames from "classnames";
import { Settings } from "./Settings";
import ExportCalendar from "@components/popup/ExportCalendar";
import About from "@components/popup/About";
import RoleSelect from "@components/popup/RoleSelect";
import CreateBlock from "@components/popup/CreateBlock";
import CreateHsaBlock from "@components/popup/CreateHsaBlock";
import ShareBlock from "@components/popup/ShareBlock";
import ResetPassword from "@components/popup/ResetPassword";
import ManageAdvisors from "@components/popup/ManageAdvisors";
import SendHsaPlan from "@components/popup/SendHsaPlan";
import { memo } from "react";

function PopupBox(props: {
    children: JSX.Element;
    inactive?: true;
    noDismiss?: boolean;
}): JSX.Element {
    const setPopup = useStore((store) => store.setPopup);

    function dismissPopup() {
        if (props.noDismiss) return;
        setPopup(null);
    }

    return (
        <div
            className={classNames(Css.popupBackground, {
                [Css.inactive]: props.inactive,
            })}
            onClick={dismissPopup}
        >
            {/*we call stopPropagation here so clicks inside the box don't actually dismiss the popup*/}
            <div className={Css.popupBox} onClick={(e) => e.stopPropagation()}>
                {!props.noDismiss && (
                    <button className={Css.closeButton} onClick={dismissPopup}>
                        <Feather.X size={24} />
                    </button>
                )}
                <div className={Css.popupContent}>{props.children}</div>
            </div>
        </div>
    );
}

export default memo(function Popup() {
    const popup = useStore((store) => store.popup);

    const empty = (
        <PopupBox inactive>
            <></>
        </PopupBox>
    );

    if (popup === null) return empty;
    switch (popup.option) {
        case PopupOption.Login:
            return (
                <PopupBox>
                    <Login continuation={popup.continuation} />
                </PopupBox>
            );
        case PopupOption.SectionDetail:
            return (
                <PopupBox>
                    <SectionDetails section={popup.section} />
                </PopupBox>
            );
        case PopupOption.Filter:
            return (
                <PopupBox>
                    <Filter />
                </PopupBox>
            );
        case PopupOption.ManageSchedules:
            return (
                <PopupBox>
                    <ManageSchedules />
                </PopupBox>
            );
        case PopupOption.Settings:
            return (
                <PopupBox>
                    <Settings />
                </PopupBox>
            );
        case PopupOption.ExportCalendar:
            return (
                <PopupBox>
                    <ExportCalendar />
                </PopupBox>
            );
        case PopupOption.About:
            return (
                <PopupBox>
                    <About />
                </PopupBox>
            );
        case PopupOption.RoleSelect:
            return (
                <PopupBox noDismiss>
                    <RoleSelect />
                </PopupBox>
            );
        case PopupOption.CreateBlock:
            return (
                <PopupBox>
                    <CreateBlock />
                </PopupBox>
            );
        case PopupOption.CreateHsaBlock:
            return (
                <PopupBox>
                    <CreateHsaBlock />
                </PopupBox>
            );
        case PopupOption.ShareBlock:
            return (
                <PopupBox>
                    <ShareBlock blockId={popup.blockId} planType={popup.planType} />
                </PopupBox>
            );
        case PopupOption.ResetPassword:
            return (
                <PopupBox noDismiss>
                    <ResetPassword token={popup.token} />
                </PopupBox>
            );
        case PopupOption.ManageAdvisors:
            return (
                <PopupBox>
                    <ManageAdvisors />
                </PopupBox>
            );
        case PopupOption.SendHsaPlan:
            return (
                <PopupBox>
                    <SendHsaPlan />
                </PopupBox>
            );
        default:
            return empty;
    }
});
