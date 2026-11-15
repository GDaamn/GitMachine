"""Local, read-only Git history browser. Run with python3 viewer.py."""
import argparse
import json
import os
import re
import subprocess
import tempfile
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

STATIC = Path(__file__).resolve().parent / "static"
CACHE = Path(os.environ.get("HISTORY_CACHE", Path.home() / ".cache/history-viewer"))
LOCK = threading.Lock()
ENV = {**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1",
       "GIT_TERMINAL_PROMPT": "0", "GIT_LITERAL_PATHSPECS": "1", "LC_ALL": "C"}


def git(repo, *args, timeout=90):
    result = subprocess.run(["git", "-C", str(repo), *args], stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, env=ENV, timeout=timeout)
    if result.returncode:
        raise ValueError("Git could not read this repository or revision.")
    return result.stdout


def repository(value, refresh=False):
    match = re.fullmatch(r"(?:https://github\.com/)?([\w.-]+)/([\w.-]+)/?", value, re.ASCII)
    if not match:
        raise ValueError("Enter a public GitHub URL or owner/repository.")
    owner, name = (s.lower() for s in match.groups())
    name = name.removesuffix(".git")
    if any(not re.match(r"[a-z0-9_]", s) for s in (owner, name)):
        raise ValueError("Invalid repository name.")
    repo = CACHE / owner / name
    with LOCK:
        if not repo.exists():
            repo.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.TemporaryDirectory(dir=repo.parent) as stage:
                target = Path(stage) / "clone"
                git(stage, "clone", "--bare", "--single-branch", "--no-tags", "--filter=blob:none",
                    f"https://github.com/{owner}/{name}.git", str(target), timeout=300)
                target.rename(repo)
        elif refresh:
            branch = git(repo, "symbolic-ref", "HEAD").decode().strip()
            git(repo, "fetch", "--no-tags", "origin", f"+HEAD:{branch}", timeout=300)
    return repo


def decode(data):
    return data.decode("utf-8", "replace")


def api(route, q):
    repo = repository(q.get("repo", ""), route == "history" and q.get("refresh") == "1")
    if route == "history":
        branch = decode(git(repo, "symbolic-ref", "--short", "HEAD")).strip()
        fields = git(repo, "log", "--first-parent", "--reverse", "-z",
                     "--format=%H%x00%cs%x00%an%x00%s").split(b"\0")[:-1]
        return dict(branch=branch, commits=[list(map(decode, fields[i:i+4]))
                                            for i in range(0, len(fields), 4)])
    sha, path = q.get("commit", ""), q.get("path", "")
    if not re.fullmatch("[0-9a-f]{40}", sha) or "\0" in path:
        raise ValueError("Invalid snapshot.")
    obj = sha + ":" + path
    if route == "paths":
        return [decode(p) for p in git(repo, "ls-tree", "-rz", "--name-only", sha).split(b"\0") if p]
    if route == "tree":
        entries = []
        for line in git(repo, "ls-tree", "-z", obj).split(b"\0"):
            if line:
                meta, name = line.split(b"\t", 1)
                entries.append([decode(name), decode(meta.split()[1])])
        return sorted(entries, key=lambda e: (e[1] != "tree", e[0].casefold()))
    if route == "file":
        entry = git(repo, "ls-tree", "-z", sha, "--", path) if path else b""
        if not entry:
            return dict(message="This path is absent from this snapshot.")
        if entry.split(b" ", 2)[1] != b"blob":
            return dict(message="This path does not point to a file in this snapshot.")
        if int(git(repo, "cat-file", "-s", obj)) > 1024*1024:
            return dict(message="File exceeds the 1 MiB preview limit.")
        data = git(repo, "cat-file", "blob", obj)
        return dict(message="Binary file.") if b"\0" in data else dict(code=decode(data))
    parents = git(repo, "rev-list", "--parents", "-n1", sha).split()[1:]
    base = ["diff", decode(parents[0]), sha] if parents else ["diff-tree", "--root", "--no-commit-id", "-r", sha]
    if route == "changes":
        parts = git(repo, *base, "--no-renames", "--name-status", "-z", "--").split(b"\0")[:-1]
        return [[decode(s), decode(p)] for s, p in zip(parts[::2], parts[1::2])]
    if route == "diff":
        # Limit both the displayed patch and the amount buffered in this process.
        cmd = ["git", "-C", str(repo), *base, "-p", "--no-renames", "--no-ext-diff", "--no-textconv", "--", path]
        with subprocess.Popen(cmd, stdout=subprocess.PIPE, env=ENV) as proc:
            patch = proc.stdout.read(1024*1024 + 1)
            if len(patch) > 1024*1024:
                proc.kill()
                return dict(message="Diff exceeds the 1 MiB preview limit.")
            if proc.wait():
                raise ValueError("Could not read the diff.")
        return dict(code=decode(patch)) if patch else dict(message="This file has no changes at this commit.")
    raise ValueError("Unknown request.")


def response(path, query):
    if path == "/healthz":
        return 200, "text/plain", b"ok"
    try:
        if path.startswith("/api/"):
            params = {k: v[-1] for k, v in parse_qs(query).items()}
            return 200, "application/json", json.dumps(api(path[5:], params)).encode()
        if path in ("/", "/style.css", "/app.js", "/highlight.min.js", "/network.js"):
            file = STATIC / (path[1:] or "index.html")
            mime = {".html": "text/html", ".js": "text/javascript", ".css": "text/css"}[file.suffix]
            return 200, mime + "; charset=utf-8", file.read_bytes()
        return 404, "text/plain", b"Not found"
    except (ValueError, OSError, subprocess.TimeoutExpired) as error:
        return 400, "application/json", json.dumps({"error": str(error)}).encode()


def application(environ, start_response):
    method = environ["REQUEST_METHOD"]
    if method in ("GET", "HEAD"):
        status, mime, data = response(environ["PATH_INFO"], environ.get("QUERY_STRING", ""))
    else:
        status, mime, data = 405, "text/plain", b"Method not allowed"
    headers = [("Content-Type", mime), ("Content-Length", str(len(data)))]
    if status == 405:
        headers.append(("Allow", "GET, HEAD"))
    start_response(f"{status} {HTTPStatus(status).phrase}", headers)
    return [] if method == "HEAD" else [data]


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.headers.get("Host") not in {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}:
            self.send_error(403)
            return
        url = urlsplit(self.path)
        self.reply(*response(url.path, url.query))

    def reply(self, status, mime, data):
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--browser", action="store_true")
    options = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", options.port), Handler)
    print(f"Open http://127.0.0.1:{server.server_port}", flush=True)
    if options.browser:
        import webbrowser
        webbrowser.open(f"http://127.0.0.1:{server.server_port}")
    server.serve_forever()
