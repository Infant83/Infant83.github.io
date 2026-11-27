# Infant83.github.io

Public GitHub Pages site for **Hyun-Jung Kim**.

Site URL: <https://infant83.io/>

Review journal: **Agentic Tech Review Letters (ATRL)**, <https://infant83.io/AI_Tech_Review/>. The existing review path is retained for published links and reader annotations.

## Purpose

This repository hosts a lightweight public profile site rather than the full academic CV.

The current version is designed as a calm, scholarly one-page profile with:

- a concise public-facing introduction
- computational materials physics and scientific software
- current enterprise AI and quantum-technology coordination work
- career trajectory
- selected publications and open-source research tools
- a downloadable CV PDF

## Main Files

- `index.html`
  The GitHub Pages homepage.
- `Hyun-Jung_Kim_CV.pdf`
  The downloadable English CV linked from the site.
- `Hyun-Jung_Kim_CV_Korean.pdf`
  The downloadable Korean CV linked from the site.
- `ko.html`
  Korean public profile page.

## Content Direction

The site is intentionally more compact than the full CV.

It emphasizes:

- computational materials physics
- scientific software
- materials discovery
- enterprise AI project support
- internal AI education
- selected scholarly proof rather than exhaustive publication listing

## Update Flow

The source CV is maintained in the parent project folder:

- `../Hyun-Jung_Kim_CV.tex`
- `../Hyun-Jung_Kim_CV.pdf`
- `../Hyun-Jung_Kim_CV_Korean.tex`
- `../Hyun-Jung_Kim_CV_Korean.pdf`

When the CV changes, the usual workflow is:

1. Update the LaTeX source in the parent folder.
2. Run `python ..\build_cv.py` from the parent project or `python build_cv.py` from `InfantResume/`.
3. The script backs up the `.tex` file when the current source differs from the latest backup.
4. The script rebuilds the private workspace PDF. For the Korean CV, run `python ../build_cv_korean.py`.
5. Review both PDFs, then explicitly sync the approved master PDFs with `python scripts/profile.py sync-cv --apply` from the private workspace.
6. Review `index.html` and `ko.html` if the public-facing narrative also needs to change. When replacing a PDF, update its download links' `v` query to the first 12 characters of the new file's SHA-256 so existing caches do not serve the previous version.
7. Commit and push this public repository to update GitHub Pages. Do not copy TeX sources or application records into it.

## Notes

- This repo is for the public profile site only.
- Cloudflare Web Analytics is injected by Cloudflare at the custom domain. The separate first-party public footer counts are described below.
- Detailed change history for resume and career narrative is tracked in the parent project:
  - `../CAREER_CHANGELOG.md`
- Local backup and verification folders such as `.backup/` are ignored for deployment.

## Reading controls and public activity counts

- `profile.css` and `profile.js` are shared by both language pages. Navigation slides upward and fades while reading downward, returns on an upward scroll, and stays available to keyboard users. Reduced-motion preferences are respected.
- The small footer shows visitors, pageviews, and CV link clicks over the most recent 30 Korean calendar dates. Visitors means distinct anonymous browsers across both language pages; CV opens means clicks, not completed downloads. Collection starts at the displayed date, with no imported historical totals.
- Public counts use a separate first-party Worker and D1 database documented in [the backend guide](.automation/profile-stats/README.md). They are independent of the review journal. Do Not Track / Global Privacy Control and unavailable browser storage skip collection while still allowing public totals to load.
- The custom statistics domain and its Workers hostname share the same database. Network retries reuse the event identifier to avoid double-counting. If both are unavailable, the page keeps working and the footer shows a short unavailable message.
- Run the frontend checks with `node --test tests/profile.test.mjs`. Backend integration checks and deployment instructions are in the backend guide. Update the CSS/JS URL hash in both HTML files when these assets change.
