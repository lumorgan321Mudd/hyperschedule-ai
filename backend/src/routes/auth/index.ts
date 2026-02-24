import { App } from "@tinyhttp/app";
import { samlApp } from "./saml";
import { devLoginApp } from "./dev-login";

export const authApp = new App({ settings: { xPoweredBy: false } })
    .use(samlApp)
    .use(devLoginApp);
