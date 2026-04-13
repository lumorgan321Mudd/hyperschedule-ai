let COOKIE_DOMAIN: string;
if (process.env.COOKIE_DOMAIN) {
    COOKIE_DOMAIN = process.env.COOKIE_DOMAIN;
} else if (process.env.NODE_ENV === "production") {
    COOKIE_DOMAIN = ".hyperschedule.io";
} else {
    COOKIE_DOMAIN = "localhost";
}
export { COOKIE_DOMAIN };
