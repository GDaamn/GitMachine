# Git Machine

Explore a public GitHub repository’s first-parent history, browse snapshots, and play the network time-lapse. Git Machine requires Python 3.10+ and Git with HTTPS support.

## Deploy to Render with Docker

Commit this folder’s contents to GitHub, then create a Render Web Service from the repository and select **Docker** as the runtime. Render will build the root `Dockerfile`; it installs Git and the Python dependencies and starts Gunicorn with the correct `viewer:application` entry point. Leave the Start Command empty so Render uses the command in the Dockerfile.

Set the Health Check Path to `/healthz`. Render supplies `PORT`. The Dockerfile starts `viewer:application`. The `app.py` compatibility entry point also supports Render’s existing `gunicorn app:app` Start Command, so an existing Python-runtime service can start after deploying the latest commit. If you want to use Docker, make sure the service is configured for the Docker runtime; if Render does not let you change the existing service, create a new Web Service with Docker selected.

Deploy the latest commit and open the service URL. The health endpoint returns “ok” independently of GitHub. Open a public repository to test cloning and lazy file loading. Public repositories require no GitHub token.

Clones are cached under ~/.cache/history-viewer. On ephemeral storage they can be rebuilt after a restart or deploy. To reuse an existing persistent disk, set HISTORY_CACHE to a writable directory under its mount point. Cache usage grows with the repositories opened.

## Run locally

Run `python3 viewer.py --browser` with Git on your PATH, or double-click Launch Viewer.command on macOS.
