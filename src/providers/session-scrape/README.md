# Session-Based Asset Scrapers

For **paid / login-walled sites** (51yuansu.com, Envato Elements). These sites
**have no public API for asset download** — neither offers a way for a logged-in
user to fetch their own subscription assets programmatically.

The workaround pattern (and its risks) is the same for both:

1. **You log in once via a real browser** and export the session cookies to
   `~/.pipeline/sessions/<provider>.json`.
2. The pipeline uses puppeteer to load that cookie state, navigate to a search
   page, scrape result URLs, then trigger a download by clicking the in-site
   download button (so the site's per-download license counter increments
   against your account, just as if you'd done it manually).

## Risks before you turn this on

- **ToS violation**: Envato's Subscription Agreement (§ 3.4) forbids "automated
  means" of accessing the service. 51yuansu's user agreement has similar
  language. **An account that gets caught may be banned without refund.**
- **Per-download license binding**: Envato licenses every download to your
  account. The license stays with the downloaded file. Don't share matters
  worse than scraping.
- **Fragility**: Sites change layouts. The scraper here will break on changes —
  there's no contract.

## How to set up

```bash
# Install puppeteer (one-time, ~250MB Chromium)
cd pipeline
npm i puppeteer

# 1. Open https://www.51yuansu.com (or envato) in Chrome, log in normally
# 2. Open DevTools → Application → Cookies → copy as JSON
# 3. Save as ~/.pipeline/sessions/51yuansu.json (or envato.json)
# Example structure:
# [
#   {"name":"PHPSESSID","value":"abc123","domain":".51yuansu.com","path":"/"},
#   ...
# ]

# Then in the pipeline:
pipeline fetch "夜景 城市" --provider 51yuansu --scene 5
```

If `~/.pipeline/sessions/<provider>.json` doesn't exist, the adapter throws
with a friendly message — it never tries to log in for you.
