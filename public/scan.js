const $ = (id) => document.getElementById(id);
const SVG_NS = 'http://www.w3.org/2000/svg';
const TYPES = [
  ['living', 'Living room'], ['kitchen', 'Kitchen'], ['bedroom', 'Bedroom'], ['bathroom', 'Bathroom'],
  ['puja', 'Puja room'], ['hall', 'Passage'], ['room', 'Other'],
];

const rooms = [];
let source = 'manual';
let corners = [];
let pendingType = 'living';

const area = (poly) => Math.abs(poly.reduce((a, [x1, z1], i) => { const [x2, z2] = poly[(i + 1) % poly.length]; return a + x1 * z2 - x2 * z1; }, 0)) / 2;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const round = (n) => Math.round(n * 100) / 100;

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function tidy(allRooms) {
  const polys = allRooms.map((r) => r.polygon.map((p) => [...p]));
  const first = polys[0];
  let longest = [first[0], first[1]];
  first.forEach((p, i) => { const q = first[(i + 1) % first.length]; if (dist(p, q) > dist(...longest)) longest = [p, q]; });
  const angle = Math.atan2(longest[1][1] - longest[0][1], longest[1][0] - longest[0][0]);
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  for (const poly of polys) {
    for (const p of poly) {
      const [x, z] = p;
      p[0] = x * cos - z * sin;
      p[1] = x * sin + z * cos;
    }
    for (let pass = 0; pass < 2; pass++) {
      poly.forEach((p, i) => {
        const q = poly[(i + 1) % poly.length];
        const dx = q[0] - p[0];
        const dz = q[1] - p[1];
        const a = Math.abs(Math.atan2(dz, dx) * 180 / Math.PI) % 90;
        if (Math.min(a, 90 - a) > 12) return;
        if (Math.abs(dx) > Math.abs(dz)) { const m = (p[1] + q[1]) / 2; p[1] = m; q[1] = m; } else { const m = (p[0] + q[0]) / 2; p[0] = m; q[0] = m; }
      });
    }
  }
  const all = polys.flat();
  const minX = Math.min(...all.map((p) => p[0]));
  const minZ = Math.min(...all.map((p) => p[1]));
  return allRooms.map((r, i) => ({ ...r, polygon: polys[i].map(([x, z]) => [round(x - minX), round(z - minZ)]) }));
}

function renderList() {
  const list = $('room-list');
  list.replaceChildren(...rooms.map((r) => {
    const li = document.createElement('li');
    li.innerHTML = '<strong></strong><span></span>';
    li.firstChild.textContent = r.name;
    li.lastChild.textContent = `${r.polygon.length} corners · ${area(r.polygon).toFixed(1)} m²`;
    return li;
  }));
  $('review').hidden = rooms.length === 0;
}

function askName(poly, { inOverlay = false } = {}) {
  return new Promise((resolve) => {
    const dialog = $('name-dialog');
    const nameInput = $('room-name');
    const used = new Set(rooms.map((r) => r.type));
    pendingType = TYPES.find(([t]) => !used.has(t) || t === 'bedroom' || t === 'room')?.[0] ?? 'room';
    const sync = () => {
      for (const b of $('types').children) b.setAttribute('aria-pressed', String(b.dataset.type === pendingType));
    };
    $('types').replaceChildren(...TYPES.map(([type, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.type = type;
      b.textContent = label;
      b.addEventListener('click', () => { pendingType = type; nameInput.value = label; sync(); });
      return b;
    }));
    sync();
    nameInput.value = TYPES.find(([t]) => t === pendingType)[1];
    $('room-area').textContent = `About ${area(poly).toFixed(1)} m² with ${poly.length} corners.`;
    if (inOverlay) $('overlay').append(dialog); else document.body.append(dialog);
    dialog.addEventListener('close', () => {
      if (dialog.returnValue === 'ok' && nameInput.value.trim()) resolve({ name: nameInput.value.trim(), type: pendingType, polygon: poly });
      else resolve(null);
    }, { once: true });
    dialog.returnValue = '';
    if (inOverlay) dialog.show(); else dialog.showModal();
    nameInput.focus();
  });
}

function drawMini() {
  const mini = $('mini');
  const pts = [...rooms.flatMap((r) => r.polygon), ...corners];
  if (!pts.length) { mini.replaceChildren(); return; }
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  const pad = 0.5;
  mini.setAttribute('viewBox', `${Math.min(...xs) - pad} ${Math.min(...zs) - pad} ${Math.max(...xs) - Math.min(...xs) + pad * 2 || 1} ${Math.max(...zs) - Math.min(...zs) + pad * 2 || 1}`);
  mini.replaceChildren(
    ...rooms.map((r) => svgEl('polygon', { points: r.polygon.map((p) => p.join(',')).join(' '), class: 'done' })),
    svgEl('polyline', { points: corners.map((p) => p.join(',')).join(' '), class: 'live' }),
    ...corners.map(([x, z]) => svgEl('circle', { cx: x, cy: z, r: 0.12 })),
  );
}

async function save() {
  const error = $('save-error');
  error.hidden = true;
  $('save').disabled = true;
  try {
    const res = await fetch('/api/home/rooms', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rooms: tidy(rooms), source }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? 'Could not save the map.');
    location.href = '/family.html#home';
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
    $('save').disabled = false;
  }
}

async function startAR() {
  const THREE = await import('three');
  source = 'webxr';
  const overlay = $('overlay');
  overlay.hidden = false;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.xr.enabled = true;
  renderer.setPixelRatio(devicePixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  document.body.append(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.01, 40);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xbbbbff, 2));

  const reticle = new THREE.Mesh(new THREE.RingGeometry(0.08, 0.11, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xf3ebdd }));
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);
  const markers = new THREE.Group();
  scene.add(markers);
  const lineMat = new THREE.LineBasicMaterial({ color: 0xe0694a });
  const doneMat = new THREE.LineBasicMaterial({ color: 0x8fd3a8 });
  let floorY = null;

  function redrawMarkers() {
    for (const c of [...markers.children]) { c.geometry.dispose(); markers.remove(c); }
    const y = floorY ?? 0;
    const pillar = new THREE.CylinderGeometry(0.02, 0.02, 0.5, 12);
    for (const [x, z] of corners) {
      const m = new THREE.Mesh(pillar.clone(), new THREE.MeshBasicMaterial({ color: 0xe0694a }));
      m.position.set(x, y + 0.25, z);
      markers.add(m);
    }
    if (corners.length > 1) markers.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(corners.map(([x, z]) => new THREE.Vector3(x, y + 0.01, z))), lineMat));
    for (const r of rooms) markers.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(r.polygon.map(([x, z]) => new THREE.Vector3(x, y + 0.01, z))), doneMat));
    $('close-room').disabled = corners.length < 3;
    drawMini();
  }

  const session = await navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['hit-test', 'local-floor'], optionalFeatures: ['dom-overlay'], domOverlay: { root: overlay } });
  renderer.xr.setReferenceSpaceType('local-floor');
  await renderer.xr.setSession(session);
  const viewer = await session.requestReferenceSpace('viewer');
  const hitSource = await session.requestHitTestSource({ space: viewer });
  let lastHit = null;

  $('add-corner').onclick = () => {
    if (!lastHit) return;
    const p = [lastHit.x, lastHit.z];
    floorY = floorY ?? lastHit.y;
    if (corners.length >= 3 && dist(p, corners[0]) < 0.35) { $('close-room').click(); return; }
    corners.push(p);
    navigator.vibrate?.(30);
    $('hud-msg').textContent = corners.length < 3 ? `Corner ${corners.length}. Walk to the next corner.` : `Corner ${corners.length}. Tap Close room when you are back at the start.`;
    redrawMarkers();
  };
  $('undo-corner').onclick = () => { corners.pop(); redrawMarkers(); };
  $('close-room').onclick = async () => {
    if (corners.length < 3) return;
    const poly = corners;
    corners = [];
    const room = await askName(poly, { inOverlay: true });
    if (room) rooms.push(room);
    renderList();
    $('hud-msg').textContent = room ? `${room.name} saved. Walk into the next room, or tap Done walking.` : 'Room discarded. Start again from any corner.';
    redrawMarkers();
  };
  $('finish').onclick = () => session.end();
  session.addEventListener('end', () => {
    overlay.hidden = true;
    renderer.setAnimationLoop(null);
    renderer.domElement.remove();
    renderer.dispose();
    $('intro').hidden = rooms.length > 0;
    renderList();
  });

  renderer.setAnimationLoop((t, frame) => {
    if (frame) {
      const hits = frame.getHitTestResults(hitSource);
      const pose = hits[0]?.getPose(renderer.xr.getReferenceSpace());
      reticle.visible = Boolean(pose);
      $('add-corner').disabled = !pose;
      if (pose) {
        reticle.matrix.fromArray(pose.transform.matrix);
        const { x, y, z } = pose.transform.position;
        lastHit = { x, y, z };
        if (corners.length === 0 && rooms.length === 0) $('hud-msg').textContent = 'Floor found. Stand in a corner and tap Add corner.';
      }
    }
    renderer.render(scene, camera);
  });
}

function startDraw() {
  source = 'manual';
  $('intro').hidden = true;
  $('draw').hidden = false;
  const grid = $('grid');
  const W = 14;
  const H = 12;
  grid.setAttribute('viewBox', `-0.5 -0.5 ${W + 1} ${H + 1}`);
  const redraw = () => {
    const lines = [];
    for (let x = 0; x <= W; x++) lines.push(svgEl('line', { x1: x, y1: 0, x2: x, y2: H, class: 'g' }));
    for (let z = 0; z <= H; z++) lines.push(svgEl('line', { x1: 0, y1: z, x2: W, y2: z, class: 'g' }));
    grid.replaceChildren(
      ...lines,
      ...rooms.map((r) => svgEl('polygon', { points: r.polygon.map((p) => p.join(',')).join(' '), class: 'done' })),
      svgEl('polyline', { points: corners.map((p) => p.join(',')).join(' '), class: 'live' }),
      ...corners.map(([x, z], i) => svgEl('circle', { cx: x, cy: z, r: i === 0 && corners.length > 2 ? 0.28 : 0.16, class: i === 0 ? 'first' : '' })),
    );
  };
  grid.onclick = async (e) => {
    const pt = grid.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const local = pt.matrixTransform(grid.getScreenCTM().inverse());
    const p = [Math.round(Math.min(W, Math.max(0, local.x)) * 4) / 4, Math.round(Math.min(H, Math.max(0, local.y)) * 4) / 4];
    if (corners.length >= 3 && dist(p, corners[0]) < 0.4) {
      const poly = corners;
      corners = [];
      redraw();
      const room = await askName(poly);
      if (room) rooms.push(room);
      renderList();
      redraw();
      return;
    }
    corners.push(p);
    redraw();
  };
  redraw();
  startDraw.redraw = redraw;
}

$('start-draw').addEventListener('click', startDraw);
$('start-ar').addEventListener('click', () => {
  startAR().catch((err) => {
    $('overlay').hidden = true;
    $('support').textContent = `Could not start the camera (${err.message}). You can draw the rooms by hand instead.`;
  });
});
$('undo-room').addEventListener('click', () => { rooms.pop(); renderList(); startDraw.redraw?.(); });
$('save').addEventListener('click', save);

(async () => {
  const support = $('support');
  if (!window.isSecureContext) { support.textContent = 'Open this page over HTTPS on an Android phone with Chrome to walk the house.'; return; }
  if (!navigator.xr) { support.textContent = 'This browser cannot see the room. Use Chrome on an Android phone with Google Play Services for AR, or draw it by hand.'; return; }
  const ok = await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
  if (!ok) { support.textContent = 'This device does not support AR. Use an ARCore Android phone, or draw it by hand.'; return; }
  support.textContent = 'Ready. Your phone will ask to use the camera.';
  $('start-ar').disabled = false;
})();
