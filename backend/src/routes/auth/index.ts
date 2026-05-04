import { App } from "@tinyhttp/app";
import { samlApp } from "./saml";
import { devLoginApp } from "./dev-login";
import { accountApp } from "./account";

export const authApp = new App({ settings: { xPoweredBy: false } })
    .use(samlApp)
    .use(devLoginApp)
    .use(accountApp);
