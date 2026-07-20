/* Kisan Sathi — thin client SPA (vanilla JS) */
const App = (() => {
  let token = localStorage.getItem('ks_token') || null;
  let user = JSON.parse(localStorage.getItem('ks_user') || 'null');
  let ctx = {}; // transient screen context (selected category, etc.)
  let geo = JSON.parse(localStorage.getItem('ks_geo') || 'null'); // { lat, lon } once allowed

  /* ---------- API helper ---------- */
  async function api(path, { method = 'GET', body } = {}) {
    // Guard: the app must be opened via the server (http://localhost:4000),
    // not by double-clicking index.html (file://).
    if (location.protocol === 'file:') {
      throw new Error('Open the app at http://localhost:4000 (do not open the HTML file directly).');
    }
    let res;
    try {
      res = await fetch('/api' + path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new Error('Cannot reach the server. Is it running? Run "npm start" first.');
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && token) {
      // Token is no longer valid (expired, or the account was removed/re-seeded).
      // Drop the stale session and send the user back to login.
      logout();
      toast(data.error || 'Session expired — please log in again');
      throw new Error(data.error || 'Session expired');
    }
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2200);
  }

  /* Simple info popup (single OK button) for showing full details. */
  function infoDialog(title, message) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
      <h3 class="modal-title"></h3>
      <p class="modal-msg" style="white-space:pre-wrap"></p>
      <div class="modal-actions"><button class="btn btn-sm" data-act="ok">OK</button></div></div>`;
    overlay.querySelector('.modal-title').textContent = title || 'Details';
    overlay.querySelector('.modal-msg').textContent = message || '';
    const close = () => { document.removeEventListener('keydown', onKey); overlay.remove(); };
    const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter') close(); };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('[data-act=ok]').onclick = close;
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));
  }

  /* Styled confirm popup -> Promise<boolean>. Replaces the ugly native confirm(). */
  function confirmDialog(message, { title = 'Please confirm', ok = 'Delete', cancel = 'Cancel', danger = true } = {}) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal" role="alertdialog" aria-modal="true">
          <h3 class="modal-title"></h3>
          <p class="modal-msg"></p>
          <div class="modal-actions">
            <button class="btn btn-sm btn-ghost" data-act="cancel"></button>
            <button class="btn btn-sm" data-act="ok" ${danger ? 'style="background:var(--danger)"' : ''}></button>
          </div>
        </div>`;
      overlay.querySelector('.modal-title').textContent = title;
      overlay.querySelector('.modal-msg').textContent = message;
      overlay.querySelector('[data-act=cancel]').textContent = cancel;
      overlay.querySelector('[data-act=ok]').textContent = ok;
      const close = (val) => { document.removeEventListener('keydown', onKey); overlay.remove(); resolve(val); };
      const onKey = (e) => { if (e.key === 'Escape') close(false); if (e.key === 'Enter') close(true); };
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
      overlay.querySelector('[data-act=cancel]').onclick = () => close(false);
      overlay.querySelector('[data-act=ok]').onclick = () => close(true);
      document.addEventListener('keydown', onKey);
      document.body.appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add('show'));
      overlay.querySelector('[data-act=ok]').focus();
    });
  }

  /* ---------- Professional icons (Lucide) ---------- */
  // icon('camera') -> placeholder span that Lucide turns into an inline SVG.
  const icon = (name, cls = '') => `<i data-lucide="${name}" class="ic ${cls}"></i>`;

  // Re-render icon placeholders whenever the DOM changes. We disconnect during
  // createIcons() so its own replacements don't retrigger the observer.
  let iconObserver;
  function renderIcons() {
    if (iconObserver) iconObserver.disconnect();
    try { if (window.lucide) window.lucide.createIcons(); } catch { /* ignore */ }
    // Translate the freshly-rendered DOM to Nepali if that language is selected.
    try { if (window.I18N) window.I18N.apply(document.body); } catch { /* ignore */ }
    if (iconObserver) iconObserver.observe(document.body, { childList: true, subtree: true });
  }
  function startIconObserver() {
    if (!window.MutationObserver) return;
    let scheduled = false;
    iconObserver = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => { scheduled = false; renderIcons(); });
    });
    renderIcons();
  }

  /* Show/hide a password field, swapping the eye icon. */
  function togglePw(id, btn) {
    const input = document.getElementById(id);
    if (!input) return;
    const reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    if (btn) {
      btn.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
      btn.innerHTML = icon(reveal ? 'eye-off' : 'eye');
      renderIcons();
    }
  }

  /* ---------- Auth ---------- */
  function toggleAuth(showRegister) {
    $('login-form').classList.toggle('hidden', showRegister);
    $('register-form').classList.toggle('hidden', !showRegister);
  }
  async function login() {
    const err = $('login-err');
    err.textContent = '';
    const id = $('login-id').value.trim();
    const pass = $('login-pass').value;
    if (!id || !pass) { err.textContent = 'Enter your phone/email and password.'; return; }
    try {
      const data = await api('/auth/login', { method: 'POST', body: { identifier: id, password: pass } });
      setSession(data);
    } catch (e) { err.textContent = e.message; }
  }
  // Ward only makes sense for farmers — hide it when registering as an expert.
  function onRoleChange() {
    const wardEl = $('reg-ward');
    if (wardEl) wardEl.classList.toggle('hidden', $('reg-role').value !== 'farmer');
  }
  async function register() {
    const role = $('reg-role').value;
    const ward = $('reg-ward').value;
    if (role === 'farmer' && !ward) { $('reg-err').textContent = 'Please select your Ward (1–11).'; return; }
    try {
      const data = await api('/auth/register', { method: 'POST', body: {
        name: $('reg-name').value.trim(), phone: $('reg-phone').value.trim(),
        email: $('reg-email').value.trim() || undefined, role,
        ward: ward || undefined, password: $('reg-pass').value } });
      setSession(data);
    } catch (e) { $('reg-err').textContent = e.message; }
  }
  function setSession(data) {
    token = data.token; user = data.user;
    localStorage.setItem('ks_token', token);
    localStorage.setItem('ks_user', JSON.stringify(user));
    try {
      boot();
    } catch (e) {
      // Never fail silently after a successful login.
      $('login-err').textContent = 'Logged in but failed to load screen: ' + e.message;
      console.error('boot() failed:', e);
    }
  }
  function logout() {
    token = null; user = null; localStorage.clear();
    $('app-view').classList.add('hidden'); $('auth-view').classList.remove('hidden');
  }

  /* ---------- Shell / nav ---------- */
  function boot() {
    $('auth-view').classList.add('hidden');
    $('app-view').classList.remove('hidden');
    // First login on this device: follow the account's chosen language. After that
    // the on-screen ने/EN toggle (saved in localStorage) stays in control.
    if (window.I18N && user.language && !localStorage.getItem('ks_lang')) {
      window.I18N.setLang(user.language === 'ne' ? 'ne' : 'en');
    }
    $('user-tag').textContent = `${user.name} · ${labelRole(user.role)}`;
    $('user-tag').style.cursor = 'pointer';
    $('user-tag').onclick = () => go('myProfile'); // tap your name -> profile
    renderNav();
    if (user.role === 'super_admin') go('admin');
    else if (user.role === 'expert') go('threads');
    else go('home');

    // Farmers: ask for location once so weather is local & accurate. If granted
    // while the weather screen is open, refresh it with live data.
    if (user.role === 'farmer' && !geo) {
      requestLocation(true).then((g) => { if (g && ctx._screen === 'weather') go('weather'); });
    }
  }
  const labelRole = (r) => ({ super_admin: 'Admin', farmer: 'Farmer', expert: 'Expert' }[r] || r);

  function renderNav() {
    const items = {
      super_admin: [['admin', 'layout-dashboard', 'Dashboard'], ['manageExperts', 'user-round-cog', 'Experts'], ['market', 'banknote', 'Market'], ['notifs', 'bell', 'Alerts'], ['users', 'users', 'Users']],
      expert: [['threads', 'message-circle', 'Questions'], ['experts', 'user-round', 'Profile'], ['notifs', 'bell', 'Alerts']],
      farmer: [['home', 'house', 'Home'], ['crops', 'sprout', 'My Crops'], ['shop', 'store', 'Bazar'], ['chat', 'messages-square', 'Expert'], ['notifs', 'bell', 'Alerts']],
    }[user.role];
    $('bottom-nav').innerHTML = items.map(([k, ic, label]) =>
      `<button data-nav="${k}" onclick="App.go('${k}')" style="position:relative">${icon(ic)}${label}${k === 'notifs' ? '<span id="notif-badge" class="nav-badge hidden"></span>' : ''}</button>`).join('');
    updateNotifBadge();
  }

  // Refresh the unread count shown on the Alerts/bell nav item.
  async function updateNotifBadge() {
    const badge = $('notif-badge');
    if (!badge) return;
    try {
      const { count } = await api('/notifications/unread-count');
      if (count > 0) { badge.textContent = count > 99 ? '99+' : count; badge.classList.remove('hidden'); }
      else badge.classList.add('hidden');
    } catch { /* ignore */ }
  }

  function go(screen, c = {}) {
    ctx = { ...ctx, ...c, _screen: screen };
    document.querySelectorAll('[data-nav]').forEach((b) => b.classList.toggle('active', b.dataset.nav === screen));
    if (screen !== 'notifs') updateNotifBadge(); // keep the unread badge fresh
    const fn = screens[screen];
    if (fn) fn();
  }

  /* ---------- Screens ---------- */
  const screens = {
    /* FARMER HOME */
    async home() {
      const scr = $('screen');
      scr.innerHTML = `
        <div class="cards">
          <button class="card" onclick="App.go('weather')"><span class="icon">${icon('cloud-sun')}</span><h3>Weather</h3><p>Temp, rain & alerts</p></button>
          <button class="card" onclick="App.go('news')"><span class="icon">${icon('megaphone')}</span><h3>Farm Update</h3><p>News & schemes</p></button>
          <button class="card" onclick="App.go('market')"><span class="icon">${icon('banknote')}</span><h3>Market Price</h3><p>Daily rates</p></button>
          <button class="card" onclick="App.go('sales',{salesMonth:null})"><span class="icon">${icon('trending-up')}</span><h3>Sales</h3><p>Track monthly sales</p></button>
          <button class="card" onclick="App.go('expenses',{expMonth:null,expCat:null,expSel:{}})"><span class="icon">${icon('wallet')}</span><h3>Expenses</h3><p>Wages, seed, fertilizer…</p></button>
          <button class="card" onclick="App.go('chat')"><span class="icon">${icon('messages-square')}</span><h3>Contact Expert</h3><p>Get solutions</p></button>
          <button class="card" onclick="App.go('aiChat')"><span class="icon">${icon('sparkles')}</span><h3>Chat with AI</h3><p>Instant farming help</p></button>
          <button class="card" onclick="App.go('shop',{shopCat:null,shopQ:''})"><span class="icon">${icon('store')}</span><h3>Bazar</h3><p>Buy & sell local products</p></button>
          <button class="card" onclick="App.go('subsidies')"><span class="icon">${icon('hand-coins')}</span><h3>Subsidy</h3><p>Apply for अनुदान support</p></button>
          <button class="card" onclick="App.go('feed')"><span class="icon">${icon('users')}</span><h3>Community</h3><p>Share & discuss with farmers</p></button>
        </div>
        <div class="panel"><div class="section-head"><h3>${icon('stethoscope')} AI Disease Detection</h3></div>
          <p class="muted">Photograph a plant and get a diagnosis.</p>
          <button class="btn btn-ghost btn-sm" onclick="App.go('disease')">Open Detector</button>
        </div>`;
    },

    /* MY CROPS list */
    async crops() {
      const { farms } = await api('/farms');
      const { crops } = await api('/crops');
      $('screen').innerHTML = `
        <div class="toolbar">
          <button class="btn btn-sm" onclick="App.go('addFarm')">+ Add Field</button>
          <button class="btn btn-sm btn-ghost" onclick="App.go('addCrop')">+ Add Crop</button>
        </div>
        <div class="panel"><h3>${icon('house')} My Fields (${farms.length})</h3>
          ${farms.map((f) => `<div class="row"><div><strong>${esc(f.farm_id)}</strong> — ${esc(f.name)}<br><span class="muted">${esc(f.location || '')} · ${f.crop_count} crop(s)</span></div></div>`).join('') || '<p class="muted">No fields yet.</p>'}
        </div>
        <div class="panel"><h3>${icon('sprout')} My Crops (${crops.length})</h3>
          ${crops.map((c) => cropCard(c)).join('') || '<p class="muted">No crops yet.</p>'}
        </div>`;
    },

    async addFarm() {
      $('screen').innerHTML = formPanel('Add Field', [
        ['name', 'Field name'], ['location', 'Location'], ['latitude', 'Latitude', 'number'],
        ['longitude', 'Longitude', 'number'], ['size', 'Size', 'number'], ['soil_type', 'Soil type'],
      ], 'App.submitFarm()', 'crops');
    },
    async submitFarm() {
      const b = readForm(['name', 'location', 'latitude', 'longitude', 'size', 'soil_type']);
      try { await api('/farms', { method: 'POST', body: b }); toast('Field added'); go('crops'); }
      catch (e) { toast(e.message); }
    },

    async addCrop() {
      const { farms } = await api('/farms');
      $('screen').innerHTML = `
        <button class="back" onclick="App.go('crops')">← Back</button>
        <div class="panel"><h2>Add Crop</h2>
          <label>Field</label>
          <select id="f-farm_id">${farms.map((f) => `<option value="${esc(f.farm_id)}">${esc(f.farm_id)} — ${esc(f.name)}</option>`).join('')}</select>
          <label>Category</label>
          <select id="f-category"><option value="vegetable">🥕 Vegetable</option><option value="plant">🌱 Plant</option><option value="tree">🌳 Tree</option><option value="animal">🐄 Animal</option></select>
          <input id="f-name" placeholder="Crop name" />
          <input id="f-plant_count" type="number" placeholder="Plant / animal count" />
          <input id="f-planted_date" type="date" />
          <input id="f-growth_stage" placeholder="Growth stage" />
          <input id="f-watering_schedule" placeholder="Watering schedule" />
          <input id="f-fertilizer_used" placeholder="Fertilizer used" />
          <button class="btn" onclick="App.submitCrop()">Save Crop</button>
        </div>`;
    },
    async submitCrop() {
      const b = readForm(['farm_id', 'category', 'name', 'plant_count', 'planted_date', 'growth_stage', 'watering_schedule', 'fertilizer_used']);
      try { await api('/crops', { method: 'POST', body: b }); toast('Crop added'); go('crops'); }
      catch (e) { toast(e.message); }
    },

    /* UPDATE crop form (reached from a crop card) */
    async updateCrop() {
      const c = ctx.crop;
      $('screen').innerHTML = `
        <button class="back" onclick="App.go('${user.role === 'farmer' ? 'crops' : 'home'}')">← Back</button>
        <div class="panel"><h2>${icon('pencil')} Update ${esc(c.name)} <span class="muted">(${esc(c.farm_id)})</span></h2>
          <input id="f-name" placeholder="Crop name" value="${esc(c.name)}" />
          <input id="f-plant_count" type="number" placeholder="Quantity" value="${c.plant_count ?? ''}" />
          <input id="f-growth_stage" placeholder="Growth stage" value="${esc(c.growth_stage || '')}" />
          <input id="f-fertilizer_used" placeholder="Fertilizer used" value="${esc(c.fertilizer_used || '')}" />
          <input id="f-watering_schedule" placeholder="Watering details" value="${esc(c.watering_schedule || '')}" />
          <input id="f-disease_history" placeholder="Disease problems" value="${esc(c.disease_history || '')}" />
          <select id="f-growth_status"><option ${c.growth_status==='Healthy'?'selected':''}>Healthy</option><option ${c.growth_status==='Diseased'?'selected':''}>Diseased</option><option ${c.growth_status==='At Risk'?'selected':''}>At Risk</option></select>
          <input id="f-harvest_date" type="date" value="${esc(c.harvest_date || '')}" />
          <textarea id="f-notes" placeholder="Notes">${esc(c.notes || '')}</textarea>
          <button class="btn" onclick="App.submitUpdate(${c.crop_id})">Save Changes</button>
        </div>`;
    },
    async submitUpdate(cropId) {
      const details = readForm(['name', 'plant_count', 'growth_stage', 'fertilizer_used', 'watering_schedule', 'disease_history', 'growth_status', 'harvest_date', 'notes']);
      try { await api('/updates', { method: 'POST', body: { crop_id: cropId, details } }); toast('Updated & history saved'); go(user.role === 'farmer' ? 'crops' : 'home'); }
      catch (e) { toast(e.message); }
    },

    /* Subsidy / अनुदान — farmer views own applications and applies. */
    async subsidies() {
      const { subsidies } = await api('/subsidies');
      $('screen').innerHTML = `<button class="back" onclick="App.go('home')">← Back</button>
        <div class="panel"><div class="section-head"><h2>${icon('hand-coins')} Subsidy / अनुदान</h2>
          <button class="btn btn-sm" onclick="App.go('applySubsidy')">${icon('plus')} Apply</button></div>
          <p class="muted">Apply for government support — seed, fertilizer, equipment and more. The nagarpalika reviews each request.</p>
        </div>
        ${subsidies.length ? subsidies.map((s) => subCard(s, false)).join('') : '<p class="muted" style="text-align:center;padding:16px">No applications yet. Tap Apply to request support.</p>'}`;
    },
    async applySubsidy() {
      $('screen').innerHTML = `<button class="back" onclick="App.go('subsidies')">← Back</button>
        <div class="panel"><h2>${icon('hand-coins')} Apply for Subsidy</h2>
          <label>Type of support</label>
          <select id="f-type">${SUBSIDY_TYPES.map((t) => `<option value="${t}">${SUB_EMOJI[t]} ${SUB_LABEL[t]}</option>`).join('')}</select>
          <input id="f-title" placeholder="What do you need? (e.g. 5 kg tomato seeds)"/>
          <textarea id="f-details" placeholder="More details (optional)"></textarea>
          <input id="f-amount" type="number" placeholder="Estimated amount Rs (optional)"/>
          <button class="btn" onclick="App.submitSubsidy()">Submit application</button>
        </div>`;
    },
    async submitSubsidy() {
      const b = readForm(['type', 'title', 'details', 'amount']);
      if (!b.title) return toast('Please describe what you need');
      try { await api('/subsidies', { method: 'POST', body: b }); toast('Application submitted'); go('subsidies'); }
      catch (e) { toast(e.message); }
    },
    async deleteSubsidy(id) {
      try { await api('/subsidies/' + id, { method: 'DELETE' }); toast('Request cancelled'); go(user.role === 'super_admin' ? 'adminSubsidies' : 'subsidies'); }
      catch (e) { toast(e.message); }
    },

    /* COMMUNITY FEED — a public wall (Facebook-style). Anyone can post text +
       a photo; everyone can like and comment; admin can delete any post. */
    async feed() {
      const { posts } = await api('/feed');
      const back = user.role === 'super_admin' ? 'admin' : 'home';
      const admin = user.role === 'super_admin';
      $('screen').innerHTML = `
        <button class="back" onclick="App.go('${back}')">← Back</button>
        <div class="panel">
          <div class="section-head"><h2>${icon('users')} Community Feed</h2></div>
          <p class="muted">Share updates, questions and photos with all farmers. Be respectful.</p>
          <textarea id="post-text" placeholder="What's on your mind, ${esc((user.name || '').split(' ')[0])}?" style="min-height:70px"></textarea>
          <div id="post-preview" style="margin:4px 0"></div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <label class="btn btn-sm btn-ghost" style="display:inline-block;margin:0">${icon('image')} Photo
              <input id="post-image" type="file" accept="image/*" class="hidden" onchange="App.previewPostImg(this)"/></label>
            <button class="btn btn-sm" style="margin:0" onclick="App.submitPost()">${icon('send')} Post</button>
          </div>
        </div>
        ${posts.length ? posts.map((p) => feedCard(p, admin)).join('') : '<p class="muted" style="text-align:center;padding:20px">No posts yet. Be the first to share something!</p>'}`;
    },
    async previewPostImg(input) {
      const f = input.files && input.files[0];
      if (!f) return;
      ctx.postImg = await compressImage(f, { maxDim: 1280, quality: 0.72 });
      const box = $('post-preview');
      if (box) box.innerHTML = `<img src="${ctx.postImg}" style="max-width:100%;border-radius:10px"/>`;
    },
    async submitPost() {
      const content = ($('post-text') || {}).value || '';
      if (!content.trim() && !ctx.postImg) return toast('Write something or add a photo');
      try {
        await api('/feed', { method: 'POST', body: { content, image: ctx.postImg || undefined } });
        ctx.postImg = null;
        toast('Posted');
        go('feed');
      } catch (e) { toast(e.message); }
    },
    async toggleLike(id) {
      try {
        const { liked, like_count } = await api('/feed/' + id + '/like', { method: 'POST', body: {} });
        const btn = $('like-' + id);
        if (btn) {
          btn.classList.toggle('liked', liked);
          btn.innerHTML = `${icon('heart')} ${like_count}`;
        }
      } catch (e) { toast(e.message); }
    },
    async deletePost(id) {
      if (!(await confirmDialog('Delete this post?'))) return;
      try { await api('/feed/' + id, { method: 'DELETE' }); toast('Deleted'); go(ctx._screen === 'post' ? 'feed' : 'feed'); }
      catch (e) { toast(e.message); }
    },
    async post() {
      const id = ctx.postId;
      const admin = user.role === 'super_admin';
      const { post: p, comments } = await api('/feed/' + id);
      $('screen').innerHTML = `
        <button class="back" onclick="App.go('feed')">← Back to Feed</button>
        ${feedCard(p, admin, true)}
        <div class="panel">
          <h3>${icon('message-circle')} Comments (${comments.length})</h3>
          <div style="display:flex;gap:8px;align-items:center">
            <input id="cmt-text" placeholder="Write a comment…" style="margin:0" onkeydown="if(event.key==='Enter')App.addComment(${id})"/>
            <button class="btn btn-sm" onclick="App.addComment(${id})">${icon('send')}</button>
          </div>
          <div style="margin-top:10px">
          ${comments.length ? comments.map((c) => `<div class="cmt-row">
            <div class="feed-avatar sm">${c.author_avatar ? `<img src="${esc(c.author_avatar)}"/>` : icon('user-round')}</div>
            <div style="min-width:0;flex:1">
              <div class="cmt-bubble"><strong>${esc(c.author_name)}</strong>${c.author_role === 'super_admin' ? ' <span class="badge">Admin</span>' : ''}<br>${esc(c.content)}</div>
              <div class="muted" style="font-size:.7rem;margin:2px 0 0 8px">${timeAgo(c.created_at)}
                ${(c.user_id === user.id || admin) ? ` · <button class="link" style="font-size:.7rem" onclick="App.deleteComment(${c.id}, ${id})">Delete</button>` : ''}</div>
            </div>
          </div>`).join('') : '<p class="muted">No comments yet. Say something!</p>'}
          </div>
        </div>`;
    },
    async addComment(postId) {
      const el = $('cmt-text');
      const content = (el ? el.value : '').trim();
      if (!content) return toast('Write a comment');
      try { await api('/feed/' + postId + '/comment', { method: 'POST', body: { content } }); go('post', { postId }); }
      catch (e) { toast(e.message); }
    },
    async deleteComment(id, postId) {
      if (!(await confirmDialog('Delete this comment?'))) return;
      try { await api('/feed/comments/' + id, { method: 'DELETE' }); toast('Deleted'); go('post', { postId }); }
      catch (e) { toast(e.message); }
    },

    /* Admin: review & decide subsidy applications. */
    async adminSubsidies() {
      const status = ctx.subStatus || 'pending';
      const q = status === 'all' ? '' : '?status=' + status;
      const { subsidies } = await api('/subsidies' + q);
      const chips = ['pending', 'approved', 'distributed', 'rejected', 'all'];
      $('screen').innerHTML = `<button class="back" onclick="App.go('admin')">← Dashboard</button>
        <div class="panel"><h2>${icon('hand-coins')} Subsidy Applications</h2>
          <p class="muted">Review farmers' अनुदान requests, approve or reject, and mark distributed.</p>
          <div class="chips-row">${chips.map((c) => `<button class="chip ${status === c ? 'chip-on' : ''}" onclick="App.setSubStatus('${c}')">${c === 'all' ? 'All' : (SUB_STATUS[c] ? SUB_STATUS[c][0] : c)}</button>`).join('')}</div>
        </div>
        ${subsidies.length ? subsidies.map((s) => subCard(s, true)).join('') : '<p class="muted" style="text-align:center;padding:16px">No applications here.</p>'}`;
    },
    setSubStatus(s) { ctx.subStatus = s; screens.adminSubsidies(); },
    async decideSubsidy(id, status) {
      try { await api('/subsidies/' + id, { method: 'PATCH', body: { status } }); toast('Marked ' + status); go('adminSubsidies'); }
      catch (e) { toast(e.message); }
    },

    /* Weather — live from Open-Meteo using the farmer's allowed location. */
    async weather() {
      const q = geo ? `?lat=${geo.lat}&lon=${geo.lon}` : '';
      const { weather, forecast } = await api('/weather' + q);
      $('screen').innerHTML = `<button class="back" onclick="App.go('home')">← Back</button>
        ${!geo ? `<div class="panel" style="border:2px solid var(--amber)">
          <strong>${icon('map-pin')} Get weather for your exact location</strong>
          <p class="muted" style="margin:6px 0 10px">Allow location access for accurate, live weather where your farm is.</p>
          <button class="btn btn-sm" onclick="App.enableLocation()">Allow location</button>
        </div>` : ''}
        <div class="panel">
          <div class="section-head"><h2>${icon(weather && weather.icon ? weather.icon : 'cloud-sun')} Weather</h2>
            ${weather && weather.live ? `<span class="badge up">${icon('radio')} Live</span>` : ''}</div>
          ${weather ? `
          <div class="weather-now">
            <div class="weather-temp">${weather.temperature}°C</div>
            <div>
              <div><strong>${esc(weather.condition || '—')}</strong></div>
              <div class="muted">${icon('map-pin')} ${esc(weather.location)}</div>
            </div>
          </div>
          <dl class="kv" style="margin-top:8px">
            <dt>Humidity</dt><dd>${weather.humidity}%</dd>
            ${weather.wind != null ? `<dt>Wind</dt><dd>${weather.wind} km/h</dd>` : ''}
            <dt>Rain</dt><dd>${esc(weather.rain_prediction || '—')}</dd>
          </dl>
          ${weather.alert ? `<p class="badge" style="white-space:normal">${icon('triangle-alert')} ${esc(weather.alert)}</p>` : ''}` : '<p class="muted">No weather data.</p>'}
        </div>
        ${forecast && forecast.length ? `<div class="panel">
          <h3>${icon('bar-chart-3')} 7-day forecast</h3>
          ${forecastChart(forecast)}
          <div class="legend">
            <span><i class="dot" style="background:#fb8c00"></i>High °C</span>
            <span><i class="dot" style="background:#42a5f5"></i>Low °C</span>
            <span><i class="dot" style="background:#90caf9"></i>Rain %</span>
          </div>
          <div class="fc-row">
            ${forecast.map((d) => `<div class="fc-day">
              <div class="muted" style="font-size:.72rem">${esc(d.label)}</div>
              ${icon(d.icon)}
              <div style="font-weight:700;font-size:.82rem">${d.tmax}°</div>
              <div class="muted" style="font-size:.7rem">${d.tmin}°</div>
              <div style="font-size:.66rem;color:#1565c0">${icon('droplet')} ${d.rain}%</div>
            </div>`).join('')}
          </div>
        </div>` : ''}`;
    },
    async enableLocation() {
      toast('Requesting location…');
      const g = await requestLocation(false);
      if (g) { toast('Location enabled'); go('weather'); }
    },

    /* AI Assistant — instant farming help powered by Gemini. */
    aiChat() {
      const msgs = ctx.aiMessages || [];
      const suggestions = ['My tomato leaves are turning yellow', 'Best fertilizer for paddy?', 'How to control whiteflies naturally?'];
      $('screen').innerHTML = `
        <button class="back" onclick="App.go('home')">← Back</button>
        <div class="panel">
          <div class="section-head"><h2>${icon('sparkles')} Chat with AI</h2>
            ${msgs.length ? `<button class="btn btn-sm btn-ghost" onclick="App.clearAiChat()">Clear</button>` : ''}</div>
          <p class="muted">Ask anything about crops, pests, fertilizer, soil or weather.</p>
          <div class="chat-box" id="ai-box">
            ${msgs.length ? msgs.map((m) => `<div class="msg ${m.role === 'farmer' ? 'farmer' : 'expert'}">${m.image ? `<img src="${esc(m.image)}" style="max-width:180px;border-radius:8px;display:block;${m.text ? 'margin-bottom:6px' : ''}"/>` : ''}${esc(m.text || '')}</div>`).join('') : ''}
            ${ctx.aiThinking ? `<div class="msg expert"><em>typing…</em></div>` : ''}
            ${!msgs.length ? `<div class="ai-suggest">${suggestions.map((s) => `<button class="chip" onclick="App.askAi('${esc(s).replace(/'/g, '&#39;')}')">${esc(s)}</button>`).join('')}</div>` : ''}
          </div>
          <div id="ai-preview" style="margin-top:8px">${ctx.aiImg ? `<div style="position:relative;display:inline-block"><img src="${ctx.aiImg}" style="max-width:120px;border-radius:8px"/><button class="btn btn-sm" style="position:absolute;top:2px;right:2px;background:var(--danger);padding:2px 7px;width:auto" onclick="App.clearAiImg()">✕</button></div>` : ''}</div>
          <div style="display:flex;gap:8px;margin-top:10px;align-items:center">
            <label class="btn btn-sm btn-ghost" style="margin:0;padding:10px;flex:0 0 auto" title="Add a photo">${icon('image')}
              <input id="ai-image" type="file" accept="image/*" class="hidden" onchange="App.previewAiImg(this)" ${ctx.aiThinking ? 'disabled' : ''}/></label>
            <input id="ai-text" placeholder="Type your question…" style="margin:0" onkeydown="if(event.key==='Enter')App.sendAi()" ${ctx.aiThinking ? 'disabled' : ''}/>
            <button class="btn btn-sm" onclick="App.sendAi()" ${ctx.aiThinking ? 'disabled' : ''}>${icon('send')}</button>
          </div>
        </div>`;
      const box = $('ai-box'); if (box) box.scrollTop = box.scrollHeight;
      const input = $('ai-text'); if (input && !ctx.aiThinking) input.focus();
    },
    askAi(text) { const i = $('ai-text'); if (i) i.value = text; screens.sendAi(); },
    async previewAiImg(input) {
      const f = input.files && input.files[0];
      if (!f) return;
      ctx.aiImg = await compressImage(f, { maxDim: 1280, quality: 0.7 });
      screens.aiChat();
    },
    clearAiImg() { ctx.aiImg = null; screens.aiChat(); },
    async sendAi() {
      const input = $('ai-text');
      const text = input ? input.value.trim() : '';
      const image = ctx.aiImg || null;
      if ((!text && !image) || ctx.aiThinking) return;
      ctx.aiMessages = ctx.aiMessages || [];
      ctx.aiMessages.push({ role: 'farmer', text, image });
      ctx.aiImg = null;
      ctx.aiThinking = true;
      screens.aiChat();
      try {
        // Only send the image on the newest message to keep the request small
        // (older photos would re-upload the full base64 every turn).
        const recent = ctx.aiMessages.slice(-12);
        const payload = recent.map((m, i) => ({ role: m.role, text: m.text, image: i === recent.length - 1 ? m.image : undefined }));
        const { reply } = await api('/chat/ai', { method: 'POST', body: { messages: payload } });
        ctx.aiMessages.push({ role: 'ai', text: reply });
      } catch (e) {
        ctx.aiMessages.push({ role: 'ai', text: e.message || 'Sorry, I am busy right now. Please try again.' });
      } finally {
        ctx.aiThinking = false;
        screens.aiChat();
      }
    },
    clearAiChat() { ctx.aiMessages = []; ctx.aiImg = null; screens.aiChat(); },

    /* Farm update / news (uses general + scheme notifications) */
    async news() {
      const { notifications } = await api('/notifications');
      const news = notifications.filter((n) => n.type === 'general' || n.type === 'pest' || n.type === 'rain');
      $('screen').innerHTML = `<button class="back" onclick="App.go('home')">← Back</button>
        <div class="panel"><h2>${icon('megaphone')} Farm Update</h2>
          ${news.map((n) => `<div class="row"><div><strong>${esc(n.title)}</strong><br><span class="muted">${esc(n.message || '')}</span></div></div>`).join('') || '<p class="muted">No updates.</p>'}
        </div>`;
    },

    /* Market */
    async market() {
      const { prices } = await api('/market');
      ctx.marketPrices = prices; // cache for inline edit
      const admin = user.role === 'super_admin';
      const trendOpts = (sel) => ['stable', 'up', 'down'].map((t) => `<option ${t === sel ? 'selected' : ''}>${t}</option>`).join('');
      const editing = ctx.editPriceId;

      $('screen').innerHTML = `${admin ? '' : '<button class="back" onclick="App.go(\'home\')">← Back</button>'}
        <div class="panel"><h2>${icon('banknote')} Market Prices</h2>
          ${prices.map((p) => `<div class="row"><div><strong>${esc(p.crop_name)}</strong> <span class="muted">${esc(p.market_name || '')}</span><br>
            <span class="muted">${esc(p.suggestion)}</span></div>
            <div style="text-align:right">Rs ${p.price}/${esc((p.unit || 'per kg').replace('per ', ''))}<br>
              <span class="badge ${esc(p.trend)}">${esc(p.trend)}</span>
              ${admin ? `<div style="margin-top:6px;display:flex;gap:6px;justify-content:flex-end">
                <button class="btn btn-sm btn-ghost" onclick="App.editMarket(${p.id})">Edit</button>
                <button class="btn btn-sm" style="width:auto;background:var(--danger)" onclick="App.deleteMarket(${p.id})">Delete</button></div>` : ''}
            </div></div>`).join('')}
        </div>
        ${admin && editing ? `<div class="panel" style="border:2px solid var(--amber)"><h3>${icon('pencil')} Edit price</h3>
          ${marketForm(prices.find((p) => p.id === editing) || {}, trendOpts)}
          <div style="display:flex;gap:8px;margin-top:8px">
            <button class="btn btn-sm" onclick="App.savePrice(${editing})">Save</button>
            <button class="btn btn-sm btn-ghost" onclick="App.cancelEditMarket()">Cancel</button></div></div>`
        : admin ? `<div class="panel"><h3>Add price</h3>
          ${marketForm({}, trendOpts)}
          <button class="btn btn-sm" onclick="App.addPrice()">Add</button></div>` : ''}`;
    },
    async addPrice() {
      const b = readMarketForm();
      if (!b.crop_name || b.price === '' ) { toast('Crop and price required'); return; }
      b.price = Number(b.price);
      try { await api('/market', { method: 'POST', body: b }); toast('Price added'); go('market'); } catch (e) { toast(e.message); }
    },
    editMarket(id) { ctx.editPriceId = id; go('market'); },
    cancelEditMarket() { ctx.editPriceId = null; go('market'); },
    async savePrice(id) {
      const b = readMarketForm();
      if (b.price !== '' && b.price !== undefined) b.price = Number(b.price);
      try { await api('/market/' + id, { method: 'PATCH', body: b }); ctx.editPriceId = null; toast('Price updated'); go('market'); }
      catch (e) { toast(e.message); }
    },
    async deleteMarket(id) {
      if (!(await confirmDialog('Delete this market price?'))) return;
      try { await api('/market/' + id, { method: 'DELETE' }); toast('Deleted'); go('market'); } catch (e) { toast(e.message); }
    },

    /* SALES — monthly sales tracking with a clickable curve chart. */
    async sales() {
      const back = user.role === 'super_admin' ? 'admin' : 'home';
      const [{ series, stats }, { sales }, cropsRes] = await Promise.all([
        api('/sales/summary?months=6'),
        api('/sales'),
        user.role === 'farmer' ? api('/crops') : Promise.resolve({ crops: [] }),
      ]);
      const crops = cropsRes.crops || [];
      const best = stats.best_month && stats.best_month.amount > 0 ? stats.best_month : null;

      // Optional month filter set by clicking a point on the chart.
      const selMonth = ctx.salesMonth || null;
      const selInfo = selMonth ? series.find((s) => s.month === selMonth) : null;
      const shown = selMonth ? sales.filter((s) => (s.sale_date || '').slice(0, 7) === selMonth) : sales;

      $('screen').innerHTML = `
        <button class="back" onclick="App.go('${back}')">← Back</button>
        <div class="panel"><h2>${icon('trending-up')} Sales</h2>
          <div class="stat-row">
            <div class="stat"><span class="stat-num">Rs ${money(stats.this_month)}</span><span class="stat-lbl">This month</span></div>
            <div class="stat"><span class="stat-num">Rs ${money(stats.total_amount)}</span><span class="stat-lbl">Total earned</span></div>
            <div class="stat"><span class="stat-num">${stats.total_sales}</span><span class="stat-lbl">Sales logged</span></div>
            <div class="stat"><span class="stat-num">${best ? best.label : '—'}</span><span class="stat-lbl">Best month</span></div>
          </div>
        </div>

        <div class="panel"><h3>${icon('bar-chart-3')} Monthly sales (Rs)</h3>
          ${areaChart(series, selMonth)}
          <p class="muted" style="text-align:center;margin:6px 0 0">${selInfo
            ? `${esc(selInfo.label)}: <strong style="color:var(--green-dark)">Rs ${money(selInfo.amount)}</strong> · ${selInfo.count} sale(s)`
            : 'Tap a month to filter the sales below.'}</p>
        </div>

        <div class="panel"><h3>${icon('plus')} Record a sale</h3>
          <input id="s-product" placeholder="Product (e.g. Tomato)" list="crop-list"/>
          <datalist id="crop-list">${crops.map((c) => `<option value="${esc(c.name)}">`).join('')}</datalist>
          <div class="form-grid">
            <input id="s-quantity" type="number" min="0" step="any" placeholder="Quantity"/>
            <input id="s-unit" placeholder="Unit (kg)" value="kg"/>
            <input id="s-price" type="number" min="0" step="any" placeholder="Price / unit (Rs)"/>
            <input id="s-date" type="date" value="${new Date().toISOString().slice(0, 10)}"/>
          </div>
          <input id="s-buyer" placeholder="Buyer (optional)"/>
          <div id="s-total" class="muted" style="margin:2px 0 10px">Total: Rs 0</div>
          <button class="btn btn-sm" onclick="App.addSale()">Add sale</button>
        </div>

        <div class="panel">
          <div class="section-head"><h3>${selMonth ? esc(selInfo.label) + ' sales' : 'Recent sales'}</h3>
            ${selMonth ? `<button class="btn btn-sm btn-ghost" onclick="App.selectSalesMonth(null)">Clear filter</button>` : ''}</div>
          ${shown.length ? shown.map((s) => `<div class="row sale-row" style="cursor:pointer"
              onclick='App.showSale(${JSON.stringify(s).replace(/'/g, "&#39;")})'>
            <div><strong>${esc(s.product)}</strong> <span class="muted">${esc(s.sale_date)}</span><br>
              <span class="muted">${s.quantity} ${esc(s.unit || '')} × Rs ${s.price_per_unit}${s.buyer ? ' · ' + esc(s.buyer) : ''}</span></div>
            <div style="text-align:right;white-space:nowrap">Rs ${money(s.total_amount)} ${icon('chevron-right')}<br>
              <button class="btn btn-sm btn-ghost" style="margin-top:4px" onclick="event.stopPropagation(); App.deleteSale(${s.id})">Delete</button></div>
          </div>`).join('') : `<p class="muted">${selMonth ? 'No sales in this month.' : 'No sales yet. Record your first sale above.'}</p>`}
        </div>`;

      // Live total = quantity × price as the farmer types.
      const recalc = () => {
        const q = Number($('s-quantity').value) || 0, p = Number($('s-price').value) || 0;
        $('s-total').textContent = 'Total: Rs ' + money(Math.round(q * p));
      };
      $('s-quantity').oninput = recalc;
      $('s-price').oninput = recalc;
    },
    async addSale() {
      const product = $('s-product').value.trim();
      const quantity = Number($('s-quantity').value);
      const price = Number($('s-price').value);
      if (!product) return toast('Enter the product');
      if (!(quantity > 0)) return toast('Enter a quantity');
      if (!(price >= 0)) return toast('Enter a price');
      const body = {
        product, quantity, price_per_unit: price,
        unit: $('s-unit').value.trim() || 'kg',
        buyer: $('s-buyer').value.trim() || undefined,
        sale_date: $('s-date').value || undefined,
      };
      try { await api('/sales', { method: 'POST', body }); toast('Sale recorded'); go('sales'); }
      catch (e) { toast(e.message); }
    },
    async deleteSale(id) {
      if (!(await confirmDialog('Delete this sale?'))) return;
      try { await api('/sales/' + id, { method: 'DELETE' }); toast('Deleted'); go('sales'); }
      catch (e) { toast(e.message); }
    },
    // Click a month on the chart to filter the list; click it again to clear.
    selectSalesMonth(month) {
      ctx.salesMonth = (month && ctx.salesMonth === month) ? null : (month || null);
      screens.sales();
    },
    // Open a single sale to see exactly how much was sold.
    showSale(sale) { go('saleDetail', { sale }); },
    saleDetail() {
      const s = ctx.sale;
      if (!s) return go('sales');
      $('screen').innerHTML = `
        <button class="back" onclick="App.go('sales')">← Back to sales</button>
        <div class="panel" style="text-align:center">
          <span class="muted">${icon('trending-up')} You sold</span>
          <div style="font-size:2.1rem;font-weight:800;color:var(--green-dark);margin:4px 0">Rs ${money(s.total_amount)}</div>
          <div class="muted">${esc(s.product)} · ${esc(s.sale_date)}</div>
        </div>
        <div class="panel"><h3>Breakdown</h3>
          <dl class="kv">
            <dt>Product</dt><dd>${esc(s.product)}</dd>
            ${s.category ? `<dt>Category</dt><dd>${esc(s.category)}</dd>` : ''}
            <dt>Quantity</dt><dd>${s.quantity} ${esc(s.unit || '')}</dd>
            <dt>Price / unit</dt><dd>Rs ${money(s.price_per_unit)}</dd>
            <dt>Total earned</dt><dd>Rs ${money(s.total_amount)}</dd>
            <dt>Buyer</dt><dd>${esc(s.buyer || '—')}</dd>
            <dt>Date</dt><dd>${esc(s.sale_date)}</dd>
            ${s.notes ? `<dt>Notes</dt><dd>${esc(s.notes)}</dd>` : ''}
          </dl>
          <button class="btn btn-sm" style="margin-top:10px;background:var(--danger)" onclick="App.deleteSale(${s.id})">Delete this sale</button>
        </div>`;
    },

    /* EXPENSES — wages, fertilizer, seed, plants… with income-vs-expense chart. */
    async expenses() {
      const back = user.role === 'super_admin' ? 'admin' : 'home';
      const [{ series, categories, stats }, { expenses }, cropsRes] = await Promise.all([
        api('/expenses/summary?months=6'),
        api('/expenses'),
        user.role === 'farmer' ? api('/crops') : Promise.resolve({ crops: [] }),
      ]);
      const crops = cropsRes.crops || [];
      const selMonth = ctx.expMonth || null;
      const selInfo = selMonth ? series.find((s) => s.month === selMonth) : null;
      const catFilter = ctx.expCat || null;
      ctx.expSel = ctx.expSel || {};
      let shown = selMonth ? expenses.filter((e) => (e.expense_date || '').slice(0, 7) === selMonth) : expenses;
      if (catFilter) shown = shown.filter((e) => e.category === catFilter);
      ctx.expShownIds = shown.map((e) => e.id);
      const selCount = shown.filter((e) => ctx.expSel[e.id]).length;
      const allChecked = shown.length > 0 && selCount === shown.length;
      const maxCat = Math.max(1, ...categories.map((c) => c.amount));
      const profitColor = (v) => (v >= 0 ? 'var(--green-dark)' : 'var(--danger)');

      $('screen').innerHTML = `
        <button class="back" onclick="App.go('${back}')">← Back</button>
        <div class="panel"><h2>${icon('wallet')} Expenses</h2>
          <div class="stat-row">
            <div class="stat"><span class="stat-num">Rs ${money(stats.this_month_expenses)}</span><span class="stat-lbl">Spent this month</span></div>
            <div class="stat"><span class="stat-num" style="color:${profitColor(stats.this_month_profit)}">Rs ${money(stats.this_month_profit)}</span><span class="stat-lbl">Profit this month</span></div>
            <div class="stat"><span class="stat-num">Rs ${money(stats.total_expenses)}</span><span class="stat-lbl">Total spent</span></div>
            <div class="stat"><span class="stat-num">${stats.top_category ? esc(EXP_LABEL[stats.top_category.category] || stats.top_category.category) : '—'}</span><span class="stat-lbl">Biggest cost</span></div>
          </div>
        </div>

        <div class="panel"><h3>${icon('bar-chart-3')} Income vs Expenses (Rs)</h3>
          ${trendChart(series, [
            { key: 'income', color: '#2e7d32', id: 'inc', label: 'Income' },
            { key: 'expenses', color: '#8e24aa', id: 'exp', label: 'Expenses' },
          ], selMonth, 'App.selectExpMonth')}
          <div class="legend">
            <span><i class="dot" style="background:#2e7d32"></i>Income</span>
            <span><i class="dot" style="background:#8e24aa"></i>Expenses</span>
          </div>
          <p class="muted" style="text-align:center;margin:6px 0 0">${selInfo
            ? `${esc(selInfo.label)} — spent <strong>Rs ${money(selInfo.expenses)}</strong>, earned <strong>Rs ${money(selInfo.income)}</strong>, profit <strong style="color:${profitColor(selInfo.profit)}">Rs ${money(selInfo.profit)}</strong>`
            : 'Tap a month to see that month\'s costs.'}</p>
        </div>

        ${categories.length ? `<div class="panel"><h3>Where money went</h3>
          ${categories.map((c) => `<div style="margin:8px 0">
            <div class="bar-row"><span>${icon(EXP_ICON[c.category] || 'circle')} ${esc(EXP_LABEL[c.category] || c.category)}</span><strong>Rs ${money(c.amount)}</strong></div>
            <div class="bar-track"><div class="bar-fill" style="width:${Math.round((c.amount / maxCat) * 100)}%"></div></div>
          </div>`).join('')}
        </div>` : ''}

        <div class="panel"><h3>${icon('plus')} Record an expense</h3>
          <select id="e-category" onchange="App.expFormMode()">
            ${EXP_CATS.map((c) => `<option value="${c}">${esc(EXP_LABEL[c])}</option>`).join('')}
          </select>
          <input id="e-desc" placeholder="Description (e.g. Urea fertilizer / Field weeding)" list="crop-list"/>
          <datalist id="crop-list">${crops.map((c) => `<option value="${esc(c.name)}">`).join('')}</datalist>
          <div id="e-fields"></div>
          <input id="e-date" type="date" value="${new Date().toISOString().slice(0, 10)}"/>
          <div id="e-total" class="muted" style="margin:2px 0 10px">Total: Rs 0</div>
          <button class="btn btn-sm" onclick="App.addExpense()">Add expense</button>
        </div>

        <div class="panel">
          <div class="section-head"><h3>${selMonth ? esc(selInfo.label) + ' expenses' : 'Recent expenses'}</h3>
            ${selMonth ? `<button class="btn btn-sm btn-ghost" onclick="App.selectExpMonth(null)">Clear month</button>` : ''}</div>
          <div class="toolbar" style="align-items:center">
            <label class="check-lbl"><input type="checkbox" id="exp-all" ${allChecked ? 'checked' : ''} onchange="App.toggleExpSelAll(this.checked)"/> Select all</label>
            <select onchange="App.filterExpCat(this.value)" style="margin:0;width:auto;flex:1;min-width:130px">
              <option value="">All types</option>
              ${EXP_CATS.map((c) => `<option value="${c}" ${catFilter === c ? 'selected' : ''}>${esc(EXP_LABEL[c])}</option>`).join('')}
            </select>
          </div>
          <button id="exp-bulk" class="btn btn-sm" style="background:var(--danger);margin:0 0 10px;display:${selCount ? '' : 'none'}" onclick="App.deleteSelectedExp()">Delete selected (${selCount})</button>
          ${shown.length ? shown.map((e) => {
            const j = JSON.stringify(e).replace(/'/g, '&#39;');
            return `<div class="row sale-row">
              <input type="checkbox" class="exp-check" data-id="${e.id}" ${ctx.expSel[e.id] ? 'checked' : ''}
                onclick="event.stopPropagation()" onchange="App.toggleExpSel(${e.id}, this.checked)"/>
              <div style="flex:1;min-width:0;cursor:pointer" onclick='App.showExpense(${j})'>
                <strong>${icon(EXP_ICON[e.category] || 'circle')} ${esc(e.description)}</strong> <span class="muted">${esc(e.expense_date)}</span><br>
                <span class="muted">${expLineDesc(e)}</span></div>
              <div style="text-align:right;white-space:nowrap;cursor:pointer" onclick='App.showExpense(${j})'>Rs ${money(e.amount)} ${icon('chevron-right')}<br>
                <button class="btn btn-sm btn-ghost" style="margin-top:4px" onclick="event.stopPropagation(); App.deleteExpense(${e.id})">Delete</button></div>
            </div>`;
          }).join('') : `<p class="muted">${catFilter || selMonth ? 'No expenses match this filter.' : 'No expenses yet. Record your first expense above.'}</p>`}
        </div>`;

      screens.expFormMode(); // render category-specific fields + wire live total
    },
    // Show fields appropriate to the chosen category (workers/wages vs qty/cost).
    expFormMode() {
      const cat = $('e-category') ? $('e-category').value : 'other';
      const box = $('e-fields');
      if (!box) return;
      if (cat === 'wages') {
        box.innerHTML = `<div class="form-grid">
          <input id="e-workers" type="number" min="0" step="1" placeholder="Number of workers"/>
          <input id="e-rate" type="number" min="0" step="any" placeholder="Wage per worker (Rs)"/>
        </div>`;
      } else if (cat === 'equipment' || cat === 'transport' || cat === 'other') {
        box.innerHTML = `<input id="e-rate" type="number" min="0" step="any" placeholder="Amount (Rs)"/>`;
      } else { // fertilizer, seed, plants, pesticide -> quantity × cost
        box.innerHTML = `<div class="form-grid">
          <input id="e-quantity" type="number" min="0" step="any" placeholder="Quantity"/>
          <select id="e-unit">${EXP_UNITS.map((u) => `<option value="${u}">${esc(u)}</option>`).join('')}</select>
        </div>
        <input id="e-rate" type="number" min="0" step="any" placeholder="Cost per unit (Rs)"/>`;
      }
      const recalc = () => {
        const rate = Number(($('e-rate') || {}).value) || 0;
        const mult = $('e-workers') ? (Number($('e-workers').value) || 0)
          : $('e-quantity') ? (Number($('e-quantity').value) || 0) : 1;
        $('e-total').textContent = 'Total: Rs ' + money(Math.round(rate * mult));
      };
      ['e-workers', 'e-quantity', 'e-rate'].forEach((id) => { if ($(id)) $(id).oninput = recalc; });
      recalc();
    },
    async addExpense() {
      const category = $('e-category').value;
      const description = $('e-desc').value.trim();
      if (!description) return toast('Enter a description');
      const body = {
        category, description,
        rate: Number(($('e-rate') || {}).value) || 0,
        workers: $('e-workers') ? $('e-workers').value : undefined,
        quantity: $('e-quantity') ? $('e-quantity').value : undefined,
        unit: $('e-unit') ? $('e-unit').value.trim() : (category === 'wages' ? 'day' : undefined),
        expense_date: $('e-date').value || undefined,
      };
      try { await api('/expenses', { method: 'POST', body }); toast('Expense recorded'); go('expenses'); }
      catch (e) { toast(e.message); }
    },
    async deleteExpense(id) {
      if (!(await confirmDialog('Delete this expense?'))) return;
      try { await api('/expenses/' + id, { method: 'DELETE' }); toast('Deleted'); go('expenses'); }
      catch (e) { toast(e.message); }
    },
    selectExpMonth(month) {
      ctx.expMonth = (month && ctx.expMonth === month) ? null : (month || null);
      screens.expenses();
    },
    filterExpCat(value) { ctx.expCat = value || null; ctx.expSel = {}; screens.expenses(); },
    toggleExpSel(id, checked) {
      ctx.expSel = ctx.expSel || {};
      if (checked) ctx.expSel[id] = true; else delete ctx.expSel[id];
      updateExpSelUI();
    },
    toggleExpSelAll(checked) {
      ctx.expSel = ctx.expSel || {};
      (ctx.expShownIds || []).forEach((id) => { if (checked) ctx.expSel[id] = true; else delete ctx.expSel[id]; });
      document.querySelectorAll('.exp-check').forEach((cb) => { cb.checked = checked; });
      updateExpSelUI();
    },
    async deleteSelectedExp() {
      const ids = (ctx.expShownIds || []).filter((id) => ctx.expSel && ctx.expSel[id]);
      if (!ids.length) return;
      if (!(await confirmDialog(`Delete ${ids.length} expense(s)?`, { title: 'Delete expenses' }))) return;
      try {
        for (const id of ids) await api('/expenses/' + id, { method: 'DELETE' });
        ctx.expSel = {};
        toast(`Deleted ${ids.length} expense(s)`);
        go('expenses');
      } catch (e) { toast(e.message); }
    },
    showExpense(exp) { go('expenseDetail', { exp }); },
    expenseDetail() {
      const e = ctx.exp;
      if (!e) return go('expenses');
      $('screen').innerHTML = `
        <button class="back" onclick="App.go('expenses')">← Back to expenses</button>
        <div class="panel" style="text-align:center">
          <span class="muted">${icon(EXP_ICON[e.category] || 'wallet')} You spent</span>
          <div style="font-size:2.1rem;font-weight:800;color:#6a1b9a;margin:4px 0">Rs ${money(e.amount)}</div>
          <div class="muted">${esc(e.description)} · ${esc(e.expense_date)}</div>
        </div>
        <div class="panel"><h3>Breakdown</h3>
          <dl class="kv">
            <dt>Category</dt><dd>${esc(EXP_LABEL[e.category] || e.category)}</dd>
            <dt>Description</dt><dd>${esc(e.description)}</dd>
            ${e.workers != null ? `<dt>Workers</dt><dd>${e.workers}</dd><dt>Wage / worker</dt><dd>Rs ${money(e.rate)}</dd>` : ''}
            ${e.quantity != null ? `<dt>Quantity</dt><dd>${e.quantity} ${esc(e.unit || '')}</dd><dt>Cost / unit</dt><dd>Rs ${money(e.rate)}</dd>` : ''}
            <dt>Total spent</dt><dd>Rs ${money(e.amount)}</dd>
            <dt>Date</dt><dd>${esc(e.expense_date)}</dd>
            ${e.notes ? `<dt>Notes</dt><dd>${esc(e.notes)}</dd>` : ''}
          </dl>
          <button class="btn btn-sm" style="margin-top:10px;background:var(--danger)" onclick="App.deleteExpense(${e.id})">Delete this expense</button>
        </div>`;
    },

    /* ============ MARKETPLACE / BAZAR ============ */
    /* Browse listings with search, category, price & sort filters. */
    async shop() {
      const cat = ctx.shopCat || '';
      const q = ctx.shopQ || '';
      const sort = ctx.shopSort || 'new';
      const minP = ctx.shopMin || '';
      const maxP = ctx.shopMax || '';
      const params = new URLSearchParams();
      if (cat) params.set('category', cat);
      if (q) params.set('q', q);
      if (sort) params.set('sort', sort);
      if (minP) params.set('minPrice', minP);
      if (maxP) params.set('maxPrice', maxP);
      const { products, categories } = await api('/products?' + params.toString());
      const back = user.role === 'super_admin' ? 'admin' : 'home';
      const filtersOpen = ctx.shopFiltersOpen;
      $('screen').innerHTML = `
        <button class="back" onclick="App.go('${back}')">← Back</button>
        <div class="panel">
          <div class="section-head"><h2>${icon('store')} Bazar</h2>
            <div style="display:flex;gap:6px">
              <button class="btn btn-sm btn-ghost" onclick="App.go('myShop')">${icon('store')} My Shop</button>
              <button class="btn btn-sm" onclick="App.go('sellProduct')">${icon('plus')} Sell</button>
            </div></div>
          <div style="display:flex;gap:8px;align-items:center">
            <input id="shop-q" placeholder="Search products, location…" value="${esc(q)}" style="margin:0"
              onkeydown="if(event.key==='Enter')App.searchShop()"/>
            <button class="btn btn-sm" onclick="App.searchShop()">${icon('search')}</button>
          </div>
          <div class="chips-row" style="margin-top:8px">
            <button class="chip ${!cat ? 'chip-on' : ''}" onclick="App.filterShop('')">All</button>
            ${(categories || SHOP_CATS).map((c) => `<button class="chip ${cat === c ? 'chip-on' : ''}" onclick="App.filterShop('${c}')">${icon(SHOP_ICON[c] || 'package')} ${esc(SHOP_LABEL[c] || c)}</button>`).join('')}
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;gap:8px">
            <select id="shop-sort" onchange="App.sortShop(this.value)" style="margin:0;width:auto;flex:1">
              <option value="new" ${sort === 'new' ? 'selected' : ''}>Newest first</option>
              <option value="price_asc" ${sort === 'price_asc' ? 'selected' : ''}>Price: Low to High</option>
              <option value="price_desc" ${sort === 'price_desc' ? 'selected' : ''}>Price: High to Low</option>
            </select>
            <button class="btn btn-sm btn-ghost" onclick="App.toggleShopFilters()">${icon('sliders-horizontal')} Filters</button>
          </div>
          ${filtersOpen ? `<div class="form-grid" style="margin-top:8px">
            <input id="shop-min" type="number" min="0" placeholder="Min price (Rs)" value="${esc(minP)}"/>
            <input id="shop-max" type="number" min="0" placeholder="Max price (Rs)" value="${esc(maxP)}"/>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-sm" onclick="App.applyPriceFilter()">Apply</button>
            <button class="btn btn-sm btn-ghost" onclick="App.clearShopFilters()">Clear all</button>
          </div>` : ''}
        </div>
        <p class="muted" style="margin:0 0 8px">${products.length} product${products.length === 1 ? '' : 's'}${cat ? ' in ' + esc(SHOP_LABEL[cat] || cat) : ''}</p>
        ${products.length ? `<div class="shop-grid">
          ${products.map((p) => `<button class="shop-card" onclick="App.openProduct(${p.id})">
            <div class="shop-img">${p.image ? `<img src="${esc(p.image)}" alt=""/>` : icon(SHOP_ICON[p.category] || 'package')}</div>
            <div class="shop-body">
              <div class="shop-title">${esc(p.title)}</div>
              <div class="shop-price">Rs ${money(p.price)}<span class="muted">/${esc(p.unit || '')}</span></div>
              <div class="muted" style="font-size:.72rem">${icon('map-pin')} ${esc(p.location || '—')}</div>
              <div class="muted" style="font-size:.7rem">${esc(p.seller_name)}${p.sold_count ? ' · ' + p.sold_count + ' sold' : ''}</div>
            </div></button>`).join('')}
        </div>` : `<p class="muted" style="text-align:center;padding:20px">No products found. ${q || cat || minP || maxP ? 'Try another search or clear filters.' : 'Be the first to list one — tap Sell.'}</p>`}`;
      const qi = $('shop-q'); if (qi) { qi.focus(); qi.setSelectionRange(qi.value.length, qi.value.length); }
    },
    searchShop() { ctx.shopQ = ($('shop-q') || {}).value || ''; screens.shop(); },
    filterShop(cat) { ctx.shopCat = cat || null; screens.shop(); },
    sortShop(v) { ctx.shopSort = v; screens.shop(); },
    toggleShopFilters() { ctx.shopFiltersOpen = !ctx.shopFiltersOpen; screens.shop(); },
    applyPriceFilter() { ctx.shopMin = ($('shop-min') || {}).value || ''; ctx.shopMax = ($('shop-max') || {}).value || ''; screens.shop(); },
    clearShopFilters() { ctx.shopCat = null; ctx.shopQ = ''; ctx.shopMin = ''; ctx.shopMax = ''; ctx.shopSort = 'new'; screens.shop(); },

    async openProduct(id) {
      const { product: p } = await api('/products/' + id);
      const mine = p.seller_id === user.id;
      const admin = user.role === 'super_admin';
      $('screen').innerHTML = `
        <button class="back" onclick="App.go('shop')">← Back to Bazar</button>
        <div class="panel">
          <div class="shop-detail-img">${p.image ? `<img src="${esc(p.image)}" alt=""/>` : icon(SHOP_ICON[p.category] || 'package')}</div>
          <h2 style="margin-bottom:2px">${esc(p.title)}</h2>
          <div class="shop-price" style="font-size:1.3rem">Rs ${money(p.price)} <span class="muted">/ ${esc(p.unit || '')}</span></div>
          <span class="badge">${esc(SHOP_LABEL[p.category] || p.category)}</span>
          ${p.status !== 'available' ? `<span class="badge down">Sold</span>` : ''}
          <dl class="kv" style="margin-top:10px">
            <dt>Available</dt><dd>${p.quantity} ${esc(p.unit || '')}</dd>
            <dt>Location</dt><dd>${esc(p.location || '—')}</dd>
            <dt>Seller</dt><dd><button class="link" onclick="App.openUserProfile(${p.seller_id})">${esc(p.seller_name)} ${icon('chevron-right')}</button></dd>
            ${p.seller_phone ? `<dt>Contact</dt><dd><a href="tel:${esc(p.seller_phone)}">${esc(p.seller_phone)}</a></dd>` : ''}
          </dl>
          ${p.description ? `<p class="muted">${esc(p.description)}</p>` : ''}
        </div>
        ${mine ? `<div class="panel"><p class="muted">This is your listing.</p>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn btn-sm btn-ghost" onclick="App.go('myShop')">Manage my listings</button>
              <button class="btn btn-sm" style="background:var(--danger)" onclick="App.deleteProduct(${p.id}, 'shop')">${icon('trash-2')} Delete this product</button>
            </div></div>`
          : p.status === 'available' ? `<div class="panel"><h3>${icon('shopping-cart')} Order this</h3>
            <div class="form-grid">
              <input id="ord-qty" type="number" min="1" step="any" value="1" placeholder="Quantity (${esc(p.unit || '')})" oninput="App.orderTotal(${p.price})"/>
              <div class="stat" style="display:flex;align-items:center"><span id="ord-total" class="stat-num" style="font-size:1rem">Rs ${money(p.price)}</span></div>
            </div>
            <input id="ord-msg" placeholder="Message to seller (optional)"/>
            <button class="btn btn-sm" onclick="App.placeOrder(${p.id})">${icon('shopping-cart')} Place order</button>
          </div>` : `<div class="panel"><p class="muted">This product has been sold.</p></div>`}
        ${admin && !mine ? `<div class="panel"><h3>${icon('shield')} Admin</h3>
          <p class="muted">Remove this listing from the Bazar (seller: ${esc(p.seller_name)}).</p>
          <button class="btn btn-sm" style="background:var(--danger)" onclick="App.deleteProduct(${p.id}, 'shop')">${icon('trash-2')} Delete this product</button>
        </div>` : ''}`;
    },
    orderTotal(price) { const q = Number(($('ord-qty') || {}).value) || 0; const el = $('ord-total'); if (el) el.textContent = 'Rs ' + money(Math.round(q * price)); },
    async placeOrder(id) {
      const quantity = Number(($('ord-qty') || {}).value) || 1;
      if (!(quantity > 0)) return toast('Enter a quantity');
      const message = ($('ord-msg') || {}).value || '';
      try {
        await api('/products/' + id + '/order', { method: 'POST', body: { quantity, message } });
        toast('Order placed — seller notified');
        go('myPurchases');
      } catch (e) { toast(e.message); }
    },

    /* Sell: create a listing (with optional photo). */
    sellProduct() {
      $('screen').innerHTML = `
        <button class="back" onclick="App.go('shop')">← Back</button>
        <div class="panel"><h2>${icon('plus')} Sell a product</h2>
          <input id="pr-title" placeholder="Product name (e.g. Fresh Tomatoes)"/>
          <select id="pr-cat">${SHOP_CATS.map((c) => `<option value="${c}">${esc(SHOP_LABEL[c])}</option>`).join('')}</select>
          <div class="form-grid">
            <input id="pr-price" type="number" min="0" step="any" placeholder="Price (Rs)"/>
            <select id="pr-unit">${['piece', 'kg', 'gram', 'litre', 'dozen', 'bag', 'quintal'].map((u) => `<option>${u}</option>`).join('')}</select>
            <input id="pr-qty" type="number" min="0" step="any" placeholder="Quantity available" value="1"/>
            <input id="pr-location" placeholder="Location (e.g. Phungling)"/>
          </div>
          <input id="pr-contact" placeholder="Contact phone (optional)"/>
          <textarea id="pr-desc" placeholder="Description (optional)"></textarea>
          <label class="btn btn-sm btn-ghost" style="display:inline-block">${icon('image')} Add photo
            <input id="pr-image" type="file" accept="image/*" class="hidden" onchange="App.previewProductImg(this)"/></label>
          <div id="pr-preview" style="margin-top:8px"></div>
          <button class="btn btn-sm" style="margin-top:10px" onclick="App.submitProduct()">List for sale</button>
        </div>`;
    },
    async previewProductImg(input) {
      const f = input.files && input.files[0];
      if (!f) return;
      ctx.productImg = await compressImage(f, { maxDim: 1280, quality: 0.72 });
      const box = $('pr-preview');
      if (box) box.innerHTML = `<img src="${ctx.productImg}" style="max-width:140px;border-radius:10px"/>`;
    },
    async submitProduct() {
      const title = $('pr-title').value.trim();
      const price = Number($('pr-price').value);
      if (!title) return toast('Enter a product name');
      if (!(price >= 0)) return toast('Enter a valid price');
      const body = {
        title, price, category: $('pr-cat').value, unit: $('pr-unit').value,
        quantity: Number($('pr-qty').value) || 1, location: $('pr-location').value.trim() || undefined,
        contact: $('pr-contact').value.trim() || undefined, description: $('pr-desc').value.trim() || undefined,
        image: ctx.productImg || undefined,
      };
      try { await api('/products', { method: 'POST', body }); ctx.productImg = null; toast('Listed in Bazar'); go('myShop'); }
      catch (e) { toast(e.message); }
    },

    /* MY SHOP — seller dashboard: earnings, orders to fulfill, my listings.
       Each user sees their own sales here, tied to their login. */
    async myShop() {
      const [{ products }, { received, placed }] = await Promise.all([
        api('/products/mine'), api('/products/orders/all'),
      ]);
      const badge = (s) => `<span class="badge ${s === 'rejected' ? 'down' : s === 'completed' || s === 'accepted' ? 'up' : 'stable'}">${esc(s)}</span>`;
      const completed = received.filter((o) => o.status === 'completed');
      const earned = completed.reduce((s, o) => s + o.total, 0);
      const toFulfill = received.filter((o) => o.status === 'pending' || o.status === 'accepted');
      const active = products.filter((p) => p.status === 'available').length;

      $('screen').innerHTML = `
        <button class="back" onclick="App.go('shop')">← Back to Bazar</button>
        <div class="panel"><h2>${icon('store')} My Shop</h2>
          <div class="stat-row">
            <div class="stat"><span class="stat-num">Rs ${money(earned)}</span><span class="stat-lbl">Total earned</span></div>
            <div class="stat"><span class="stat-num">${completed.length}</span><span class="stat-lbl">Items sold</span></div>
            <div class="stat"><span class="stat-num">${active}</span><span class="stat-lbl">Active listings</span></div>
            <div class="stat"><span class="stat-num">${toFulfill.length}</span><span class="stat-lbl">Orders to do</span></div>
          </div>
          <div style="display:flex;gap:8px;margin-top:12px">
            <button class="btn btn-sm" onclick="App.go('sellProduct')">${icon('plus')} Add product</button>
            <button class="btn btn-sm btn-ghost" onclick="App.go('myPurchases')">${icon('shopping-cart')} My purchases${placed.length ? ' (' + placed.length + ')' : ''}</button>
          </div>
        </div>

        <div class="panel"><h3>${icon('package')} Orders to fulfill</h3>
          ${toFulfill.length ? toFulfill.map((o) => `<div class="row">
            <div><strong>${esc(o.title)}</strong> ${badge(o.status)}<br>
              <span class="muted">${o.quantity} ${esc(o.unit || '')} · Rs ${money(o.total)} · ${icon('user-round')} ${esc(o.buyer_name)}${o.buyer_phone ? ' · <a href="tel:' + esc(o.buyer_phone) + '">' + esc(o.buyer_phone) + '</a>' : ''}</span>
              ${o.message ? `<br><span class="muted">"${esc(o.message)}"</span>` : ''}</div>
            ${o.status === 'pending' ? `<div style="display:flex;gap:6px">
              <button class="btn btn-sm" onclick="App.setOrder(${o.id},'accepted')">Accept</button>
              <button class="btn btn-sm btn-ghost" onclick="App.setOrder(${o.id},'rejected')">Reject</button></div>`
              : `<button class="btn btn-sm" onclick="App.setOrder(${o.id},'completed')">Mark done</button>`}
          </div>`).join('') : '<p class="muted">No pending orders right now.</p>'}
        </div>

        <div class="panel"><h3>${icon('store')} My products (${products.length})</h3>
          ${products.length ? products.map((p) => `<div class="row">
            <div style="display:flex;gap:10px;align-items:center;min-width:0">
              <div class="shop-thumb">${p.image ? `<img src="${esc(p.image)}"/>` : icon(SHOP_ICON[p.category] || 'package')}</div>
              <div style="min-width:0"><strong>${esc(p.title)}</strong> ${p.status === 'sold' ? '<span class="badge down">Sold</span>' : ''}<br>
                <span class="muted">Rs ${money(p.price)}/${esc(p.unit || '')} · ${p.quantity} left${p.sold_count ? ' · ' + p.sold_count + ' sold' : ''}</span></div>
            </div>
            <div style="display:flex;gap:6px">
              ${p.status === 'available' ? `<button class="btn btn-sm btn-ghost" onclick="App.markSold(${p.id})">Sold</button>`
                : `<button class="btn btn-sm btn-ghost" onclick="App.relist(${p.id})">Relist</button>`}
              <button class="btn btn-sm" style="background:var(--danger);padding:8px 10px" onclick="App.deleteProduct(${p.id})">${icon('trash-2')}</button>
            </div></div>`).join('') : '<p class="muted">No listings yet. Tap “Add product”.</p>'}
        </div>`;
    },
    async markSold(id) { try { await api('/products/' + id, { method: 'PATCH', body: { status: 'sold' } }); toast('Marked sold'); go('myShop'); } catch (e) { toast(e.message); } },
    async relist(id) { try { await api('/products/' + id, { method: 'PATCH', body: { status: 'available' } }); toast('Relisted'); go('myShop'); } catch (e) { toast(e.message); } },
    async deleteProduct(id, back = 'myShop') {
      if (!(await confirmDialog('Delete this listing?'))) return;
      try { await api('/products/' + id, { method: 'DELETE' }); toast('Deleted'); go(back); } catch (e) { toast(e.message); }
    },
    async setOrder(id, status) { try { await api('/products/orders/' + id, { method: 'PATCH', body: { status } }); toast('Order ' + status); go('myShop'); } catch (e) { toast(e.message); } },

    /* My purchases — what I ordered as a buyer. */
    async myPurchases() {
      const { placed } = await api('/products/orders/all');
      const badge = (s) => `<span class="badge ${s === 'rejected' ? 'down' : s === 'completed' || s === 'accepted' ? 'up' : 'stable'}">${esc(s)}</span>`;
      $('screen').innerHTML = `
        <button class="back" onclick="App.go('myShop')">← Back</button>
        <div class="panel"><h2>${icon('shopping-cart')} My purchases</h2>
          ${placed.length ? placed.map((o) => `<div class="row">
            <div style="display:flex;gap:10px;align-items:center;min-width:0">
              <div class="shop-thumb">${o.image ? `<img src="${esc(o.image)}"/>` : icon('package')}</div>
              <div><strong>${esc(o.title)}</strong> ${badge(o.status)}<br>
                <span class="muted">${o.quantity} ${esc(o.unit || '')} · Rs ${money(o.total)}</span></div>
            </div>
          </div>`).join('') : '<p class="muted">You have not ordered anything yet. Browse the Bazar to buy.</p>'}
        </div>`;
    },

    /* ============ PROFILE ============ */
    /* My profile — view + edit own account (every user has one). */
    async myProfile() {
      const { user: u } = await api('/users/me');
      const back = user.role === 'super_admin' ? 'admin' : user.role === 'expert' ? 'threads' : 'home';
      const langOpt = ['en', 'ne'].map((l) => `<option value="${l}" ${u.language === l ? 'selected' : ''}>${l === 'en' ? 'English' : 'नेपाली'}</option>`).join('');
      // Farmers can set/change which ward (1–11) of Taplejung they belong to.
      const wardBlock = u.role === 'farmer' ? `
          <label class="muted" style="display:block;margin:4px 0 2px">🏘️ Ward (Taplejung Nagarpalika)</label>
          <select id="pf-ward">
            <option value="">Select Ward</option>
            ${Array.from({ length: 11 }, (_, i) => i + 1).map((w) => `<option value="${w}" ${Number(u.ward) === w ? 'selected' : ''}>Ward No. ${w}</option>`).join('')}
          </select>` : '';
      $('screen').innerHTML = `
        <button class="back" onclick="App.go('${back}')">← Back</button>
        <div class="panel" style="text-align:center">
          <div class="avatar-lg" id="pf-av">${u.avatar ? `<img src="${esc(u.avatar)}"/>` : icon('user-round')}</div>
          <label class="link" style="display:inline-block;margin-top:6px">Change photo
            <input type="file" accept="image/*" class="hidden" onchange="App.previewAvatar(this)"/></label>
          <h2 style="margin:6px 0 0">${esc(u.name)}</h2>
          <span class="badge">${esc(labelRole(u.role))}</span>
          <p class="muted">Member since ${(u.created_at || '').slice(0, 10)}</p>
          <button class="btn btn-sm btn-ghost" onclick="App.openUserProfile(${u.id})">${icon('eye')} View public profile</button>
        </div>
        <div class="panel"><h3>${icon('user-round-cog')} Edit profile</h3>
          <input id="pf-name" placeholder="Full name" value="${esc(u.name || '')}"/>
          <textarea id="pf-bio" placeholder="About you — what you do / sell">${esc(u.bio || '')}</textarea>
          <input id="pf-address" placeholder="Address (village, municipality)" value="${esc(u.address || '')}"/>
          ${wardBlock}
          <input id="pf-phone" placeholder="Phone" value="${esc(u.phone || '')}"/>
          <input id="pf-email" placeholder="Email (optional)" value="${esc(u.email || '')}"/>
          <select id="pf-lang">${langOpt}</select>
          <label class="check-lbl" style="margin:8px 0">
            <input type="checkbox" id="pf-showcontact" ${u.show_contact ? 'checked' : ''}/>
            ${icon('phone')} Show my phone number on my public profile</label>
          <p class="muted" style="margin:0 0 10px">Your email and password are always private.</p>
          <button class="btn btn-sm" onclick="App.saveProfile()">Save changes</button>
        </div>
        <div class="panel"><h3>${icon('lock')} Change password</h3>
          <div class="pw-wrap">
            <input id="pf-pass" type="password" placeholder="New password"/>
            <button type="button" class="pw-eye" aria-label="Show password" onclick="App.togglePw('pf-pass', this)">${icon('eye')}</button>
          </div>
          <button class="btn btn-sm btn-ghost" onclick="App.changePassword()">Update password</button>
        </div>`;
    },
    async previewAvatar(input) {
      const f = input.files && input.files[0];
      if (!f) return;
      ctx.avatarImg = await compressImage(f, { maxDim: 512, quality: 0.75 });
      const box = $('pf-av'); if (box) box.innerHTML = `<img src="${ctx.avatarImg}"/>`;
    },
    async saveProfile() {
      const body = {
        name: $('pf-name').value.trim(), bio: $('pf-bio').value.trim(),
        address: $('pf-address').value.trim(), phone: $('pf-phone').value.trim(),
        email: $('pf-email').value.trim() || null, language: $('pf-lang').value,
        show_contact: $('pf-showcontact').checked ? 1 : 0,
      };
      const wardEl = $('pf-ward');
      if (wardEl) body.ward = wardEl.value ? Number(wardEl.value) : null;
      if (ctx.avatarImg) body.avatar = ctx.avatarImg;
      if (!body.name) return toast('Name cannot be empty');
      try {
        const { user: updated } = await api('/users/' + user.id, { method: 'PATCH', body });
        user = { ...user, name: updated.name, language: body.language }; // keep session/topbar in sync
        localStorage.setItem('ks_user', JSON.stringify(user));
        $('user-tag').textContent = `${user.name} · ${labelRole(user.role)}`;
        if (window.I18N) window.I18N.setLang(body.language === 'ne' ? 'ne' : 'en'); // apply chosen language now
        ctx.avatarImg = null;
        toast('Profile updated');
      } catch (e) { toast(e.message); }
    },
    async changePassword() {
      const pass = $('pf-pass').value;
      if (!pass || pass.length < 4) return toast('Password must be at least 4 characters');
      try { await api('/users/' + user.id, { method: 'PATCH', body: { password: pass } }); $('pf-pass').value = ''; toast('Password updated'); }
      catch (e) { toast(e.message); }
    },

    /* Public profile of any user: who they are + what they sell. */
    async userProfile() {
      const id = ctx.profileId;
      if (!id) return go('home');
      const { user: u, products, stats } = await api('/users/' + id + '/profile');
      const available = products.filter((p) => p.status === 'available');
      $('screen').innerHTML = `
        <button class="back" onclick="App.go(ctx._backScreen || 'shop')">← Back</button>
        <div class="panel" style="text-align:center">
          <div class="avatar-lg">${u.avatar ? `<img src="${esc(u.avatar)}"/>` : icon('user-round')}</div>
          <h2 style="margin:8px 0 2px">${esc(u.name)}</h2>
          <span class="badge">${esc(labelRole(u.role))}</span>
          ${u.expert && u.expert.verified ? `<span class="badge up">${icon('badge-check')} Verified</span>` : ''}
          ${u.bio ? `<p class="muted" style="margin-top:8px">${esc(u.bio)}</p>` : ''}
          <dl class="kv" style="margin-top:8px;text-align:left">
            ${u.address ? `<dt>Address</dt><dd>${esc(u.address)}</dd>` : ''}
            ${u.phone ? `<dt>Contact</dt><dd><a href="tel:${esc(u.phone)}">${esc(u.phone)}</a></dd>` : ''}
            ${u.expert && u.expert.specialization ? `<dt>Specialization</dt><dd>${esc(u.expert.specialization)}</dd>` : ''}
            <dt>Member since</dt><dd>${(u.created_at || '').slice(0, 10)}</dd>
          </dl>
          <div class="stat-row" style="margin-top:10px">
            <div class="stat"><span class="stat-num">${stats.listings}</span><span class="stat-lbl">For sale</span></div>
            <div class="stat"><span class="stat-num">${stats.sold}</span><span class="stat-lbl">Items sold</span></div>
          </div>
        </div>
        <div class="panel"><h3>${icon('store')} What ${esc(u.name.split(' ')[0])} sells</h3>
          ${available.length ? `<div class="shop-grid">
            ${available.map((p) => `<button class="shop-card" onclick="App.openProduct(${p.id})">
              <div class="shop-img">${p.image ? `<img src="${esc(p.image)}"/>` : icon(SHOP_ICON[p.category] || 'package')}</div>
              <div class="shop-body"><div class="shop-title">${esc(p.title)}</div>
                <div class="shop-price">Rs ${money(p.price)}<span class="muted">/${esc(p.unit || '')}</span></div></div>
            </button>`).join('')}
          </div>` : '<p class="muted">No products listed right now.</p>'}
        </div>`;
    },
    openUserProfile(id) { go('userProfile', { profileId: id, _backScreen: ctx._screen }); },

    /* Disease detection */
    async disease() {
      const { crops } = user.role === 'farmer' ? await api('/crops') : { crops: [] };
      $('screen').innerHTML = `<button class="back" onclick="App.go('home')">← Back</button>
        <div class="panel"><h2>${icon('stethoscope')} AI Disease Detection</h2>
          <p class="muted">Upload a photo and/or describe the symptom. (Demo model.)</p>
          <input id="d-img" type="file" accept="image/*" />
          ${crops.length ? `<label>Crop</label><select id="d-crop"><option value="">— select —</option>${crops.map((c) => `<option value="${c.crop_id}">${esc(c.name)} (${esc(c.farm_id)})</option>`).join('')}</select>` : ''}
          <input id="d-symptom" placeholder="Describe symptom e.g. yellow leaves" />
          <button class="btn" onclick="App.detect()">Detect</button>
          <div id="d-out"></div>
        </div>`;
    },
    async detect() {
      const file = $('d-img').files[0];
      const image = file ? await compressImage(file, { maxDim: 1280, quality: 0.8 }) : undefined;
      const crop_id = $('d-crop') ? ($('d-crop').value || undefined) : undefined;
      try {
        const { detection: d } = await api('/disease/detect', { method: 'POST', body: { image, crop_id, symptom: $('d-symptom').value } });
        $('d-out').innerHTML = `<div class="panel" style="background:var(--green-light);margin-top:12px">
          <h3>${esc(d.disease_name)} <span class="badge">${Math.round(d.confidence * 100)}%</span></h3>
          <dl class="kv">
            <dt>Symptoms</dt><dd>${esc(d.symptoms)}</dd><dt>Cause</dt><dd>${esc(d.cause)}</dd>
            <dt>Treatment</dt><dd>${esc(d.treatment)}</dd><dt>Fertilizer</dt><dd>${esc(d.fertilizer)}</dd>
            <dt>Prevention</dt><dd>${esc(d.prevention)}</dd></dl></div>`;
      } catch (e) { toast(e.message); }
    },

    /* Farmer: pick an expert (directory + existing conversations) */
    async chat() {
      const [{ experts }, { threads }] = await Promise.all([
        api('/experts'),       // verified experts only
        api('/chat/threads'),  // farmer's existing conversations
      ]);
      const convo = Object.fromEntries(threads.map((t) => [t.expert_id, t]));
      $('screen').innerHTML = `
        <div class="panel"><h2>${icon('user-round')} Contact an Expert</h2>
          <p class="muted">Choose an expert to start a private chat.</p>
          ${experts.length ? experts.map((e) => {
            const c = convo[e.id];
            return `<div class="row"><div>
                <strong>${esc(e.name)}</strong> ${e.available ? '' : '<span class="badge stable">busy</span>'}
                <br><span class="muted">${esc(e.specialization || 'General Agriculture')}${c ? ` · ${c.message_count} messages` : ''}</span>
              </div>
              <button class="btn btn-sm btn-ghost" onclick="App.openExpertChat(${e.id},'${esc(e.name)}')">${c ? 'Open chat' : 'Message'}</button>
            </div>`;
          }).join('') : '<p class="muted">No verified experts available yet. Please check back soon.</p>'}
        </div>`;
    },
    /* Farmer: 1-to-1 thread with a chosen expert */
    async expertChat() {
      const { messages } = await api('/chat/messages?expertId=' + ctx.expertId);
      renderChat(messages, { title: ctx.expertName || 'Expert', back: 'chat' });
    },

    /* Expert: list of farmers who messaged THIS expert */
    async threads() {
      const { user: me } = await api('/auth/me');
      const verified = me.expert && me.expert.verified;
      const banner = verified ? '' : `<div class="panel" style="border:2px solid var(--amber);background:#fff8e1">
        <strong>⏳ Awaiting admin verification</strong>
        <p class="muted" style="margin:6px 0 0">Upload your proof document in the <strong>Profile</strong> tab. You can read questions now, but can only reply once an admin reviews your proof and verifies you.</p></div>`;
      const { threads } = await api('/chat/threads');
      $('screen').innerHTML = banner + `<div class="panel"><h2>${icon('message-circle')} Farmer Questions</h2>
        ${threads.map((t) => `<div class="row"><div><strong>${esc(t.farmer_name)}</strong><br><span class="muted">${t.message_count} msg · ${esc(t.last_at)}</span></div>
          <button class="btn btn-sm btn-ghost" onclick="App.go('thread',{farmerId:${t.farmer_id},farmerName:'${esc(t.farmer_name)}'})">Open</button></div>`).join('') || '<p class="muted">No questions yet.</p>'}
      </div>`;
    },
    async thread() {
      const { messages } = await api('/chat/messages?farmerId=' + ctx.farmerId);
      renderChat(messages, { title: ctx.farmerName || 'Farmer', back: 'threads' });
    },

    /* Expert profile */
    async experts() {
      const { user: me } = await api('/auth/me');
      const e = me.expert || {};
      const status = e.verified
        ? '<span class="badge">✅ Verified by admin</span>'
        : '<span class="badge" style="background:#fff3e0;color:#e65100">⏳ Pending admin verification</span>';
      const proofBlock = e.proof_image
        ? `<p class="muted">Submitted proof document:</p><img src="${e.proof_image}" alt="proof" style="max-width:100%;border-radius:10px;border:1px solid #cdd6cd"/>`
        : (e.verified ? '' : '<p class="muted">⚠️ Upload a proof document (certificate / ID). Admin can only verify you after reviewing it.</p>');
      $('screen').innerHTML = `<div class="panel"><h2>${icon('user-round-cog')} My Expert Profile</h2>
        <p>Status: ${status}</p>
        <input id="e-specialization" placeholder="Specialization" value="${esc(e.specialization || '')}" />
        <textarea id="e-bio" placeholder="Bio">${esc(e.bio || '')}</textarea>
        <label><input type="checkbox" id="e-available" ${e.available ? 'checked' : ''} style="width:auto"> Available for questions</label>
        <div style="margin:10px 0">
          <label class="muted">Proof document (photo of certificate / ID)</label>
          <input id="e-proof" type="file" accept="image/*" />
          ${proofBlock}
        </div>
        <button class="btn" onclick="App.saveExpert()">Save</button></div>`;
    },
    async saveExpert() {
      const body = { specialization: $('e-specialization').value, bio: $('e-bio').value, available: $('e-available').checked };
      const file = $('e-proof') && $('e-proof').files[0];
      if (file) body.proof_image = await compressImage(file, { maxDim: 1600, quality: 0.82 });
      try { await api('/experts/me', { method: 'PATCH', body }); toast('Saved'); go('experts'); }
      catch (e) { toast(e.message); }
    },

    /* Notifications */
    async notifs() {
      const { notifications } = await api('/notifications');
      const admin = user.role === 'super_admin';
      const NICON = { rain: 'cloud-rain', pest: 'bug', fertilizer: 'sprout', harvest: 'wheat', general: 'megaphone' };
      const when = (t) => { if (!t) return ''; const d = new Date(t.replace(' ', 'T') + 'Z'); return isNaN(d) ? esc(t) : d.toLocaleString('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
      $('screen').innerHTML = `<div class="panel"><h2>${icon('bell')} Notifications</h2>
        ${notifications.map((n) => `<div class="row notif-row ${n.user_id && !n.is_read ? 'notif-unread' : ''}" style="cursor:pointer"
            onclick='App.openNotif(${JSON.stringify(n).replace(/'/g, "&#39;")})'>
          <div class="notif-ic">${icon(NICON[n.type] || 'bell')}</div>
          <div style="flex:1;min-width:0"><strong>${esc(n.title)}</strong><br><span class="muted">${esc(n.message || '')}</span>
            <div class="muted" style="font-size:.7rem;margin-top:2px">${when(n.created_at)}</div></div>
          ${icon('chevron-right')}
        </div>`).join('') || '<p class="muted">No alerts yet.</p>'}
        </div>
        ${admin ? `<div class="panel"><h3>Broadcast alert</h3>
          <select id="n-type"><option>general</option><option>rain</option><option>pest</option><option>fertilizer</option><option>harvest</option></select>
          <input id="n-title" placeholder="Title"/><textarea id="n-message" placeholder="Message"></textarea>
          <button class="btn btn-sm" onclick="App.broadcast()">Send to all</button></div>` : ''}`;
      // Opening the alerts screen marks personal notifications as read.
      try { await api('/notifications/read-all', { method: 'POST' }); updateNotifBadge(); } catch { /* ignore */ }
    },
    async broadcast() {
      const b = readForm(['type', 'title', 'message']);
      try { await api('/notifications', { method: 'POST', body: b }); toast('Sent'); go('notifs'); } catch (e) { toast(e.message); }
    },
    // Tap a notification: jump to the related screen, else show full details.
    openNotif(n) {
      const linkable = ['myShop', 'myPurchases', 'threads', 'chat', 'shop', 'crops', 'sales', 'expenses', 'market', 'weather', 'news'];
      if (n && n.link && linkable.includes(n.link) && screens[n.link]) { go(n.link); return; }
      infoDialog(n.title, (n.message || '') + (n.created_at ? '\n\n' + n.created_at : ''));
    },

    /* Admin dashboard */
    async admin() {
      // reset drill-down context so top-level cards start fresh
      ctx.farmerId = null; ctx.farmerName = null; ctx.farmId = null;
      const [s, ob, subSum] = await Promise.all([api('/analytics/summary'), api('/analytics/outbreaks'), api('/subsidies/summary')]);
      const t = s.totals;
      const outbreaks = ob.outbreaks || [];
      const pendingSubs = subSum.pending || 0;
      $('screen').innerHTML = `
        ${outbreaks.length ? `<button class="panel" style="width:100%;text-align:left;cursor:pointer;border:2px solid #c62828;background:rgba(198,40,40,.08)" onclick="App.go('adminOutbreaks')">
          <strong style="color:#c62828">${icon('triangle-alert')} ${outbreaks.length} disease outbreak${outbreaks.length > 1 ? 's' : ''} detected</strong>
          <div class="muted" style="font-size:.78rem">Tap to see which wards need an agri-technician.</div>
        </button>` : ''}
        <div class="panel"><h2>${icon('layout-dashboard')} Super Admin Dashboard</h2>
        <p class="muted">Tap any card to drill in.</p>
        <div class="cards">
          ${statCard(icon('user-round'), t.farmers, 'Farmers', 'adminFarmers')}${statCard(icon('user-round-cog'), t.experts, 'Experts', 'manageExperts')}
          ${statCard(icon('house'), t.farms, 'Farms', 'adminFarms')}${statCard(icon('sprout'), t.crops, 'Crops', 'adminCrops')}
          ${statCard(icon('stethoscope'), t.disease_reports, 'Disease Reports', 'adminDiseases')}
        </div>
        <button class="btn" style="width:100%;margin-top:10px;background:#00695c;color:#fff" onclick="App.go('adminWards')">${icon('map')} Open Ward Overview</button>
        <button class="btn" style="width:100%;margin-top:8px;background:#c62828;color:#fff" onclick="App.go('adminOutbreaks')">${icon('triangle-alert')} Disease Outbreak Alerts</button>
        <button class="btn" style="width:100%;margin-top:8px;background:#6a1b9a;color:#fff" onclick="App.go('adminSubsidies',{subStatus:'pending'})">${icon('hand-coins')} Subsidy Applications${pendingSubs ? ' (' + pendingSubs + ' pending)' : ''}</button>
        <button class="btn" style="width:100%;margin-top:8px;background:#00838f;color:#fff" onclick="App.go('adminProducts',{apCat:null,apQ:'',apStatus:''})">${icon('store')} Manage Bazar Products</button>
        <button class="btn" style="width:100%;margin-top:8px;background:#37474f;color:#fff" onclick="App.go('adminBeneficiaries',{benWard:'',benStatus:'',benQ:'',benEdit:null})">${icon('clipboard-list')} Nagarpalika Records</button>
        <button class="btn" style="width:100%;margin-top:8px;background:#5d4037;color:#fff" onclick="App.go('feed')">${icon('users')} Community Feed (monitor)</button>
        </div>
        <div class="panel"><h3>Crops by Category</h3>${s.crops_by_category.map((r) => `<div class="row"><span>${esc(r.category)}</span><strong>${r.count}</strong></div>`).join('') || '<p class="muted">—</p>'}</div>
        <div class="panel"><h3>Crop Health</h3>${s.crop_health.map((r) => `<div class="row"><span>${esc(r.growth_status)}</span><strong>${r.count}</strong></div>`).join('') || '<p class="muted">—</p>'}</div>
        <div class="panel"><h3>Top Disease Reports</h3>${s.recent_diseases.map((r) => `<div class="row"><span>${esc(r.disease_name)}</span><strong>${r.count}</strong></div>`).join('') || '<p class="muted">None</p>'}</div>`;
    },

    /* Drill-down: all farmers (optionally filtered by ward) */
    async adminFarmers() {
      const ward = ctx.farmerWard || '';
      const { users } = await api('/users?role=farmer' + (ward ? '&ward=' + ward : ''));
      const wardOpts = ['<option value="">All wards</option>']
        .concat(Array.from({ length: 11 }, (_, i) => i + 1).map((w) => `<option value="${w}" ${String(ward) === String(w) ? 'selected' : ''}>Ward No. ${w}</option>`))
        .join('');
      $('screen').innerHTML = `<button class="back" onclick="App.go('admin')">← Dashboard</button>
        <div class="panel"><h2>${icon('user-round')} Farmers (${users.length})</h2>
          <label class="muted" style="display:block;margin-bottom:4px">🏘️ Filter by ward</label>
          <select id="farmer-ward" onchange="App.filterFarmersByWard(this.value)">${wardOpts}</select>
          <div style="margin-top:10px">
          ${users.map((u) => `<div class="row"><div><strong>${esc(u.name)}</strong>
            ${u.ward ? `<span class="badge">Ward ${u.ward}</span>` : '<span class="badge stable">No ward</span>'}
            ${u.active ? '' : '<span class="badge stable">disabled</span>'}<br>
            <span class="muted">${esc(u.phone || u.email || '')}</span></div>
            <button class="btn btn-sm btn-ghost" onclick="App.go('adminFarms',{farmerId:${u.id},farmerName:'${esc(u.name)}'})">View farms</button></div>`).join('') || '<p class="muted">No farmers in this ward.</p>'}
          </div>
        </div>`;
    },
    filterFarmersByWard(w) { ctx.farmerWard = w || null; screens.adminFarmers(); },

    /* Disease outbreak early-warning: wards with 2+ farmers on the same disease. */
    async adminOutbreaks() {
      const { outbreaks } = await api('/analytics/outbreaks');
      $('screen').innerHTML = `<button class="back" onclick="App.go('admin')">← Dashboard</button>
        <div class="panel"><h2>${icon('triangle-alert')} Disease Outbreak Alerts</h2>
          <p class="muted">Wards where 2 or more farmers reported the same disease in the last 30 days. Send a JT/JTA to inspect.</p>
        </div>
        ${outbreaks.length ? outbreaks.map((o) => `
          <div class="panel" style="border-left:4px solid #c62828;margin-bottom:8px">
            <div class="section-head"><h3 style="margin:0;color:#c62828">${icon('map-pin')} Ward No. ${o.ward}</h3><span class="badge">${o.farmers} farmers</span></div>
            <div><strong>${esc(o.disease)}</strong></div>
            <div class="muted" style="font-size:.78rem">${o.reports} reports · last report: ${esc((o.last_at || '').slice(0, 10))}</div>
            <button class="btn btn-sm btn-ghost" style="margin-top:6px" onclick="App.go('adminFarmers',{farmerWard:${o.ward}})">View ward farmers</button>
          </div>`).join('') : `<div class="panel"><p class="muted">✅ No outbreaks detected — all clear.</p></div>`}`;
    },

    /* Ward-wise control room: per-ward farmers/farms/crops/sales for Taplejung. */
    async adminWards() {
      const { wards } = await api('/analytics/wards');
      const maxF = Math.max(1, ...wards.map((w) => w.farmers));
      const totalFarmers = wards.reduce((s, w) => s + w.farmers, 0);
      $('screen').innerHTML = `<button class="back" onclick="App.go('admin')">← Dashboard</button>
        <div class="panel"><h2>${icon('map')} Ward Overview — Taplejung</h2>
          <p class="muted">Farmers, farms, crops and sales for each ward. Tap a ward to see its farmers.</p>
          <div class="row"><span>Registered farmers with a ward</span><strong>${totalFarmers}</strong></div>
        </div>
        ${wards.map((w) => `
          <button class="panel" style="display:block;width:100%;text-align:left;cursor:pointer;margin-bottom:8px;border:none" onclick="App.go('adminFarmers',{farmerWard:${w.ward}})">
            <div class="section-head"><h3 style="margin:0">${icon('map-pin')} Ward No. ${w.ward}</h3><span class="muted">Rs ${money(w.sales)} sales</span></div>
            <div class="muted" style="font-size:.78rem;margin:2px 0 6px">👨‍🌾 ${w.farmers} farmers · 🏠 ${w.farms} farms · 🌱 ${w.crops} crops</div>
            <div style="height:8px;background:rgba(0,0,0,.12);border-radius:5px;overflow:hidden">
              <div style="height:100%;width:${Math.round((w.farmers / maxF) * 100)}%;background:#2e7d32"></div>
            </div>
            ${Object.keys(w.categories).length ? `<div class="muted" style="font-size:.72rem;margin-top:6px">${Object.entries(w.categories).map(([c, n]) => `${catEmoji(c)} ${n}`).join(' · ')}</div>` : ''}
          </button>`).join('')}`;
    },

    /* Drill-down: farms (all, or for one farmer) */
    async adminFarms() {
      const [{ farms }, { users }] = await Promise.all([
        api('/farms' + (ctx.farmerId ? '?farmerId=' + ctx.farmerId : '')),
        api('/users'),
      ]);
      const nameById = Object.fromEntries(users.map((u) => [u.id, u.name]));
      const back = ctx.farmerId ? 'adminFarmers' : 'admin';
      const title = ctx.farmerName ? `Farms of ${esc(ctx.farmerName)}` : 'All Farms';
      $('screen').innerHTML = `<button class="back" onclick="App.go('${back}')">← Back</button>
        <div class="panel"><h2>${icon('house')} ${title} (${farms.length})</h2>
          ${farms.map((f) => `<div class="row"><div><strong>${esc(f.farm_id)}</strong> — ${esc(f.name)}<br>
            <span class="muted">👤 ${esc(nameById[f.farmer_id] || ('#' + f.farmer_id))} · ${esc(f.location || 'no location')} · ${f.crop_count} crop(s)</span></div>
            <button class="btn btn-sm btn-ghost" onclick="App.go('adminCrops',{farmId:'${esc(f.farm_id)}',farmName:'${esc(f.name)}'})">View crops</button></div>`).join('') || '<p class="muted">No farms.</p>'}
        </div>`;
    },

    /* Drill-down: crops (all, or for one farm) */
    async adminCrops() {
      const { crops } = await api('/crops' + (ctx.farmId ? '?farmId=' + ctx.farmId : ''));
      const back = ctx.farmId ? 'adminFarms' : 'admin';
      const title = ctx.farmName ? `Crops on ${esc(ctx.farmName)}` : 'All Crops';
      $('screen').innerHTML = `<button class="back" onclick="App.go('${back}')">← Back</button>
        <div class="panel"><h2>${icon('sprout')} ${title} (${crops.length})</h2></div>
        ${crops.map((c) => cropCard(c)).join('') || '<p class="muted">No crops.</p>'}`;
    },

    /* Drill-down: disease reports */
    async adminDiseases() {
      const { detections } = await api('/disease/history');
      $('screen').innerHTML = `<button class="back" onclick="App.go('admin')">← Dashboard</button>
        <div class="panel"><h2>${icon('stethoscope')} Disease Reports (${detections.length})</h2>
          ${detections.map((d) => `<div class="row"><div><strong>${esc(d.disease_name)}</strong>
            <span class="badge">${Math.round((d.confidence || 0) * 100)}%</span><br>
            <span class="muted">${esc((d.treatment || '').slice(0, 90))}</span><br>
            <span class="muted" style="font-size:.7rem">${esc(d.created_at)}</span></div></div>`).join('') || '<p class="muted">No reports.</p>'}
        </div>`;
    },

    /* Admin: manage every Bazar product — search, filter, delete, mark sold/available. */
    async adminProducts() {
      const cat = ctx.apCat || '';
      const q = ctx.apQ || '';
      const st = ctx.apStatus || '';
      const params = new URLSearchParams();
      if (cat) params.set('category', cat);
      if (q) params.set('q', q);
      if (st) params.set('status', st);
      const { products, categories, totals } = await api('/products/admin/all?' + params.toString());
      ctx.apSel = ctx.apSel || {};
      ctx.apShownIds = products.map((p) => p.id);
      const sel = ctx.apSel;
      const selCount = products.filter((p) => sel[p.id]).length;
      const allChecked = products.length > 0 && selCount === products.length;
      $('screen').innerHTML = `
        <button class="back" onclick="App.go('admin')">← Dashboard</button>
        <div class="panel">
          <div class="section-head"><h2>${icon('store')} Manage Bazar Products</h2></div>
          <p class="muted">Every listing from all sellers. As admin you can remove any product or change its status.</p>
          <div class="stat-row">
            <div class="stat"><span class="stat-num">${totals.total}</span><span class="stat-lbl">Total</span></div>
            <div class="stat"><span class="stat-num">${totals.available}</span><span class="stat-lbl">Available</span></div>
            <div class="stat"><span class="stat-num">${totals.sold}</span><span class="stat-lbl">Sold</span></div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;margin-top:10px">
            <input id="ap-q" placeholder="Search product, location…" value="${esc(q)}" style="margin:0"
              onkeydown="if(event.key==='Enter')App.apSearch()"/>
            <button class="btn btn-sm" onclick="App.apSearch()">${icon('search')}</button>
          </div>
          <div class="chips-row" style="margin-top:8px">
            <button class="chip ${!st ? 'chip-on' : ''}" onclick="App.apFilterStatus('')">All</button>
            <button class="chip ${st === 'available' ? 'chip-on' : ''}" onclick="App.apFilterStatus('available')">Available</button>
            <button class="chip ${st === 'sold' ? 'chip-on' : ''}" onclick="App.apFilterStatus('sold')">Sold</button>
          </div>
          <div class="chips-row" style="margin-top:8px">
            <button class="chip ${!cat ? 'chip-on' : ''}" onclick="App.apFilterCat('')">All types</button>
            ${(categories || SHOP_CATS).map((c) => `<button class="chip ${cat === c ? 'chip-on' : ''}" onclick="App.apFilterCat('${c}')">${icon(SHOP_ICON[c] || 'package')} ${esc(SHOP_LABEL[c] || c)}</button>`).join('')}
          </div>
        </div>
        ${products.length ? `<div class="toolbar" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 8px">
          <label style="display:flex;gap:6px;align-items:center;cursor:pointer">
            <input type="checkbox" style="width:auto" ${allChecked ? 'checked' : ''} onclick="App.apSelectAll(this.checked)"/>Select all</label>
          <span class="muted">${selCount} selected</span>
          ${selCount ? `<button class="btn btn-sm" style="width:auto;background:var(--danger)" onclick="App.apDeleteSelected()">${icon('trash-2')} Delete selected (${selCount})</button>
          <button class="btn btn-sm btn-ghost" onclick="App.apClearSel()">Clear</button>` : ''}
        </div>` : ''}
        <p class="muted" style="margin:0 0 8px">${products.length} product${products.length === 1 ? '' : 's'}</p>
        <div class="panel">
        ${products.length ? products.map((p) => `<div class="row">
          <div style="display:flex;gap:10px;align-items:center;min-width:0">
            <input type="checkbox" style="width:auto;flex-shrink:0" ${sel[p.id] ? 'checked' : ''} onclick="App.apToggle(${p.id})"/>
            <div style="display:flex;gap:10px;align-items:center;min-width:0;cursor:pointer" onclick="App.openProduct(${p.id})">
              <div class="shop-thumb">${p.image ? `<img src="${esc(p.image)}"/>` : icon(SHOP_ICON[p.category] || 'package')}</div>
              <div style="min-width:0">
                <strong>${esc(p.title)}</strong> ${p.status === 'sold' ? '<span class="badge down">Sold</span>' : '<span class="badge up">Available</span>'}<br>
                <span class="muted">Rs ${money(p.price)}/${esc(p.unit || '')} · ${esc(SHOP_LABEL[p.category] || p.category)}${p.sold_count ? ' · ' + p.sold_count + ' sold' : ''}</span><br>
                <span class="muted" style="font-size:.72rem">${icon('user-round')} ${esc(p.seller_name)} · ${icon('map-pin')} ${esc(p.location || '—')}</span>
              </div>
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            ${p.status === 'available'
              ? `<button class="btn btn-sm btn-ghost" onclick="App.apSetStatus(${p.id},'sold')">Mark sold</button>`
              : `<button class="btn btn-sm btn-ghost" onclick="App.apSetStatus(${p.id},'available')">Relist</button>`}
            <button class="btn btn-sm" style="background:var(--danger);padding:8px 10px" onclick="App.deleteProduct(${p.id}, 'adminProducts')">${icon('trash-2')}</button>
          </div></div>`).join('') : '<p class="muted" style="text-align:center;padding:20px">No products match.</p>'}
        </div>`;
      const qi = $('ap-q'); if (qi) { qi.focus(); qi.setSelectionRange(qi.value.length, qi.value.length); }
    },
    apSearch() { ctx.apQ = ($('ap-q') || {}).value || ''; screens.adminProducts(); },
    apFilterCat(c) { ctx.apCat = c || null; screens.adminProducts(); },
    apFilterStatus(s) { ctx.apStatus = s || null; screens.adminProducts(); },
    async apSetStatus(id, status) {
      try { await api('/products/' + id, { method: 'PATCH', body: { status } }); toast(status === 'sold' ? 'Marked sold' : 'Relisted'); go('adminProducts'); }
      catch (e) { toast(e.message); }
    },
    apToggle(id) { ctx.apSel = ctx.apSel || {}; if (ctx.apSel[id]) delete ctx.apSel[id]; else ctx.apSel[id] = true; screens.adminProducts(); },
    apSelectAll(checked) {
      ctx.apSel = ctx.apSel || {};
      (ctx.apShownIds || []).forEach((id) => { if (checked) ctx.apSel[id] = true; else delete ctx.apSel[id]; });
      screens.adminProducts();
    },
    apClearSel() { ctx.apSel = {}; screens.adminProducts(); },
    async apDeleteSelected() {
      const ids = Object.keys(ctx.apSel || {}).filter((k) => ctx.apSel[k]).map(Number);
      if (!ids.length) return;
      if (!(await confirmDialog(`Delete ${ids.length} product(s)? This permanently removes ${ids.length === 1 ? 'this listing' : 'these listings'} from the Bazar.`, { title: 'Delete products' }))) return;
      try {
        for (const id of ids) await api('/products/' + id, { method: 'DELETE' });
        ctx.apSel = {};
        toast(`${ids.length} product(s) deleted`);
        go('adminProducts');
      } catch (e) { toast(e.message); }
    },

    /* Nagarpalika (municipality) subsidy-beneficiary registry: record every person
       who received a subsidy, add/edit rows, import from applications, export to Excel. */
    async adminBeneficiaries() {
      const ward = ctx.benWard || '';
      const status = ctx.benStatus || '';
      const q = ctx.benQ || '';
      const params = new URLSearchParams();
      if (ward) params.set('ward', ward);
      if (status) params.set('status', status);
      if (q) params.set('q', q);
      const { beneficiaries, totals } = await api('/beneficiaries?' + params.toString());
      ctx.benRows = beneficiaries; // kept for CSV export of the current view
      const e = ctx.benEdit || {}; // record being edited, or {} when adding
      const editing = !!(ctx.benEdit && ctx.benEdit.id);
      const wardOpts = ['<option value="">Ward…</option>']
        .concat(Array.from({ length: 11 }, (_, i) => i + 1).map((w) => `<option value="${w}" ${String(e.ward) === String(w) ? 'selected' : ''}>Ward ${w}</option>`)).join('');
      const typeOpts = ['<option value="">Subsidy type…</option>']
        .concat(Object.entries(BEN_TYPES).map(([k, l]) => `<option value="${k}" ${e.subsidy_type === k ? 'selected' : ''}>${l}</option>`)).join('');
      const statusOpts = BEN_STATUS.map((s) => `<option value="${s}" ${(e.status || 'approved') === s ? 'selected' : ''}>${s}</option>`).join('');
      const filterWardOpts = ['<option value="">All wards</option>']
        .concat(Array.from({ length: 11 }, (_, i) => i + 1).map((w) => `<option value="${w}" ${String(ward) === String(w) ? 'selected' : ''}>Ward ${w}</option>`)).join('');

      $('screen').innerHTML = `
        <button class="back" onclick="App.go('admin')">← Dashboard</button>
        <div class="panel">
          <div class="section-head"><h2>${icon('clipboard-list')} Nagarpalika Records</h2></div>
          <p class="muted">Municipality register of subsidy beneficiaries. Add people, edit records, import approved applications, and export to Excel.</p>
          <div class="stat-row">
            <div class="stat"><span class="stat-num">${totals.count}</span><span class="stat-lbl">Records</span></div>
            <div class="stat"><span class="stat-num">Rs ${money(totals.amount)}</span><span class="stat-lbl">Total subsidy</span></div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
            <button class="btn btn-sm btn-ghost" onclick="App.benImport()">${icon('download')} Import from applications</button>
            <button class="btn btn-sm" style="background:#1b5e20" onclick="App.benExport()">${icon('file-spreadsheet')} Export to Excel (CSV)</button>
          </div>
        </div>

        <div class="panel">
          <h3>${editing ? icon('pencil') + ' Edit record' : icon('user-plus') + ' Add a beneficiary'}</h3>
          <input id="ben-name" placeholder="Full name *" value="${esc(e.name || '')}"/>
          <div class="form-grid">
            <input id="ben-age" type="number" min="0" placeholder="Age" value="${e.age != null ? e.age : ''}"/>
            <select id="ben-ward">${wardOpts}</select>
          </div>
          <div class="form-grid">
            <input id="ben-phone" placeholder="Phone" value="${esc(e.phone || '')}"/>
            <input id="ben-address" placeholder="Address / Tole" value="${esc(e.address || '')}"/>
          </div>
          <div class="form-grid">
            <select id="ben-type">${typeOpts}</select>
            <input id="ben-amount" type="number" min="0" step="any" placeholder="Amount (Rs)" value="${e.amount != null ? e.amount : ''}"/>
          </div>
          <div class="form-grid">
            <input id="ben-date" type="date" value="${esc(e.given_date || '')}"/>
            <select id="ben-status">${statusOpts}</select>
          </div>
          <input id="ben-remarks" placeholder="Remarks (optional)" value="${esc(e.remarks || '')}"/>
          <div style="display:flex;gap:8px;margin-top:10px">
            <button class="btn btn-sm" onclick="App.benSave()">${editing ? 'Save changes' : 'Add record'}</button>
            ${editing ? `<button class="btn btn-sm btn-ghost" onclick="App.benCancelEdit()">Cancel</button>` : ''}
          </div>
        </div>

        <div class="panel">
          <div style="display:flex;gap:8px;align-items:center">
            <input id="ben-q" placeholder="Search name, phone, address…" value="${esc(q)}" style="margin:0" onkeydown="if(event.key==='Enter')App.benSearch()"/>
            <button class="btn btn-sm" onclick="App.benSearch()">${icon('search')}</button>
          </div>
          <div class="form-grid" style="margin-top:8px">
            <select id="ben-fward" onchange="App.benFilterWard(this.value)">${filterWardOpts}</select>
            <select id="ben-fstatus" onchange="App.benFilterStatus(this.value)">
              <option value="">All status</option>
              ${BEN_STATUS.map((s) => `<option value="${s}" ${status === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </div>
        </div>

        <p class="muted" style="margin:0 0 8px">${beneficiaries.length} record${beneficiaries.length === 1 ? '' : 's'}</p>
        <div class="panel" style="overflow-x:auto">
          ${beneficiaries.length ? `<table class="data-table">
            <thead><tr>
              <th>Name</th><th>Age</th><th>Ward</th><th>Phone</th><th>Address</th>
              <th>Type</th><th>Amount</th><th>Date</th><th>Status</th><th>Remarks</th><th></th>
            </tr></thead>
            <tbody>
            ${beneficiaries.map((b) => `<tr>
              <td>${esc(b.name)}</td>
              <td>${b.age != null ? b.age : '—'}</td>
              <td>${b.ward != null ? b.ward : '—'}</td>
              <td>${esc(b.phone || '—')}</td>
              <td>${esc(b.address || '—')}</td>
              <td>${esc(BEN_TYPES[b.subsidy_type] || b.subsidy_type || '—')}</td>
              <td>${b.amount != null ? 'Rs ' + money(b.amount) : '—'}</td>
              <td>${esc(b.given_date || '—')}</td>
              <td><span class="badge ${b.status === 'distributed' ? 'up' : b.status === 'pending' ? 'stable' : ''}">${esc(b.status)}</span></td>
              <td>${esc(b.remarks || '—')}</td>
              <td style="white-space:nowrap">
                <button class="btn btn-sm btn-ghost" style="padding:6px 8px" onclick="App.benEditRow(${b.id})">${icon('pencil')}</button>
                <button class="btn btn-sm" style="background:var(--danger);padding:6px 8px" onclick="App.benDelete(${b.id})">${icon('trash-2')}</button>
              </td>
            </tr>`).join('')}
            </tbody>
          </table>` : '<p class="muted" style="text-align:center;padding:20px">No records yet. Add a beneficiary above or import from applications.</p>'}
        </div>`;
    },
    benSearch() { ctx.benQ = ($('ben-q') || {}).value || ''; screens.adminBeneficiaries(); },
    benFilterWard(w) { ctx.benWard = w || ''; screens.adminBeneficiaries(); },
    benFilterStatus(s) { ctx.benStatus = s || ''; screens.adminBeneficiaries(); },
    benEditRow(id) { ctx.benEdit = (ctx.benRows || []).find((r) => r.id === id) || null; screens.adminBeneficiaries(); window.scrollTo(0, 0); },
    benCancelEdit() { ctx.benEdit = null; screens.adminBeneficiaries(); },
    async benSave() {
      const body = {
        name: $('ben-name').value.trim(), age: $('ben-age').value, ward: $('ben-ward').value,
        phone: $('ben-phone').value.trim(), address: $('ben-address').value.trim(),
        subsidy_type: $('ben-type').value, amount: $('ben-amount').value,
        given_date: $('ben-date').value, status: $('ben-status').value, remarks: $('ben-remarks').value.trim(),
      };
      if (!body.name) return toast('Enter a name');
      const editing = !!(ctx.benEdit && ctx.benEdit.id);
      try {
        if (editing) await api('/beneficiaries/' + ctx.benEdit.id, { method: 'PATCH', body });
        else await api('/beneficiaries', { method: 'POST', body });
        ctx.benEdit = null;
        toast(editing ? 'Record updated' : 'Record added');
        go('adminBeneficiaries');
      } catch (err) { toast(err.message); }
    },
    async benDelete(id) {
      if (!(await confirmDialog('Delete this record?'))) return;
      try { await api('/beneficiaries/' + id, { method: 'DELETE' }); toast('Deleted'); go('adminBeneficiaries'); }
      catch (err) { toast(err.message); }
    },
    async benImport() {
      if (!(await confirmDialog('Import all approved & distributed subsidy applications into the register? Already-imported ones are skipped.', { title: 'Import from applications' }))) return;
      try {
        const { imported, skipped } = await api('/beneficiaries/import', { method: 'POST', body: {} });
        toast(`Imported ${imported} · skipped ${skipped} already in list`);
        go('adminBeneficiaries');
      } catch (err) { toast(err.message); }
    },
    benExport() {
      const rows = ctx.benRows || [];
      if (!rows.length) return toast('Nothing to export');
      const headers = ['Name', 'Age', 'Ward', 'Phone', 'Address', 'Subsidy Type', 'Amount (Rs)', 'Date', 'Status', 'Remarks'];
      const cell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
      const lines = [headers.join(',')];
      for (const b of rows) {
        lines.push([
          b.name, b.age, b.ward, b.phone, b.address,
          BEN_TYPES[b.subsidy_type] || b.subsidy_type || '', b.amount, b.given_date, b.status, b.remarks,
        ].map(cell).join(','));
      }
      // Prepend a UTF-8 BOM so Excel renders Nepali/Unicode correctly.
      const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `nagarpalika-beneficiaries-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast(`Exported ${rows.length} record(s)`);
    },

    /* Admin: verify experts */
    async manageExperts() {
      const { experts } = await api('/experts');
      ctx.allExperts = experts;
      ctx.expertSel = ctx.expertSel || {};
      $('screen').innerHTML = `
        <div class="panel"><h2>${icon('user-round-cog')} Verify Experts</h2>
          <p class="muted">Review each expert's proof before approving. Tick experts to delete them, or search below.</p>
          <input id="exp-filter" placeholder="🔍 Search name, specialization or phone"
            oninput="App.filterExperts(this.value)" value="${esc(ctx.expertFilter || '')}"/>
          <div id="exp-list"></div>
        </div>`;
      renderExpertList();
    },

    /* Admin: full expert detail */
    async expertDetail() {
      const [{ experts }, { threads }] = await Promise.all([api('/experts'), api('/chat/threads')]);
      const e = experts.find((x) => x.id === ctx.expertId);
      if (!e) { toast('Expert not found'); return go('manageExperts'); }
      const convos = threads.filter((t) => t.expert_id === e.id);
      const canVerify = e.verified || e.proof_image;
      $('screen').innerHTML = `<button class="back" onclick="App.go('manageExperts')">← All experts</button>
        <div class="panel">
          <h2>${icon('user-round-cog')} ${esc(e.name)}</h2>
          <p>${e.verified ? '<span class="badge">✅ Verified</span>' : '<span class="badge" style="background:#fff3e0;color:#e65100">⏳ Pending</span>'}
             ${e.available ? '<span class="badge">Available</span>' : '<span class="badge stable">Busy</span>'}
             ${e.active ? '' : '<span class="badge" style="background:#ffebee;color:#c62828">Disabled</span>'}</p>
          <dl class="kv">
            <dt>Specialization</dt><dd>${esc(e.specialization || '—')}</dd>
            <dt>Phone</dt><dd>${esc(e.phone || '—')}</dd>
            <dt>Email</dt><dd>${esc(e.email || '—')}</dd>
            <dt>Joined</dt><dd>${esc(e.created_at || '—')}</dd>
            <dt>Conversations</dt><dd>${convos.length}</dd>
          </dl>
          ${e.bio ? `<p class="muted" style="margin:8px 0 2px">Bio</p><p>${esc(e.bio)}</p>` : ''}
          <p class="muted" style="margin:10px 0 4px">Proof document</p>
          ${e.proof_image
            ? `<img src="${e.proof_image}" alt="proof" style="max-width:100%;border-radius:10px;border:1px solid #cdd6cd"/>`
            : '<p class="muted" style="color:var(--danger)">⚠️ No proof document submitted — cannot verify.</p>'}
          <div style="margin-top:14px">
            <button class="btn ${e.verified ? 'btn-ghost' : ''}" ${canVerify ? '' : 'disabled style="opacity:.5"'}
              onclick="App.verifyExpert(${e.id},${e.verified ? 0 : 1})">${e.verified ? 'Revoke verification' : 'Approve expert'}</button>
          </div>
        </div>`;
    },

    /* Admin user management */
    async users() {
      const { users } = await api('/users');
      $('screen').innerHTML = `<div class="panel"><h2>${icon('users')} Users (${users.length})</h2>
        <p class="muted">Tap a user to view their profile and what they sell.</p>
        ${users.map((u) => `<div class="row">
          <div style="flex:1;min-width:0;cursor:pointer" onclick="App.openUserProfile(${u.id})">
            <strong>${esc(u.name)}</strong> <span class="badge">${esc(labelRole(u.role))}</span> ${u.active ? '' : '<span class="badge stable">disabled</span>'}<br>
            <span class="muted">${esc(u.phone || u.email || '')}</span></div>
          <button class="btn btn-sm ${u.active ? 'btn-ghost' : ''}" onclick="event.stopPropagation(); App.toggleUser(${u.id},${u.active ? 0 : 1})">${u.active ? 'Disable' : 'Enable'}</button></div>`).join('')}
      </div>`;
    },
    async toggleUser(id, active) {
      try { await api(`/users/${id}/status`, { method: 'PATCH', body: { active } }); toast('Updated'); go('users'); } catch (e) { toast(e.message); }
    },
    async verifyExpert(id, verified) {
      try {
        await api(`/experts/${id}/verify`, { method: 'PATCH', body: { verified } });
        toast(verified ? 'Expert verified' : 'Verification revoked');
        go('manageExperts');
      } catch (e) { toast(e.message); }
    },
  };

  /* ---------- Shared render bits ---------- */
  // Group digits with commas (e.g. 12500 -> "12,500").
  const money = (n) => Number(n || 0).toLocaleString('en-IN');

  // Relative time like "5m", "3h", "2d"; falls back to a short date for older items.
  const timeAgo = (t) => {
    if (!t) return '';
    const d = new Date(String(t).replace(' ', 'T') + 'Z');
    if (isNaN(d)) return esc(t);
    const s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    if (s < 604800) return Math.floor(s / 86400) + 'd';
    return d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
  };

  // Expense categories + their professional icons / labels.
  const EXP_CATS = ['wages', 'fertilizer', 'seed', 'plants', 'pesticide', 'equipment', 'transport', 'other'];
  const EXP_UNITS = ['kg', 'gram', 'quintal', 'bag', 'litre', 'piece', 'packet', 'dozen'];

  // Marketplace ("Bazar") categories + icons / labels.
  // Nagarpalika subsidy-beneficiary registry: subsidy types + record statuses.
  const BEN_TYPES = {
    seed: 'Seed', fertilizer: 'Fertilizer', equipment: 'Equipment', polyhouse: 'Polyhouse',
    irrigation: 'Irrigation', livestock: 'Livestock', training: 'Training', other: 'Other',
  };
  const BEN_STATUS = ['pending', 'approved', 'distributed'];
  const SHOP_CATS = ['vegetable', 'fruit', 'grain', 'animal', 'dairy', 'handicraft', 'seed', 'tool', 'other'];
  const SHOP_LABEL = {
    vegetable: 'Vegetables', fruit: 'Fruits', grain: 'Grains', animal: 'Animals', dairy: 'Dairy',
    handicraft: 'Handicraft', seed: 'Seeds', tool: 'Tools', other: 'Other',
  };
  const SHOP_ICON = {
    vegetable: 'carrot', fruit: 'apple', grain: 'wheat', animal: 'beef', dairy: 'milk',
    handicraft: 'shirt', seed: 'sprout', tool: 'wrench', other: 'package',
  };
  const EXP_LABEL = {
    wages: 'Workers / Wages', fertilizer: 'Fertilizer', seed: 'Seeds', plants: 'Plants / Saplings',
    pesticide: 'Pesticide', equipment: 'Equipment', transport: 'Transport', other: 'Other',
  };
  const EXP_ICON = {
    wages: 'users', fertilizer: 'flask-conical', seed: 'wheat', plants: 'sprout',
    pesticide: 'spray-can', equipment: 'wrench', transport: 'truck', other: 'circle-dollar-sign',
  };

  // Subsidy / अनुदान types.
  const SUBSIDY_TYPES = ['seed', 'fertilizer', 'equipment', 'polyhouse', 'irrigation', 'livestock', 'training', 'other'];
  const SUB_LABEL = {
    seed: 'Seed', fertilizer: 'Fertilizer', equipment: 'Equipment', polyhouse: 'Polyhouse',
    irrigation: 'Irrigation', livestock: 'Livestock', training: 'Training', other: 'Other',
  };
  const SUB_EMOJI = {
    seed: '🌱', fertilizer: '🧪', equipment: '🛠️', polyhouse: '🏠',
    irrigation: '💧', livestock: '🐄', training: '🎓', other: '📦',
  };
  const SUB_STATUS = {
    pending: ['Pending', '#f9a825'], approved: ['Approved', '#2e7d32'],
    rejected: ['Rejected', '#c62828'], distributed: ['Distributed', '#00695c'],
  };
  function subStatusBadge(s) {
    const [label, color] = SUB_STATUS[s] || [s, '#777'];
    return `<span class="badge" style="background:${color};color:#fff">${label}</span>`;
  }
  function subCard(s, admin) {
    return `<div class="panel" style="margin-bottom:8px">
      <div class="section-head"><h3 style="margin:0">${SUB_EMOJI[s.type] || '📦'} ${esc(s.title)}</h3>${subStatusBadge(s.status)}</div>
      <div class="muted" style="font-size:.78rem">${esc(SUB_LABEL[s.type] || s.type)}${s.amount ? ' · Rs ' + money(s.amount) : ''}${admin ? ' · 👨‍🌾 ' + esc(s.farmer_name || '') + (s.ward ? ' (Ward ' + s.ward + ')' : '') : ''}</div>
      ${s.details ? `<p style="margin:6px 0 0;font-size:.85rem">${esc(s.details)}</p>` : ''}
      ${s.admin_note ? `<p class="muted" style="margin:4px 0 0;font-size:.78rem">📝 ${esc(s.admin_note)}</p>` : ''}
      ${admin && s.status === 'pending' ? `<div class="row" style="gap:6px;margin-top:8px">
        <button class="btn btn-sm" style="background:#2e7d32;color:#fff" onclick="App.decideSubsidy(${s.id},'approved')">Approve</button>
        <button class="btn btn-sm" style="background:#c62828;color:#fff" onclick="App.decideSubsidy(${s.id},'rejected')">Reject</button>
      </div>` : ''}
      ${admin && s.status === 'approved' ? `<button class="btn btn-sm" style="margin-top:8px;background:#00695c;color:#fff" onclick="App.decideSubsidy(${s.id},'distributed')">Mark distributed</button>` : ''}
      ${!admin && s.status === 'pending' ? `<button class="btn btn-sm btn-ghost" style="margin-top:8px" onclick="App.deleteSubsidy(${s.id})">Cancel request</button>` : ''}
    </div>`;
  }
  // A single community-feed post card. `admin` shows a delete on any post;
  // `full` renders the post on its own detail screen (image not clickable-through).
  function feedCard(p, admin, full) {
    const mine = p.user_id === user.id;
    const canDelete = mine || admin;
    const roleBadge = p.author_role === 'super_admin' ? ' <span class="badge">Admin</span>'
      : p.author_role === 'expert' ? ' <span class="badge">Expert</span>' : '';
    const open = full ? '' : `onclick="App.go('post',{postId:${p.id}})" style="cursor:pointer"`;
    return `<div class="panel feed-card" style="margin-bottom:8px">
      <div style="display:flex;gap:10px;align-items:center">
        <div class="feed-avatar">${p.author_avatar ? `<img src="${esc(p.author_avatar)}"/>` : icon('user-round')}</div>
        <div style="min-width:0;flex:1">
          <strong>${esc(p.author_name)}</strong>${roleBadge}<br>
          <span class="muted" style="font-size:.72rem">${p.author_ward ? 'Ward ' + p.author_ward + ' · ' : ''}${timeAgo(p.created_at)}</span>
        </div>
        ${canDelete ? `<button class="btn btn-sm" style="background:var(--danger);padding:6px 8px" onclick="event.stopPropagation();App.deletePost(${p.id})">${icon('trash-2')}</button>` : ''}
      </div>
      <div ${open}>
        ${p.content ? `<p style="margin:8px 0 0;white-space:pre-wrap">${esc(p.content)}</p>` : ''}
        ${p.image ? `<img src="${esc(p.image)}" style="width:100%;border-radius:12px;margin-top:8px"/>` : ''}
      </div>
      <div style="display:flex;gap:14px;align-items:center;margin-top:10px;border-top:1px solid #eef2ee;padding-top:8px">
        <button id="like-${p.id}" class="feed-act ${p.liked ? 'liked' : ''}" onclick="App.toggleLike(${p.id})">${icon('heart')} ${p.like_count}</button>
        <button class="feed-act" onclick="App.go('post',{postId:${p.id}})">${icon('message-circle')} ${p.comment_count}</button>
      </div>
    </div>`;
  }
  // Update the bulk-delete button + select-all box without a full re-render
  // (so a half-filled add-expense form isn't wiped when ticking rows).
  function updateExpSelUI() {
    const ids = (ctx.expShownIds || []).filter((id) => ctx.expSel && ctx.expSel[id]);
    const btn = $('exp-bulk');
    if (btn) { btn.style.display = ids.length ? '' : 'none'; btn.textContent = `Delete selected (${ids.length})`; }
    const all = $('exp-all');
    if (all) all.checked = ids.length > 0 && ids.length === (ctx.expShownIds || []).length;
  }

  // One-line summary of an expense row (workers×wage or qty×cost).
  const expLineDesc = (e) => e.workers != null
    ? `${e.workers} worker(s) × Rs ${money(e.rate)}`
    : e.quantity != null
      ? `${e.quantity} ${esc(e.unit || '')} × Rs ${money(e.rate)}`
      : `Rs ${money(e.amount)}`;

  // Smooth a set of points into a bezier path (Catmull-Rom -> cubic bezier).
  function smoothPath(pts) {
    if (pts.length < 2) return pts.length ? `M ${pts[0].x} ${pts[0].y}` : '';
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x} ${p2.y}`;
    }
    return d;
  }

  /* Smooth area chart for a [{label, amount, month}] series. Each month is a
     clickable point that filters the sales list (App.selectSalesMonth). */
  function areaChart(series, selectedMonth) {
    if (!series || !series.length) return '<p class="muted">No data yet.</p>';
    const W = 320, H = 180, padT = 26, padB = 26, padL = 14, padR = 14;
    const max = Math.max(1, ...series.map((s) => s.amount));
    const n = series.length;
    const xFor = (i) => (n === 1 ? W / 2 : padL + (i * (W - padL - padR)) / (n - 1));
    const yFor = (v) => padT + (1 - v / max) * (H - padT - padB);
    const pts = series.map((s, i) => ({ x: xFor(i), y: yFor(s.amount), s, i }));

    const line = smoothPath(pts);
    const area = `${line} L ${pts[n - 1].x} ${H - padB} L ${pts[0].x} ${H - padB} Z`;

    const dots = pts.map((p) => {
      const active = p.s.month === selectedMonth;
      const tip = (active || p.s.amount > 0) ? `<text x="${p.x}" y="${p.y - 9}" text-anchor="middle"
        font-size="9" font-weight="700" fill="#1b5e20">${money(p.s.amount)}</text>` : '';
      return `
        <g class="chart-pt" onclick="App.selectSalesMonth('${p.s.month}')" style="cursor:pointer">
          <rect x="${p.x - (W / n) / 2}" y="${padT - 10}" width="${W / n}" height="${H - padT - padB + 20}" fill="transparent"/>
          ${tip}
          <circle cx="${p.x}" cy="${p.y}" r="${active ? 6 : 4}" fill="#fff" stroke="var(--green)" stroke-width="${active ? 3 : 2}"/>
          <text x="${p.x}" y="${H - 8}" text-anchor="middle" font-size="10"
            fill="${active ? 'var(--green-dark)' : '#6b7d6b'}" font-weight="${active ? 700 : 400}">${esc(p.s.label)}</text>
        </g>`;
    }).join('');

    return `<svg class="area-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Monthly sales chart">
      <defs>
        <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--green)" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="var(--green)" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      <line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="#e0e6e0" stroke-width="1"/>
      <path d="${area}" fill="url(#salesGrad)"/>
      <path d="${line}" fill="none" stroke="var(--green)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      ${dots}
    </svg>`;
  }

  /* Multi-line smooth area chart. `lines` = [{key, color, id, label}].
     Months are clickable -> calls `clickFn` with the month key. */
  function trendChart(series, lines, selectedMonth, clickFn) {
    if (!series || !series.length) return '<p class="muted">No data yet.</p>';
    const W = 320, H = 180, padT = 24, padB = 26, padL = 14, padR = 14;
    const max = Math.max(1, ...series.flatMap((s) => lines.map((l) => s[l.key] || 0)));
    const n = series.length;
    const xFor = (i) => (n === 1 ? W / 2 : padL + (i * (W - padL - padR)) / (n - 1));
    const yFor = (v) => padT + (1 - v / max) * (H - padT - padB);

    const layers = lines.map((l) => {
      const pts = series.map((s, i) => ({ x: xFor(i), y: yFor(s[l.key] || 0) }));
      const line = smoothPath(pts);
      const area = `${line} L ${pts[n - 1].x} ${H - padB} L ${pts[0].x} ${H - padB} Z`;
      const dots = pts.map((p, i) => {
        const active = series[i].month === selectedMonth;
        return `<circle cx="${p.x}" cy="${p.y}" r="${active ? 5 : 3}" fill="#fff" stroke="${l.color}" stroke-width="2"/>`;
      }).join('');
      return `<path d="${area}" fill="url(#${l.id}Grad)"/>
        <path d="${line}" fill="none" stroke="${l.color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        ${dots}`;
    }).join('');

    const defs = lines.map((l) => `<linearGradient id="${l.id}Grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${l.color}" stop-opacity="0.30"/>
      <stop offset="100%" stop-color="${l.color}" stop-opacity="0.02"/></linearGradient>`).join('');

    const hits = series.map((s, i) => {
      const x = xFor(i), active = s.month === selectedMonth;
      return `<g class="chart-pt" onclick="${clickFn}('${s.month}')" style="cursor:pointer">
        <rect x="${x - (W / n) / 2}" y="${padT - 10}" width="${W / n}" height="${H - padT - padB + 20}" fill="transparent"/>
        <text x="${x}" y="${H - 8}" text-anchor="middle" font-size="10"
          fill="${active ? 'var(--text)' : '#6b7d6b'}" font-weight="${active ? 700 : 400}">${esc(s.label)}</text>
      </g>`;
    }).join('');

    return `<svg class="area-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Income vs expenses chart">
      <defs>${defs}</defs>
      <line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="#e0e6e0" stroke-width="1"/>
      ${layers}
      ${hits}
    </svg>`;
  }

  /* 7-day weather forecast chart: rain-probability bars (blue) behind a smooth
     high-temp curve (orange) and low-temp curve (light blue). days =
     [{label, tmax, tmin, rain}]. */
  function forecastChart(days) {
    if (!days || !days.length) return '<p class="muted">No forecast available.</p>';
    const W = 320, H = 180, padT = 22, padB = 24, padL = 16, padR = 16;
    const temps = days.flatMap((d) => [d.tmax, d.tmin]);
    const lo = Math.min(...temps) - 2, hi = Math.max(...temps) + 2;
    const n = days.length;
    const xFor = (i) => (n === 1 ? W / 2 : padL + (i * (W - padL - padR)) / (n - 1));
    const yTemp = (v) => padT + (1 - (v - lo) / (hi - lo || 1)) * (H - padT - padB);
    const slot = (W - padL - padR) / n;
    const bw = Math.min(20, slot * 0.5);

    const rainBars = days.map((d, i) => {
      const h = (d.rain / 100) * (H - padT - padB);
      const x = xFor(i) - bw / 2;
      return `<rect x="${x}" y="${H - padB - h}" width="${bw}" height="${h}" rx="3" fill="#42a5f5" opacity="0.25"/>
        ${d.rain >= 20 ? `<text x="${xFor(i)}" y="${H - padB - h - 3}" text-anchor="middle" font-size="8" fill="#1565c0">${d.rain}%</text>` : ''}`;
    }).join('');

    const maxPts = days.map((d, i) => ({ x: xFor(i), y: yTemp(d.tmax) }));
    const minPts = days.map((d, i) => ({ x: xFor(i), y: yTemp(d.tmin) }));
    const maxLabels = days.map((d, i) => `<text x="${xFor(i)}" y="${yTemp(d.tmax) - 6}" text-anchor="middle" font-size="9" font-weight="700" fill="#e65100">${d.tmax}°</text>`).join('');
    const dayLabels = days.map((d, i) => `<text x="${xFor(i)}" y="${H - 8}" text-anchor="middle" font-size="9" fill="#6b7d6b">${esc(d.label)}</text>`).join('');

    return `<svg class="area-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="7-day weather forecast">
      <line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="#e0e6e0" stroke-width="1"/>
      ${rainBars}
      <path d="${smoothPath(minPts)}" fill="none" stroke="#42a5f5" stroke-width="2" stroke-linecap="round"/>
      <path d="${smoothPath(maxPts)}" fill="none" stroke="#fb8c00" stroke-width="2.5" stroke-linecap="round"/>
      ${maxPts.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="3" fill="#fff" stroke="#fb8c00" stroke-width="2"/>`).join('')}
      ${minPts.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="2.5" fill="#fff" stroke="#42a5f5" stroke-width="1.5"/>`).join('')}
      ${maxLabels}
      ${dayLabels}
    </svg>`;
  }

  function cropCard(c, editable = true) {
    const updateBtn = editable
      ? `<button class="btn btn-sm btn-amber" onclick='App.go("updateCrop",{crop:${JSON.stringify(c).replace(/'/g, "&#39;")}})'>Update</button>`
      : '';
    return `<div class="panel" style="margin-bottom:10px">
      <div class="section-head"><h3>${catEmoji(c.category)} ${esc(c.name)} <span class="muted">${esc(c.farm_id)}</span></h3>
        ${updateBtn}</div>
      <dl class="kv">
        <dt>Category</dt><dd>${esc(c.category)}</dd>
        <dt>Plant Count</dt><dd>${c.plant_count ?? '—'}</dd>
        <dt>Planted</dt><dd>${esc(c.planted_date || '—')}</dd>
        <dt>Growth Stage</dt><dd>${esc(c.growth_stage || '—')}</dd>
        <dt>Watering</dt><dd>${esc(c.watering_schedule || '—')}</dd>
        <dt>Fertilizer</dt><dd>${esc(c.fertilizer_used || '—')}</dd>
        <dt>Disease History</dt><dd>${esc(c.disease_history || 'None')}</dd>
        <dt>Status</dt><dd><span class="badge">${esc(c.growth_status || '—')}</span></dd>
        <dt>Harvest</dt><dd>${esc(c.harvest_date || '—')}</dd>
      </dl></div>`;
  }
  const catEmoji = (c) => icon({ tree: 'trees', plant: 'sprout', vegetable: 'carrot', animal: 'beef' }[c] || 'leaf');
  const statCard = (ic, n, l, screen) =>
    `<button class="card" ${screen ? `onclick="App.go('${screen}')"` : 'disabled style="cursor:default"'}>
      <span class="icon">${ic}</span><h3>${n}</h3><p>${l}</p></button>`;

  function renderChat(messages, opts) {
    const back = opts.back ? `<button class="back" onclick="App.go('${opts.back}')">← Back</button>` : '';
    $('screen').innerHTML = back + `
      <div class="panel"><h2>${icon('message-circle')} ${esc(opts.title)}</h2>
        <div class="chat-box" id="chat-box">
          ${messages.map((m) => `<div class="msg ${m.sender_role}">${esc(m.text || '🖼️ photo')}<span class="meta">${esc(m.created_at)}</span></div>`).join('') || '<p class="muted">No messages yet. Describe your crop problem below.</p>'}
        </div>
        <div style="display:flex;gap:8px;margin-top:10px">
          <input id="chat-text" placeholder="Type your message..." style="margin:0"/>
          <button class="btn btn-sm" style="width:auto" onclick="App.sendMsg()">Send</button>
        </div></div>`;
    const box = $('chat-box'); if (box) box.scrollTop = box.scrollHeight;
  }
  // Sends within the current conversation. ctx holds expertId (farmer) or farmerId (expert).
  async function sendMsg() {
    const input = $('chat-text');
    const text = input.value.trim(); if (!text) return;
    const body = { text };
    if (user.role === 'farmer') body.expertId = ctx.expertId;
    else body.farmerId = ctx.farmerId;
    try {
      await api('/chat/messages', { method: 'POST', body });
      go(user.role === 'farmer' ? 'expertChat' : 'thread');
    } catch (e) { toast(e.message); }
  }
  function openExpertChat(expertId, expertName) {
    go('expertChat', { expertId, expertName });
  }

  /* ---------- Admin: expert list with search + multi-select delete ---------- */
  function renderExpertList() {
    const box = $('exp-list'); if (!box) return;
    const term = (ctx.expertFilter || '').toLowerCase();
    const all = (ctx.allExperts || []).filter((e) =>
      !term ||
      (e.name || '').toLowerCase().includes(term) ||
      (e.specialization || '').toLowerCase().includes(term) ||
      (e.phone || '').includes(term) ||
      (e.email || '').toLowerCase().includes(term));
    const sel = ctx.expertSel || {};
    const selCount = Object.keys(sel).filter((k) => sel[k]).length;
    const pending = all.filter((e) => !e.verified);
    const verified = all.filter((e) => e.verified);

    const card = (e) => {
      const canVerify = e.verified || e.proof_image;
      const proof = e.proof_image
        ? `<p class="muted" style="margin:8px 0 4px">Proof document:</p>
           <img src="${e.proof_image}" alt="proof" style="max-width:100%;border-radius:10px;border:1px solid #cdd6cd"/>`
        : `<p class="muted" style="color:var(--danger);margin:8px 0">⚠️ No proof document submitted yet — cannot verify.</p>`;
      return `<div style="padding:10px 0;border-bottom:1px solid #eef2ee">
        <div class="row" style="border:none;padding:0">
          <div style="display:flex;gap:10px;align-items:flex-start">
            <input type="checkbox" style="width:auto;margin-top:5px" ${sel[e.id] ? 'checked' : ''} onclick="App.toggleSelectExpert(${e.id})"/>
            <div style="cursor:pointer" onclick="App.go('expertDetail',{expertId:${e.id}})">
              <strong>${esc(e.name)}</strong>
              ${e.verified ? '<span class="badge">✅ Verified</span>' : '<span class="badge" style="background:#fff3e0;color:#e65100">⏳ Pending</span>'}
              <br><span class="muted">${esc(e.specialization || '')} · ${esc(e.phone || e.email || '')}</span>
              <br><span class="link" style="font-size:.78rem">View details ›</span>
            </div>
          </div>
          <button class="btn btn-sm ${e.verified ? 'btn-ghost' : ''}" ${canVerify ? '' : 'disabled style="opacity:.5"'}
            onclick="App.verifyExpert(${e.id},${e.verified ? 0 : 1})">${e.verified ? 'Revoke' : 'Approve'}</button>
        </div>
        ${e.verified ? '' : proof}
      </div>`;
    };

    box.innerHTML = `
      ${selCount ? `<div class="toolbar">
        <button class="btn btn-sm" style="width:auto;background:var(--danger)" onclick="App.deleteSelectedExperts()">🗑 Delete selected (${selCount})</button>
        <button class="btn btn-sm btn-ghost" onclick="App.clearExpertSel()">Clear</button></div>` : ''}
      <h3>Pending (${pending.length})</h3>
      ${pending.map(card).join('') || '<p class="muted">No experts awaiting verification.</p>'}
      <h3 style="margin-top:14px">Verified (${verified.length})</h3>
      ${verified.map(card).join('') || '<p class="muted">None yet.</p>'}`;
  }
  function filterExperts(v) { ctx.expertFilter = v; renderExpertList(); }
  function toggleSelectExpert(id) { ctx.expertSel = ctx.expertSel || {}; ctx.expertSel[id] = !ctx.expertSel[id]; renderExpertList(); }
  function clearExpertSel() { ctx.expertSel = {}; renderExpertList(); }
  async function deleteSelectedExperts() {
    const ids = Object.keys(ctx.expertSel || {}).filter((k) => ctx.expertSel[k]).map(Number);
    if (!ids.length) return;
    if (!(await confirmDialog(`Delete ${ids.length} expert(s)? This removes their account and chats permanently.`, { title: 'Delete experts' }))) return;
    try {
      for (const id of ids) await api('/users/' + id, { method: 'DELETE' });
      ctx.expertSel = {};
      toast(`${ids.length} expert(s) deleted`);
      go('manageExperts');
    } catch (e) { toast(e.message); }
  }

  /* Ask the browser for the device location and remember it. Resolves to
     { lat, lon } or null. `silent` avoids a toast when we just want to try. */
  function requestLocation(silent) {
    return new Promise((resolve) => {
      if (!navigator.geolocation) { if (!silent) toast('Location not supported on this device'); return resolve(null); }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          geo = { lat: +pos.coords.latitude.toFixed(4), lon: +pos.coords.longitude.toFixed(4) };
          localStorage.setItem('ks_geo', JSON.stringify(geo));
          resolve(geo);
        },
        (err) => {
          if (!silent) {
            toast(err.code === err.PERMISSION_DENIED
              ? 'Location blocked — enable it in your browser to get local weather'
              : 'Could not get your location');
          }
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 10 * 60 * 1000 }
      );
    });
  }

  /* ---------- form utils ---------- */
  function formPanel(title, fields, submitFn, back) {
    return `<button class="back" onclick="App.go('${back}')">← Back</button>
      <div class="panel"><h2>${title}</h2>
        ${fields.map(([id, ph, type]) => `<input id="f-${id}" type="${type || 'text'}" placeholder="${ph}"/>`).join('')}
        <button class="btn" onclick="${submitFn}">Save</button></div>`;
  }
  function readForm(ids) {
    const o = {};
    ids.forEach((id) => { const el = $('f-' + id); if (el && el.value !== '') o[id] = el.value; });
    return o;
  }
  /* Market price form (shared by Add + Edit). */
  function marketForm(p, trendOpts) {
    return `<input id="m-crop_name" placeholder="Crop" value="${esc(p.crop_name || '')}"/>
      <input id="m-price" type="number" placeholder="Price" value="${p.price ?? ''}"/>
      <input id="m-market_name" placeholder="Market" value="${esc(p.market_name || '')}"/>
      <input id="m-unit" placeholder="Unit e.g. per kg" value="${esc(p.unit || 'per kg')}"/>
      <select id="m-trend">${trendOpts(p.trend || 'stable')}</select>`;
  }
  function readMarketForm() {
    const o = {};
    ['crop_name', 'price', 'market_name', 'unit', 'trend'].forEach((id) => {
      const el = $('m-' + id); if (el && el.value !== '') o[id] = el.value;
    });
    return o;
  }
  function fileToDataUrl(file) {
    return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
  }

  /* Shrink + compress a photo in the browser BEFORE upload. Farmers often pick a
     10 MB gallery image; this downscales it (longest side -> maxDim) and re-encodes
     as JPEG so it uploads as ~100-300 KB, keeps the page light, and stays under
     Vercel's 4.5 MB request limit. Falls back to the raw file on any error. */
  function compressImage(file, { maxDim = 1280, quality = 0.72 } = {}) {
    return new Promise((resolve) => {
      if (!file || !/^image\//.test(file.type)) return resolve(fileToDataUrl(file));
      const reader = new FileReader();
      reader.onerror = () => resolve(fileToDataUrl(file));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => resolve(reader.result); // couldn't decode -> use original
        img.onload = () => {
          try {
            let { width, height } = img;
            if (Math.max(width, height) > maxDim) {
              const scale = maxDim / Math.max(width, height);
              width = Math.round(width * scale);
              height = Math.round(height * scale);
            }
            const canvas = document.createElement('canvas');
            canvas.width = width; canvas.height = height;
            const g = canvas.getContext('2d');
            g.fillStyle = '#fff'; g.fillRect(0, 0, width, height); // white bg so PNG transparency isn't black
            g.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', quality));
          } catch { resolve(reader.result); }
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /* ---------- init ---------- */
  function init() {
    startIconObserver(); // render <i data-lucide> placeholders into SVG icons
    if (token && user) { boot(); }
    else { $('auth-view').classList.remove('hidden'); }
  }

  // Note: detect/submitFarm/submitCrop/submitUpdate/addPrice/broadcast/saveExpert/
  // toggleUser live on the `screens` object, so expose them via thin wrappers.
  return {
    login, register, onRoleChange, toggleAuth, logout, go, sendMsg, openExpertChat, init, togglePw,
    filterExperts, toggleSelectExpert, clearExpertSel, deleteSelectedExperts,
    detect: (...a) => screens.detect(...a),
    submitFarm: (...a) => screens.submitFarm(...a),
    submitCrop: (...a) => screens.submitCrop(...a),
    submitUpdate: (...a) => screens.submitUpdate(...a),
    addPrice: (...a) => screens.addPrice(...a),
    addSale: (...a) => screens.addSale(...a),
    deleteSale: (...a) => screens.deleteSale(...a),
    submitSubsidy: (...a) => screens.submitSubsidy(...a),
    deleteSubsidy: (...a) => screens.deleteSubsidy(...a),
    setSubStatus: (...a) => screens.setSubStatus(...a),
    decideSubsidy: (...a) => screens.decideSubsidy(...a),
    previewPostImg: (...a) => screens.previewPostImg(...a),
    submitPost: (...a) => screens.submitPost(...a),
    toggleLike: (...a) => screens.toggleLike(...a),
    deletePost: (...a) => screens.deletePost(...a),
    addComment: (...a) => screens.addComment(...a),
    deleteComment: (...a) => screens.deleteComment(...a),
    enableLocation: (...a) => screens.enableLocation(...a),
    openNotif: (...a) => screens.openNotif(...a),
    previewAvatar: (...a) => screens.previewAvatar(...a),
    saveProfile: (...a) => screens.saveProfile(...a),
    changePassword: (...a) => screens.changePassword(...a),
    openUserProfile: (...a) => screens.openUserProfile(...a),
    askAi: (...a) => screens.askAi(...a),
    sendAi: (...a) => screens.sendAi(...a),
    previewAiImg: (...a) => screens.previewAiImg(...a),
    clearAiImg: (...a) => screens.clearAiImg(...a),
    clearAiChat: (...a) => screens.clearAiChat(...a),
    filterFarmersByWard: (...a) => screens.filterFarmersByWard(...a),
    searchShop: (...a) => screens.searchShop(...a),
    filterShop: (...a) => screens.filterShop(...a),
    sortShop: (...a) => screens.sortShop(...a),
    toggleShopFilters: (...a) => screens.toggleShopFilters(...a),
    applyPriceFilter: (...a) => screens.applyPriceFilter(...a),
    clearShopFilters: (...a) => screens.clearShopFilters(...a),
    openProduct: (...a) => screens.openProduct(...a),
    orderTotal: (...a) => screens.orderTotal(...a),
    placeOrder: (...a) => screens.placeOrder(...a),
    previewProductImg: (...a) => screens.previewProductImg(...a),
    submitProduct: (...a) => screens.submitProduct(...a),
    markSold: (...a) => screens.markSold(...a),
    relist: (...a) => screens.relist(...a),
    deleteProduct: (...a) => screens.deleteProduct(...a),
    apSearch: (...a) => screens.apSearch(...a),
    apFilterCat: (...a) => screens.apFilterCat(...a),
    apFilterStatus: (...a) => screens.apFilterStatus(...a),
    apSetStatus: (...a) => screens.apSetStatus(...a),
    apToggle: (...a) => screens.apToggle(...a),
    apSelectAll: (...a) => screens.apSelectAll(...a),
    apClearSel: (...a) => screens.apClearSel(...a),
    apDeleteSelected: (...a) => screens.apDeleteSelected(...a),
    benSearch: (...a) => screens.benSearch(...a),
    benFilterWard: (...a) => screens.benFilterWard(...a),
    benFilterStatus: (...a) => screens.benFilterStatus(...a),
    benEditRow: (...a) => screens.benEditRow(...a),
    benCancelEdit: (...a) => screens.benCancelEdit(...a),
    benSave: (...a) => screens.benSave(...a),
    benDelete: (...a) => screens.benDelete(...a),
    benImport: (...a) => screens.benImport(...a),
    benExport: (...a) => screens.benExport(...a),
    setOrder: (...a) => screens.setOrder(...a),
    selectSalesMonth: (...a) => screens.selectSalesMonth(...a),
    showSale: (...a) => screens.showSale(...a),
    expFormMode: (...a) => screens.expFormMode(...a),
    addExpense: (...a) => screens.addExpense(...a),
    deleteExpense: (...a) => screens.deleteExpense(...a),
    selectExpMonth: (...a) => screens.selectExpMonth(...a),
    showExpense: (...a) => screens.showExpense(...a),
    filterExpCat: (...a) => screens.filterExpCat(...a),
    toggleExpSel: (...a) => screens.toggleExpSel(...a),
    toggleExpSelAll: (...a) => screens.toggleExpSelAll(...a),
    deleteSelectedExp: (...a) => screens.deleteSelectedExp(...a),
    editMarket: (...a) => screens.editMarket(...a),
    cancelEditMarket: (...a) => screens.cancelEditMarket(...a),
    savePrice: (...a) => screens.savePrice(...a),
    deleteMarket: (...a) => screens.deleteMarket(...a),
    broadcast: (...a) => screens.broadcast(...a),
    saveExpert: (...a) => screens.saveExpert(...a),
    toggleUser: (...a) => screens.toggleUser(...a),
    manageExperts: (...a) => screens.manageExperts(...a),
    verifyExpert: (...a) => screens.verifyExpert(...a),
  };
})();

// Expose globally so inline onclick="App.x()" handlers can always resolve it.
window.App = App;

// Surface any uncaught error instead of failing silently.
window.addEventListener('error', (e) => {
  console.error('Uncaught error:', e.error || e.message);
  const authVisible = !document.getElementById('auth-view').classList.contains('hidden');
  const box = document.getElementById(authVisible ? 'login-err' : 'toast');
  if (box) {
    box.textContent = 'Error: ' + (e.message || 'see console (F12)');
    box.classList.add('show');
  }
});

document.addEventListener('DOMContentLoaded', App.init);
