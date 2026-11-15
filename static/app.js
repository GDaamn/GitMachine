"use strict";
const el = id => document.getElementById(id);
const start = new URLSearchParams(location.search);
let repo, commits = [], index = 0, path = "", panel = "files", mode = "code";
let openDirs = new Set([""]), generation = 0;
let savedCommit = start.get("commit");
async function get(route, params = {}) {
  const query = new URLSearchParams({repo, commit: commits[index]?.[0] || "", ...params});
  const response = await fetch("/api/" + route + "?" + query);
  const data = await response.json();
  if (!response.ok) throw Error(data.error || "Could not load repository.");
  return data;
}
function bookmark() {
  const query = new URLSearchParams({repo, commit: commits[index][0]});
  if (path) query.set("path", path);
  if (mode !== "code") query.set("view", mode);
  history.replaceState(null, "", "?" + query);
}
function pressed(id, on) { el(id).setAttribute("aria-pressed", String(on)); }
async function prepareFile() {
  const content = document.createDocumentFragment();
  const selectedPath = path, selectedMode = mode;
  if (!selectedPath) return "Select a file to read its contents.";
  try {
    const result = await get(selectedMode === "code" ? "file" : "diff", {path: selectedPath});
    if (selectedMode === "diff" && result.code) {
      const fragment = document.createDocumentFragment();
      for (const line of result.code.split("\n")) {
        const row = document.createElement("span");
        row.className = line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : line.startsWith("@@") ? "hunk" : "";
        row.textContent = line || " ";
        row.classList.add("diff-line");
        fragment.append(row);
      }
      content.append(fragment);
    } else if (selectedMode === "code" && result.code) {
      const filename = selectedPath.split("/").pop().toLowerCase();
      const extension = filename.split(".").pop();
      const aliases = {mod:"go", h:"c", mjs:"javascript", cjs:"javascript",
        jsx:"javascript", tsx:"typescript", zsh:"bash", dockerfile:"dockerfile"};
      const language = aliases[extension] || extension;
      if (window.hljs && hljs.getLanguage(language)) {
        const code = document.createElement("code");
        code.innerHTML = hljs.highlight(result.code, {language}).value;
        content.append(code);
      } else content.textContent = result.code;
    } else content.textContent = result.message || result.code || "(Empty file)";
    return content;
  } catch (error) { return error.message; }
}
async function prepareTree(epoch) {
  const active = () => epoch === generation;
  const fragment = document.createDocumentFragment();
  function item(parent, label, depth, click, selected) {
    const b = document.createElement("button");
    b.textContent = label; b.style.paddingLeft = (20 + depth * 13) + "px";
    if (selected) b.setAttribute("aria-current", "true");
    b.onclick = click; parent.append(b);
    return b;
  }
  function select(p, button) {
    el("tree").querySelector("[aria-current]")?.removeAttribute("aria-current");
    button.setAttribute("aria-current", "true");
    stopPlayback();
    if (mode === "network") mode = "diff";
    path = p;
    if (panel === "changes") mode = "diff";
    render();
  }
  async function directory(parent, dir, depth) {
    const children = await get("tree", {path: dir});
    if (!active()) return;
    for (const [name, type] of children) {
      const p = dir ? dir + "/" + name : name;
      if (type === "tree") {
        const group = document.createElement("div");
        group.className = "folder-group";
        group.dataset.tone = ["slate", "lavender", "sand", "mist"][depth % 4];
        parent.append(group);
        const branch = document.createElement("div");
        let loaded = false;
        let pending = false;
        const button = item(group, "", depth, () => {
          if (openDirs.has(p)) openDirs.delete(p); else openDirs.add(p);
          if (active()) update(); else render();
        });
        group.append(branch);
        async function update() {
          const expanded = openDirs.has(p);
          button.textContent = (expanded ? "▾ " : "▸ ") + name + "/";
          button.setAttribute("aria-expanded", String(expanded));
          group.classList.toggle("expanded", expanded);
          branch.hidden = !expanded;
          if (!expanded || loaded || pending) return;
          pending = true;
          try {
            const rows = document.createDocumentFragment();
            await directory(rows, p, depth + 1);
            if (active()) branch.replaceChildren(rows);
            loaded = true;
          } catch (error) {
            branch.textContent = error.message;
          } finally {
            pending = false;
          }
        }
        await update();
      } else {
        const b = item(parent, name, depth, event => select(p, event.currentTarget), path === p);
        if (type === "commit") { b.textContent += " (submodule)"; b.disabled = true; }
      }
    }
  }
  try {
    if (panel === "files") await directory(fragment, "", 0);
    else for (const [status, p] of await get("changes")) item(fragment, status + "  " + p, 0, event => select(p, event.currentTarget), path === p);
    if (fragment.childNodes.length) return fragment;
    return panel === "files" ? "Empty tree." : "No changed paths.";
  } catch (error) { return error.message; }
}
const yearUnits = 1000000;
let calendarPositions = [], chronological = [], annualCounts = [], firstYear;
function buildCalendar() {
  chronological = commits.map((c,i) => i).sort((a,b) => commits[a][1].localeCompare(commits[b][1]) || a-b);
  firstYear = Number(commits[chronological[0]][1].slice(0,4));
  const lastYear = Number(commits[chronological[chronological.length-1]][1].slice(0,4));
  annualCounts = Array(lastYear-firstYear+1).fill(0);
  calendarPositions = Array(commits.length);
  for (let begin=0; begin<chronological.length;) {
    const date = commits[chronological[begin]][1];
    let end = begin+1;
    while (end<chronological.length && commits[chronological[end]][1] === date) end++;
    const year = Number(date.slice(0,4)), offset = year-firstYear;
    const jan = Date.UTC(year,0,1), duration = Date.UTC(year+1,0,1)-jan;
    annualCounts[offset] += end-begin;
    for (let j=begin; j<end; j++) {
      const dayPart = (j-begin+0.5)/(end-begin);
      calendarPositions[chronological[j]] = yearUnits*(offset+(Date.parse(date)-jan+dayPart*86400000)/duration);
    }
    begin=end;
  }
  const start = calendarPositions[chronological[0]];
  const end = calendarPositions[chronological[chronological.length-1]];
  el("slider").min = start;
  el("slider").max = end > start ? end : start + 1;
  el("slider").disabled = commits.length === 1;
  el("slider").step = "any";
  const peak = Math.max(...annualCounts);
  const busiest = annualCounts.flatMap((n,i)=>n===peak?[firstYear+i]:[]).join(", ");
  const summary = "Most first-parent commits: " + busiest + " (" + peak + " per year)";
  el("years").setAttribute("aria-label", summary);
  el("activity-summary").textContent = "Most active: " + busiest + " · " + peak.toLocaleString() + (peak===1?" commit":" commits");
  drawCalendar();
}
function nearestCommit(value) {
  let lo=0, hi=chronological.length-1;
  while (lo<hi) {
    const mid=Math.floor((lo+hi)/2);
    if (calendarPositions[chronological[mid]]<value) lo=mid+1;
    else hi=mid;
  }
  const next=chronological[lo], prev=chronological[Math.max(0,lo-1)];
  return Math.abs(calendarPositions[prev]-value)<=Math.abs(calendarPositions[next]-value)?prev:next;
}
function drawCalendar() {
  const canvas=el("years"), w=canvas.clientWidth, h=canvas.clientHeight;
  if (!w || !annualCounts.length) return;
  const ratio=window.devicePixelRatio||1;
  canvas.width=Math.round(w*ratio); canvas.height=Math.round(h*ratio);
  const ctx=canvas.getContext("2d"), styles=getComputedStyle(canvas);
  ctx.scale(ratio,ratio);
  const min=Number(el("slider").min), span=Number(el("slider").max)-min;
  const x = pos => Math.max(0,Math.min(w-1,(pos-min)*w/span));
  ctx.fillStyle=styles.getPropertyValue("--focus").trim();
  ctx.globalAlpha=.42;
  for (const pos of calendarPositions) ctx.fillRect(x(pos),0,1,5);
  ctx.globalAlpha=1; ctx.fillStyle=styles.color; ctx.font="10px monospace";
  let nextLabel = 0;
  annualCounts.forEach((_,i)=>{
    const boundary = x(i*yearUnits);
    ctx.fillRect(boundary,0,1,9);
    if (boundary >= nextLabel && boundary + 28 <= w) {
      ctx.fillText(String(firstYear+i),boundary+2,19);
      nextLabel = boundary+38;
    }
  });
}
new ResizeObserver(drawCalendar).observe(el("years"));
el("slider").onkeydown = e => {
  const offset = {ArrowLeft:-1,ArrowDown:-1,ArrowRight:1,ArrowUp:1}[e.key];
  if (offset) { e.preventDefault(); move(index+offset); }
  else if (e.key==="Home" || e.key==="End") { e.preventDefault(); move(e.key==="Home"?0:commits.length-1); }
};
function preview(i) {
  const [sha, date, author, subject] = commits[i];
  el("subject").textContent = subject || "(No commit message)";
  const link = el("commit-link");
  link.href = "https://github.com/" + repo + "/commit/" + sha;
  link.textContent = sha.slice(0, 8);
  link.setAttribute("aria-label", "Open commit " + link.textContent + " on GitHub in a new tab");
  el("commit-details").textContent = "  ·  " + date + "  ·  " + author;
  el("slider").setAttribute("aria-valuetext", "Commit " + (i + 1) + " of " + commits.length + ", " + date);
}
function move(i) {
  stopPlayback();
  index = Math.max(0, Math.min(i, commits.length - 1));
  render();
}
async function render() {
  const epoch = ++generation;
  clearTimeout(playTimer);
  const network = mode === "network";
  const [tree, file] = await Promise.all([prepareTree(epoch), network ? prepareNetwork() : prepareFile()]);
  if (epoch !== generation) return;
  el("tree").replaceChildren(tree);
  el("map").hidden = !network;
  el("content").hidden = network;
  if (network) {
    el("drawing").replaceChildren(file.graph);
    el("counts").textContent = file.summary;
    if (index === commits.length - 1 || file.failed) stopPlayback();
    if (playing) scheduleFrame();
  } else el("content").replaceChildren(file);
  el("filename").textContent = network ? "Repository network" : path || "File preview";
  pressed("files", panel === "files"); pressed("changes", panel === "changes");
  pressed("network", network);
  pressed("code", mode === "code"); pressed("diff", mode === "diff");
  el("slider").value = calendarPositions[index];
  preview(index);
  el("first").disabled = el("prev").disabled = index === 0;
  el("last").disabled = el("next").disabled = index === commits.length - 1;
  bookmark();
}
async function load(refresh) {
  stopPlayback();
  const epoch = ++generation;
  repo = (el("repo").value.trim() || start.get("repo") || "octocat/Hello-World").replace(/^https:\/\/github\.com\//i, "").replace(/\/$/, "").replace(/\.git$/, "");
  el("workspace").hidden = true;
  el("status").textContent = "Opening repository history…";
  try {
    const data = await get("history", {refresh: refresh ? "1" : "0"});
    if (epoch !== generation) return;
    if (!data.commits.length) throw Error("This repository has no commits.");
    commits = data.commits;
    buildCalendar();
    const found = commits.findIndex(c => c[0] === savedCommit);
    el("name").textContent = repo; el("branch").textContent = data.branch;

    el("status").textContent = savedCommit && found < 0 ? "Linked commit is outside this timeline. Showing latest." : "";
    savedCommit = null;
    el("workspace").hidden = false; move(found < 0 ? commits.length - 1 : found);
  } catch (error) { if (epoch === generation) el("status").textContent = error.message + " Check the public repository name and your connection."; }
}
el("form").onsubmit = e => {
  e.preventDefault(); path = ""; mode = "code"; panel = "files"; openDirs = new Set([""]); savedCommit = null; load(true);
};
el("first").onclick = () => move(0);
el("prev").onclick = () => move(index - 1);
el("next").onclick = () => move(index + 1);
el("last").onclick = () => move(commits.length - 1);
el("slider").oninput = e => { stopPlayback(); preview(nearestCommit(Number(e.target.value))); };
el("slider").onchange = e => move(nearestCommit(Number(e.target.value)));
for (const id of ["files", "changes"]) el(id).onclick = () => { panel = id; render(); };
for (const id of ["code", "diff", "network"]) el(id).onclick = () => { stopPlayback(); mode = id; render(); };
function applyTheme(light) {
  document.documentElement.dataset.theme = light ? "light" : "dark";
  drawCalendar();
  pressed("theme", light);
  el("theme").textContent = light ? "☾" : "☀";
  el("theme").title = light ? "Switch to dark mode" : "Switch to light mode";
}
applyTheme(localStorage.getItem("git-machine-theme") === "light");
el("theme").onclick = () => {
  applyTheme(document.documentElement.dataset.theme !== "light");
  localStorage.setItem("git-machine-theme", document.documentElement.dataset.theme);
};
path = start.get("path") ?? (start.has("repo") ? "" : "README");
for (let i = path.indexOf("/"); i >= 0; i = path.indexOf("/", i + 1)) openDirs.add(path.slice(0, i));
mode = ["network", "diff"].includes(start.get("view")) ? start.get("view") : "code";
load(false);
