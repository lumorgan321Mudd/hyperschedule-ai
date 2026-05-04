import { App } from "@tinyhttp/app";
import { courseApp } from "./courses";
import { userApp } from "./user";
import { calendarApp } from "./calendar";
import termApp from "./term";
import { graduationBlocksApp } from "./graduation-blocks";
import { advisorApp } from "./advisor";
import { advisorLinkApp } from "./advisor-link";
import { majorRequirementsApp } from "./major-requirements";

const v4App = new App({ settings: { xPoweredBy: false } })
    .use(courseApp)
    .use("/term/", termApp)
    .use("/user/", userApp)
    .use("/calendar/", calendarApp)
    .use("/graduation-blocks/", graduationBlocksApp)
    .use("/advisor/", advisorApp)
    .use("/advisor-links/", advisorLinkApp)
    .use("/major-requirements/", majorRequirementsApp);

export { v4App };
