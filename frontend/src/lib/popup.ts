import type * as APIv4 from "hyperschedule-shared/api/v4";

export const enum PopupOption {
    Login = "login",
    SectionDetail = "section",
    Settings = "settings",
    Filter = "filter",
    ManageSchedules = "manage-schedules",
    ExportCalendar = "export-calendar",
    About = "about",
    RoleSelect = "role-select",
    CreateBlock = "create-block",
    CreateHsaBlock = "create-hsa-block",
    ShareBlock = "share-block",
}

export type Popup =
    | {
          option: PopupOption.Login;
          continuation?: () => void;
      }
    | {
          option: PopupOption.SectionDetail;
          section: APIv4.Section | undefined;
      }
    | {
          option: PopupOption.Settings;
      }
    | {
          option: PopupOption.Filter;
      }
    | { option: PopupOption.ManageSchedules }
    | { option: PopupOption.ExportCalendar }
    | { option: PopupOption.About }
    | { option: PopupOption.RoleSelect }
    | { option: PopupOption.CreateBlock }
    | { option: PopupOption.CreateHsaBlock }
    | {
          option: PopupOption.ShareBlock;
          blockId: APIv4.GraduationBlockId;
          planType?: string;
      }
    | null;
