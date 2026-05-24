# Infant83.github.io

Public GitHub Pages site for **Hyun-Jung Kim**.

Site URL: <https://infant83.github.io/>

## Purpose

This repository hosts a lightweight public profile site rather than the full academic CV.

The current version is designed as a calm, scholaric one-page profile with:

- a concise public-facing introduction
- current work in AI governance and scientific computing
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

## Public Metrics

The small view and average active-time pills in the header use a Cloudflare Worker/D1 API:

- endpoint: `https://infant83-public-metrics.infant83.workers.dev`
- worker source: `../../AI_Tech_Review/.automation/cloudflare/ai-tech-review-public-metrics/`

The Worker treats `https://infant83.github.io/` as the parent public site and groups child paths by site id:

- `profile`: `/`, `/ko.html`
- `ai-tech-review`: `/AI_Tech_Review/`
- `ax-camp`: `/Lets_AX_EXE/`
- `gitlab-lectures`: `/GitLab-Onboarding-Lectures/`
- `ml-math`: `/ML_math/`

The API stores only path-level aggregate counters and engagement totals. It does not store IP addresses, User-Agent strings, cookies, or personal identifiers.

## Content Direction

The site is intentionally more compact than the full CV.

It emphasizes:

- AI governance
- computational materials physics
- materials discovery
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
4. The script rebuilds the PDF and syncs `Hyun-Jung_Kim_CV.pdf` into this repository.
5. For the Korean CV, run `python ../build_cv_korean.py`; it syncs `Hyun-Jung_Kim_CV_Korean.pdf`.
5. Review `index.html` only if the public-facing narrative also needs to change.
6. Commit and push this repository to update GitHub Pages.

## Notes

- This repo is for the public profile site only.
- Detailed change history for resume and career narrative is tracked in the parent project:
  - `../CAREER_CHANGELOG.md`
- Local backup and verification folders such as `.backup/` are ignored for deployment.
