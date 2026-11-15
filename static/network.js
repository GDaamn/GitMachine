"use strict";
let playing = false, playTimer;
const overviewDurations = { slow: 80000, overview: 45000 };
let overviewStart, overviewTime;
function startClock() {
  overviewStart = index;
  overviewTime = performance.now();
}
function scheduleFrame() {
  const pace = el("pace").value;
  const last = commits.length - 1;
  const remaining = last - overviewStart;
  const overviewDuration = overviewDurations[pace];
  const interval = Math.max(100, overviewDuration / Math.max(1, remaining));
  playTimer = setTimeout(() => {
    if (!playing || index >= last) return;
    const elapsed = performance.now() - overviewTime;
    const target = overviewStart + Math.floor(remaining * elapsed / overviewDuration);
    index = Math.min(last, Math.max(index + 1, target));
    render();
  }, interval);
}
document.getElementById("pace").onchange = () => {
  if (!playing) return;
  clearTimeout(playTimer);
  startClock();
  render();
};
function stopPlayback() {
  clearTimeout(playTimer);
  playing = false;
  document.getElementById("play").textContent = "▶ Play";
}
document.getElementById("play").onclick = () => {
  if (playing) { stopPlayback(); return; }
  playing = true;
  el("play").textContent = "Ⅱ Pause";
  if (index === commits.length - 1) index = 0;
  startClock();
  render();
};

function svgElement(tag, attributes) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}
function networkGraph(paths, changes) {
  const status = new Map(changes.map(([kind, p]) => [p, kind]));
  const folders = new Map();
  const files = new Set([...paths, ...status.keys()]);
  for (const p of files) {
    const slash = p.indexOf("/");
    const folder = slash < 0 ? "/" : p.slice(0, slash);
    if (!folders.has(folder)) folders.set(folder, []);
    folders.get(folder).push(p);
  }
  // Keep a stable order within a folder while prioritizing changed files for display.
  const sorted = [...folders.keys()].sort();
  const svg = svgElement("svg", {viewBox:"0 0 780 550", role:"group", "aria-label":"File activity grouped by top-level folder"});
  const edges = svgElement("g", {class:"map-edges"});
  const nodes = svgElement("g", {});
  svg.append(edges,nodes);
  function edge(x1,y1,x2,y2) { edges.append(svgElement("line",{x1,y1,x2,y2})); }
  function label(x,y,text) {
    const t = svgElement("text",{x,y,"text-anchor":"middle"});
    t.textContent = text; nodes.append(t);
  }
  const cx = 390, cy = 275;
  const groups = sorted.slice().sort((a,b) => Number(folders.get(b).some(p=>status.has(p))) - Number(folders.get(a).some(p=>status.has(p)))).slice(0,16).sort();
  let shown = 0;
  groups.forEach((folder,i) => {
    const angle = 2*Math.PI*i/groups.length - Math.PI/2;
    const x = cx + Math.cos(angle)*258, y = cy + Math.sin(angle)*172;
    edge(cx,cy,x,y);
    const all = folders.get(folder).sort();
    const shownPaths = [...all.filter(p=>status.has(p)), ...all.filter(p=>!status.has(p))].slice(0,24).sort();
    shown += shownPaths.length;
    for (const p of shownPaths) {
      // Hash the path so surviving file nodes retain their offsets across commits.
      let hash = 2166136261;
      for (const char of p) hash = Math.imul(hash ^ char.charCodeAt(0),16777619) >>> 0;
      const theta = hash/4294967296 * Math.PI*2;
      const radius = 27 + (hash % 37);
      const fx = x + radius*Math.cos(theta), fy = y + radius*Math.sin(theta);
      edge(x,y,fx,fy);
      const kind = status.get(p);
      const dot = svgElement("circle",{cx:fx,cy:fy,r:kind?6:4,class:"map-file " + (kind || ""),tabindex:0,role:"button","aria-label":"Open diff for "+p});
      const title = svgElement("title",{}); title.textContent=p; dot.append(title);
      const open = () => { stopPlayback(); path=p; mode="diff"; panel="changes"; render(); };
      dot.onclick=open;
      dot.onkeydown=e=>{if (e.key==="Enter" || e.key===" ") {e.preventDefault();open();}};
      nodes.append(dot);
    }
    nodes.append(svgElement("circle",{cx:x,cy:y,r:8,class:"map-hub"}));
    label(x,y+19,folder);
  });
  nodes.append(svgElement("circle",{cx,cy,r:10,class:"map-hub"}));
  label(cx,cy+23,repo.split("/").pop());
  const added=changes.filter(([s])=>s==="A").length, deleted=changes.filter(([s])=>s==="D").length;
  const summary = added+" added · "+(changes.length-added-deleted)+" edited · "+deleted+" deleted";
  return {graph:svg, summary:summary+(shown<files.size?" · Showing "+shown+" of "+files.size+" files":"")};
}
async function prepareNetwork() {
  try { return networkGraph(...await Promise.all([get("paths"),get("changes")])); }
  catch (error) { return {graph:error.message,summary:"",failed:true}; }
}
