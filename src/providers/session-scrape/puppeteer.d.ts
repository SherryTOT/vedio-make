// puppeteer is an OPTIONAL runtime dependency: session-scrape lazy-loads it and
// prints an install hint if it's absent (see loadPuppeteer). Declaring it as a
// shorthand ambient module keeps `tsc --noEmit` green without vendoring types
// or adding a devDependency — the import resolves to `any`, matching the
// existing Promise<any> signatures here.
declare module "puppeteer";
