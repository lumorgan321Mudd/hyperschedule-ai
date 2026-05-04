// undefined → browser treats as host-only cookie, which works on any domain.
// Hardcoding ".hyperschedule.io" breaks Railway/preview deploys: the browser
// silently rejects setting the cookie when the request host doesn't match,
// so auth fails on every subsequent request.
let COOKIE_DOMAIN: string | undefined;
if (process.env.COOKIE_DOMAIN) {
    COOKIE_DOMAIN = process.env.COOKIE_DOMAIN;
} else {
    COOKIE_DOMAIN = undefined;
}
export { COOKIE_DOMAIN };
