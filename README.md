# Git Machine

Explore a public GitHub repository’s first-parent history, browse snapshots, and play the network time-lapse. Git Machine requires Python 3.10+ and Git with HTTPS support.

## Deploy from GitHub to an existing Render web service

Commit this folder’s contents to the branch linked to the service. In Settings, use the following values.

| Setting | Value |
| --- | --- |
| Runtime | Python 3 |
| Root Directory | Leave empty if viewer.py is at the repository root. Otherwise enter its directory relative to the repository root. |
| Build Command | `git --version && python -m pip install -r requirements.txt` |
| Start Command | `sh start-render.sh` |
| Health Check Path | `/healthz` |

Deploy the latest commit and open the service URL. The health endpoint returns “ok” independently of GitHub. Open a public repository to test cloning and lazy file loading. Render supplies PORT. Public repositories require no GitHub token.

Clones are cached under ~/.cache/history-viewer. On ephemeral storage they can be rebuilt after a restart or deploy. To reuse an existing persistent disk, set HISTORY_CACHE to a writable directory under its mount point. Cache usage grows with the repositories opened.

## Run locally

Run `python3 viewer.py --browser` with Git on your PATH, or double-click Launch Viewer.command on macOS.
