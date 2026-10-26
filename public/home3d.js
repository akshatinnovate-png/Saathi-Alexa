import { el } from './common.js';
import { icon } from './icons.js';

const PALETTE = {
  living: '#e9dccb', kitchen: '#dfe8d8', hall: '#e8e4dc', bedroom: '#dcdff0', puja: '#f3dfc6', bathroom: '#d6e8ec', room: '#e6e2da',
};
const SVG_NS = 'http://www.w3.org/2000/svg';

const centroid = (poly) => {
  const n = poly.length;
  return poly.reduce(([sx, sz], [x, z]) => [sx + x / n, sz + z / n], [0, 0]);
};

const bounds = (rooms) => {
  const pts = rooms.flatMap((r) => r.polygon);
  if (!pts.length) return { minX: 0, maxX: 1, minZ: 0, maxZ: 1 };
  return {
    minX: Math.min(...pts.map((p) => p[0])), maxX: Math.max(...pts.map((p) => p[0])),
    minZ: Math.min(...pts.map((p) => p[1])), maxZ: Math.max(...pts.map((p) => p[1])),
  };
};

const pointIn = ([x, z], poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};

function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
}

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

async function createScene(host, { onPick }) {
  const THREE = await import('three');
  const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
  const { CSS2DRenderer, CSS2DObject } = await import('three/addons/renderers/CSS2DRenderer.js');

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
    const labels = new CSS2DRenderer();
  labels.domElement.className = 'h3-labels';
  host.append(renderer.domElement, labels.domElement);
  renderer.domElement.setAttribute('aria-hidden', 'true');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.46;
  controls.minDistance = 4;
  controls.maxDistance = 40;

  scene.add(new THREE.HemisphereLight(0xffffff, 0xe8e0d4, 2.4));
  const sun = new THREE.DirectionalLight(0xfff3e2, 1.6);
  sun.position.set(-5, 20, -3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.radius = 6;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);

  const ground = new THREE.Mesh(new THREE.CircleGeometry(40, 64), new THREE.ShadowMaterial({ opacity: 0.12 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  ground.receiveShadow = true;
  scene.add(ground);

  const group = new THREE.Group();
  scene.add(group);
  const floors = [];
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let selected = null;
  let size = { w: 1, h: 1 };

  const wallMat = new THREE.MeshStandardMaterial({ color: 0xfbf8f3, roughness: 0.9 });
  const capMat = new THREE.MeshStandardMaterial({ color: 0x6b655c, roughness: 0.7 });

  function label(text, className) {
    const node = document.createElement('div');
    node.className = className;
    node.textContent = text;
    return new CSS2DObject(node);
  }

  function clear() {
    for (const child of [...group.children]) {
      child.traverse((o) => {
        if (o.isCSS2DObject) o.element.remove();
        o.geometry?.dispose?.();
      });
      group.remove(child);
    }
    floors.length = 0;
  }

  function wall(a, b, height, offset) {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 0.05) return;
    const body = new THREE.Mesh(new THREE.BoxGeometry(len + 0.1, height, 0.1), wallMat);
    body.position.set((a[0] + b[0]) / 2 - offset.x, height / 2, (a[1] + b[1]) / 2 - offset.z);
    body.rotation.y = -Math.atan2(dz, dx);
    body.castShadow = true;
    body.receiveShadow = true;
    const cap = new THREE.Mesh(new THREE.BoxGeometry(len + 0.1, 0.02, 0.104), capMat);
    cap.position.copy(body.position);
    cap.position.y = height + 0.01;
    cap.rotation.copy(body.rotation);
    group.add(body, cap);
  }

  function render(map, { highlight } = {}) {
    clear();
    const b = bounds(map.rooms);
    const offset = { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
    const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 3);
    const seen = new Set();
    for (const room of map.rooms) {
      const shape = new THREE.Shape(room.polygon.map(([x, z]) => new THREE.Vector2(x - offset.x, -(z - offset.z))));
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: false });
      geo.rotateX(-Math.PI / 2);
      const color = new THREE.Color(PALETTE[room.type] ?? PALETTE.room);
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
      const floor = new THREE.Mesh(geo, mat);
      floor.receiveShadow = true;
      floor.userData = { roomId: room.id, base: color.clone() };
      floors.push(floor);
      group.add(floor);
      room.polygon.forEach((p, i) => {
        const q = room.polygon[(i + 1) % room.polygon.length];
        const key = [p, q].map((v) => v.join(',')).sort().join('|');
        if (seen.has(key)) return;
        seen.add(key);
        wall(p, q, 0.9, offset);
      });
      const [cx, cz] = centroid(room.polygon);
      const tag = label(`${room.name} · ${room.areaM2} m²`, 'h3-room');
      tag.position.set(cx - offset.x, 0.15, cz - offset.z);
      group.add(tag);
    }
    for (const item of map.items) {
      const pin = new THREE.Mesh(new THREE.SphereGeometry(0.14, 24, 16), new THREE.MeshStandardMaterial({ color: 0xe0694a, roughness: 0.4 }));
      pin.position.set(item.x - offset.x, 0.45, item.z - offset.z);
      pin.castShadow = true;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.36), capMat);
      stem.position.set(pin.position.x, 0.2, pin.position.z);
      const tag = label(item.name, 'h3-item');
      tag.position.set(pin.position.x, 0.75, pin.position.z);
      group.add(pin, stem, tag);
    }
    for (const device of map.devices) {
      const puck = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.22, 32), new THREE.MeshStandardMaterial({ color: device.kind === 'ring' ? 0x3b6fd8 : 0x1c2233, roughness: 0.35 }));
      puck.position.set(device.x - offset.x, 0.19, device.z - offset.z);
      puck.castShadow = true;
      const tag = label(device.label, 'h3-device');
      tag.position.set(puck.position.x, 0.5, puck.position.z);
      group.add(puck, tag);
    }
    sun.shadow.camera.left = sun.shadow.camera.bottom = -span;
    sun.shadow.camera.right = sun.shadow.camera.top = span;
    sun.shadow.camera.updateProjectionMatrix();
    if (!render.framed) {
      const fit = Math.max(1, 1.1 / camera.aspect);
      camera.position.set(span * 0.9 * fit, span * 1.35 * fit, span * 1.6 * fit);
      controls.target.set(0, 0, 0);
      render.framed = true;
    }
    render.offset = offset;
    select(highlight ?? selected);
  }

  function select(roomId) {
    selected = roomId ?? null;
    for (const f of floors) {
      const on = f.userData.roomId === selected;
      f.material.color.copy(f.userData.base);
      if (on) f.material.color.lerp(new THREE.Color(0xf2b27a), 0.55);
      f.position.y = on ? 0.03 : 0;
    }
  }

  function resize() {
    const r = host.getBoundingClientRect();
    size = { w: Math.max(1, r.width), h: Math.max(1, r.height) };
    renderer.setSize(size.w, size.h, false);
    labels.setSize(size.w, size.h);
    camera.aspect = size.w / size.h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(floors)[0];
    if (!hit) return;
    const o = render.offset ?? { x: 0, z: 0 };
    onPick?.(hit.object.userData.roomId, [hit.point.x + o.x, hit.point.z + o.z]);
  });

  let raf = 0;
  const tick = () => {
    controls.update();
    renderer.render(scene, camera);
    labels.render(scene, camera);
    raf = requestAnimationFrame(tick);
  };
  tick();

  return {
    render,
    select,
    destroy() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      clear();
      renderer.dispose();
      host.replaceChildren();
    },
  };
}

function renderPlan(host, map, { selected, onPick }) {
  const b = bounds(map.rooms);
  const pad = 0.6;
  const w = b.maxX - b.minX + pad * 2;
  const h = b.maxZ - b.minZ + pad * 2;
  const root = svg('svg', { viewBox: `${b.minX - pad} ${b.minZ - pad} ${w} ${h}`, role: 'img', 'aria-label': `Floor plan with ${map.rooms.length} rooms`, class: 'h3-plan' });
  for (const room of map.rooms) {
    const pts = room.polygon.map((p) => p.join(',')).join(' ');
    const shape = svg('polygon', { points: pts, fill: PALETTE[room.type] ?? PALETTE.room, class: room.id === selected ? 'on' : '' });
    shape.addEventListener('click', (e) => {
      const pt = root.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const local = pt.matrixTransform(root.getScreenCTM().inverse());
      onPick?.(room.id, [local.x, local.y]);
    });
    const [cx, cz] = centroid(room.polygon);
    root.append(shape, svg('text', { x: cx, y: cz, class: 'h3-plan-room' }, room.name), svg('text', { x: cx, y: cz + 0.42, class: 'h3-plan-area' }, `${room.areaM2} m²`));
  }
  for (const item of map.items) root.append(svg('circle', { cx: item.x, cy: item.z, r: 0.16, class: 'h3-plan-item' }, svg('title', {}, item.name)));
  for (const d of map.devices) root.append(svg('rect', { x: d.x - 0.16, y: d.z - 0.16, width: 0.32, height: 0.32, rx: 0.08, class: `h3-plan-device ${d.kind}` }, svg('title', {}, d.label)));
  host.replaceChildren(root);
}

export function mountHome(root, { elderName = 'them', canEdit = true } = {}) {
  let map = { rooms: [], items: [], devices: [] };
  let mode = webglAvailable() ? '3d' : '2d';
  let scene = null;
  let selected = null;
  let pending = null;

  const stage = el('div', { class: 'h3-stage' });
  const status = el('p', { class: 'h3-status', 'aria-live': 'polite' });
  const toggle3d = el('button', { type: 'button', 'aria-pressed': 'true' }, '3D');
  const toggle2d = el('button', { type: 'button', 'aria-pressed': 'false' }, '2D');
  const scanLink = el('a', { class: 'h3-scan', href: '/scan.html' });
  scanLink.innerHTML = `${icon('scan', { size: 18 })}<span>Walk around with your phone</span>`;

  const rooms = el('ul', { class: 'h3-rooms', 'aria-label': 'Rooms' });
  const items = el('ul', { class: 'h3-items', 'aria-label': 'Things Saathi can help find' });
  const roomSelect = el('select', { name: 'roomId', required: true, 'aria-label': 'Room' });
  const form = el('form', { class: 'h3-place' },
    el('label', {}, 'Something to remember', el('input', { name: 'name', required: true, autocomplete: 'off', placeholder: 'e.g. reading glasses' })),
    el('label', {}, 'Where exactly', el('input', { name: 'note', autocomplete: 'off', placeholder: 'e.g. in the top drawer' })),
    el('label', {}, 'Room', roomSelect),
    el('p', { class: 'h3-hint' }, 'Tip: tap the map to drop the pin in a spot.'),
    el('button', { class: 'pill-action dark', type: 'submit' }, 'Place on the map'));
  const finder = el('form', { class: 'h3-find a-glass' },
    el('input', { name: 'q', type: 'search', autocomplete: 'off', placeholder: `Ask “where are ${elderName}'s keys?”`, 'aria-label': 'Find something in the house' }),
    el('button', { class: 'round-btn dark', type: 'submit', 'aria-label': 'Find' }));
  finder.lastChild.innerHTML = icon('search', { size: 18 });
  const answer = el('p', { class: 'h3-answer', 'aria-live': 'polite' });

  const card = el('div', { class: 'h3' },
    el('div', { class: 'h3-head' },
      el('div', {}, el('h2', { class: 'view-title', id: 'home-h' }, 'My Home'), status),
      el('div', { class: 'h3-tools' }, el('div', { class: 'h3-seg', role: 'group', 'aria-label': 'Map view' }, toggle3d, toggle2d), scanLink)),
    el('div', { class: 'h3-body' },
      el('div', { class: 'h3-stage-wrap' }, stage, finder, answer),
      el('aside', { class: 'h3-side glass' },
        el('h3', {}, 'Rooms'), rooms,
        el('h3', {}, 'Things to help find'), items,
        canEdit ? form : '')));
  root.replaceChildren(card);

  function onPick(roomId, point) {
    selected = roomId;
    pending = { roomId, x: Math.round(point[0] * 100) / 100, z: Math.round(point[1] * 100) / 100 };
    roomSelect.value = roomId;
    highlight();
  }

  function highlight() {
    scene?.select(selected);
    for (const li of rooms.children) li.firstChild.setAttribute('aria-pressed', String(li.dataset.id === selected));
    if (mode === '2d') renderPlan(stage, map, { selected, onPick });
  }

  async function draw() {
    toggle3d.setAttribute('aria-pressed', String(mode === '3d'));
    toggle2d.setAttribute('aria-pressed', String(mode === '2d'));
    stage.dataset.mode = mode;
    if (mode === '3d') {
      if (!scene) {
        stage.replaceChildren();
        try {
          scene = await createScene(stage, { onPick });
        } catch {
          mode = '2d';
          return draw();
        }
      }
      scene.render(map, { highlight: selected });
    } else {
      scene?.destroy();
      scene = null;
      renderPlan(stage, map, { selected, onPick });
    }
  }

  function renderLists() {
    const when = map.updatedAt ? new Date(map.updatedAt).toLocaleDateString([], { day: 'numeric', month: 'short' }) : null;
    const how = map.source === 'webxr' ? 'walked with a phone' : map.source === 'demo' ? 'sample home' : 'drawn by hand';
    status.textContent = map.rooms.length ? `${map.rooms.length} rooms · ${map.totalAreaM2} m² · ${how}${when ? ` · ${when}` : ''}` : 'No map yet. Walk around the house with an Android phone to build one.';
    rooms.replaceChildren(...map.rooms.map((r) => {
      const b = el('button', { type: 'button', 'aria-pressed': String(r.id === selected), onclick: () => { selected = selected === r.id ? null : r.id; highlight(); } },
        el('span', { class: 'h3-swatch', style: `background:${PALETTE[r.type] ?? PALETTE.room}` }), el('span', {}, r.name), el('span', { class: 'muted' }, `${r.areaM2} m²`));
      return el('li', { 'data-id': r.id }, b);
    }));
    items.replaceChildren(...(map.items.length ? map.items.map((i) => {
      const room = map.rooms.find((r) => r.id === i.roomId);
      const remove = canEdit ? el('button', { class: 'h3-x', type: 'button', 'aria-label': `Remove ${i.name}`, onclick: async () => { await fetch(`/api/home/items/${encodeURIComponent(i.id)}`, { method: 'DELETE' }); reload(); } }) : '';
      if (remove) remove.innerHTML = icon('close', { size: 14 });
      return el('li', {}, el('div', {}, el('strong', {}, i.name), el('span', { class: 'muted' }, `${room?.name ?? i.roomId}${i.note ? ` · ${i.note}` : ''}`)), remove);
    }) : [el('li', { class: 'muted' }, 'Nothing placed yet.')]));
    roomSelect.replaceChildren(...map.rooms.map((r) => el('option', { value: r.id }, r.name)));
    if (selected) roomSelect.value = selected;
  }

  async function reload() {
    try {
      const res = await fetch('/api/home');
      if (!res.ok) throw new Error('Could not load the map.');
      map = await res.json();
    } catch (err) {
      status.textContent = err.message;
      return;
    }
    renderLists();
    await draw();
  }

  toggle3d.addEventListener('click', () => { if (webglAvailable()) { mode = '3d'; draw(); } });
  toggle2d.addEventListener('click', () => { mode = '2d'; draw(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const room = map.rooms.find((r) => r.id === data.roomId);
    if (!room) return;
    const spot = pending?.roomId === room.id && pointIn([pending.x, pending.z], room.polygon) ? [pending.x, pending.z] : centroid(room.polygon);
    const res = await fetch('/api/home/items', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: data.name, note: data.note, roomId: room.id, x: spot[0], z: spot[1] }) });
    const json = await res.json().catch(() => ({}));
    answer.textContent = res.ok ? `Saved. Ask Saathi “where is my ${json.name}?” any time.` : json.error ?? 'Could not save that.';
    if (res.ok) { form.reset(); pending = null; reload(); }
  });

  finder.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = finder.q.value.trim();
    if (!q) return;
    const hit = map.items.find((i) => [i.name, ...(i.aliases ?? [])].some((n) => q.toLowerCase().includes(n.toLowerCase()) || n.toLowerCase().includes(q.toLowerCase())));
    if (!hit) { answer.textContent = `Nothing called “${q}” is on the map yet.`; return; }
    selected = hit.roomId;
    highlight();
    const room = map.rooms.find((r) => r.id === hit.roomId);
    answer.textContent = `${hit.name}: ${room?.name ?? hit.roomId}${hit.note ? `, ${hit.note}` : ''}.`;
  });

  reload();
  return { reload, destroy: () => scene?.destroy() };
}
