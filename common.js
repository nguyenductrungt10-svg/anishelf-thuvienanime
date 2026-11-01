const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
const ST = { watching: 'Watching', completed: 'Completed', plan: 'Plan to Watch', hold: 'On Hold' };

/* ===== Authentication mô phỏng (Local Storage) ===== */
const Auth = {
    users: () => load('al_users', {}),
    cur: () => { try { return localStorage.getItem('al_session'); } catch (e) { return null; } },
    me: () => Auth.users()[Auth.cur()],
    async hash(s) {
        try {
            const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
            return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
        } catch (e) { return btoa(unescape(encodeURIComponent(s))); }
    },
    async register(name, pass) {
        const k = name.toLowerCase(), us = this.users();
        if (us[k]) throw 'Tên đăng nhập đã tồn tại';
        us[k] = { name, hash: await this.hash(pass), created: Date.now() };
        store('al_users', us); localStorage.setItem('al_session', k);
    },
    async login(name, pass) {
        const u = this.users()[name.toLowerCase()];
        if (!u || u.hash !== await this.hash(pass)) throw 'Sai tên đăng nhập hoặc mật khẩu';
        localStorage.setItem('al_session', name.toLowerCase());
    },
    rename(name) { const us = this.users(); us[this.cur()].name = name; store('al_users', us); },
    async changePass(oldP, newP) {
        const us = this.users(), u = us[this.cur()];
        if (u.hash !== await this.hash(oldP)) throw 'Mật khẩu hiện tại không đúng';
        u.hash = await this.hash(newP); store('al_users', us);
    },
    logout() { localStorage.removeItem('al_session'); },
    remove() {
        const k = this.cur(), us = this.users(); delete us[k]; store('al_users', us);
        ['al_fav_', 'al_list_'].forEach(p => localStorage.removeItem(p + k)); this.logout();
    }
};
const page = () => location.pathname.split('/').pop() || 'index.html';
const goLogin = () => { location.href = 'login.html?next=' + encodeURIComponent(page() + location.search); };
const requireLogin = () => { if (!Auth.cur()) { goLogin(); return false; } return true; };
const afterAuth = () => {
    const n = new URLSearchParams(location.search).get('next');
    location.href = /^[\w-]+\.html(\?[\w=&%-]*)?$/.test(n || '') ? n : 'index.html';
};

/* ===== Dữ liệu cá nhân theo tài khoản ===== */
const Data = {
    fav: () => Auth.cur() ? load('al_fav_' + Auth.cur(), {}) : {},
    setFav: v => store('al_fav_' + Auth.cur(), v),
    list: () => Auth.cur() ? load('al_list_' + Auth.cur(), []) : [],
    setList: v => store('al_list_' + Auth.cur(), v)
};

/* ===== Header / Footer / Toast ===== */
function shell(active) {
    const me = Auth.me();
    const links = [['index.html', 'Home'], ['explore.html', 'Explore'], ['mylist.html', 'My List'], ['profile.html', 'Profile']];
    $('#hdr').innerHTML = `<div class="wrap hd"><a class="logo" href="index.html">⚡ ANILIST</a>
    <nav>${links.map(([h, t]) => `<a href="${h}" class="${h === active ? 'on' : ''}">${t}</a>`).join('')}</nav>
    <div class="user">${me ? `<a class="av" href="profile.html" title="${esc(me.name)}">${esc(me.name[0].toUpperCase())}</a><button class="btn sm ghost" id="lo">Đăng xuất</button>`
            : '<a class="btn sm ghost" href="login.html">Đăng nhập</a><a class="btn sm" href="register.html">Đăng ký</a>'}</div></div>`;
    $('#ftr').innerHTML = `<div class="wrap">© 2026 AniList – Thư viện anime · Dữ liệu từ <a href="https://jikan.moe" target="_blank" rel="noopener">Jikan API</a> (MyAnimeList)<br>HTML5 · CSS3 · JavaScript · Local Storage</div>`;
    const lo = $('#lo'); if (lo) lo.onclick = () => { Auth.logout(); location.href = 'index.html'; };
}
function toast(m) {
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = m;
    document.body.appendChild(t); setTimeout(() => t.remove(), 2000);
}

/* ===== Jikan API ===== */
const API = 'https://api.jikan.moe/v4', POOL = {}, CACHE = {};
async function api(path) {
    if (CACHE[path]) return CACHE[path];
    for (let i = 0; i < 4; i++) {
        const r = await fetch(API + path);
        if (r.status === 429) { await new Promise(t => setTimeout(t, 1100)); continue; }  // giới hạn 3 req/giây
        if (!r.ok) throw r.status;
        return CACHE[path] = await r.json();
    }
    throw 429;
}
const norm = a => POOL[a.mal_id] = {
    id: a.mal_id, title: a.title_english || a.title,
    img: a.images?.jpg?.image_url || '', big: a.images?.webp?.large_image_url || a.images?.jpg?.large_image_url || '',
    eps: a.episodes || 0, score: a.score || 0, year: a.year || '', synopsis: a.synopsis || '',
    genres: (a.genres || []).map(g => g.name), status: a.status || '', type: a.type || ''
};
async function fillGenres(sel) {
    try {
        const j = await api('/genres/anime');
        j.data.filter(g => !['Hentai', 'Erotica'].includes(g.name)).sort((a, b) => a.name.localeCompare(b.name))
            .forEach(g => sel.insertAdjacentHTML('beforeend', `<option value="${g.mal_id}">${esc(g.name)}</option>`));
    } catch (e) { }
}
const skel = n => `<div class="grid">${'<div class="sk"></div>'.repeat(n)}</div>`;
const errMsg = '<div class="msg">Không tải được dữ liệu từ Jikan (quá giới hạn request hoặc lỗi mạng). Thử lại sau vài giây nhé.</div>';

/* ===== Thẻ anime & hành động dùng chung ===== */
function cardHTML(a, i = 0) {
    const f = !!Data.fav()[a.id], added = Data.list().some(x => x.malId === a.id);
    return `<article class="card" style="--d:${Math.min(i, 12) * 40}ms">
    <a class="poster" href="details.html?id=${a.id}"><img src="${esc(a.img)}" alt="" loading="lazy">${a.score ? `<span class="sc">★ ${a.score}</span>` : ''}</a>
    <div class="b"><a href="details.html?id=${a.id}"><h3 title="${esc(a.title)}">${esc(a.title)}</h3></a>
    <div class="meta">${a.eps || '?'} tập${a.year ? ' · ' + a.year : ''}${a.type ? ' · ' + a.type : ''}</div>
    <div class="acts">
      <button class="btn ghost sm fav ${f ? 'on' : ''}" data-act="fav" data-id="${a.id}">${f ? '♥' : '♡'}</button>
      <button class="btn sm" data-act="add" data-id="${a.id}" ${added ? 'disabled' : ''}>${added ? '✓ Đã thêm' : '+ List'}</button>
    </div></div></article>`;
}
function cardActions(after) {
    document.addEventListener('click', e => {
        const b = e.target.closest('[data-act]');
        if (!b || !['fav', 'add'].includes(b.dataset.act)) return;
        if (!Auth.cur()) return goLogin();
        const id = +b.dataset.id, a = POOL[id] || Data.fav()[id]; if (!a) return;
        if (b.dataset.act === 'fav') {
            const f = Data.fav(); if (f[id]) { delete f[id]; toast('Đã bỏ yêu thích'); } else { f[id] = a; toast('Đã thêm vào yêu thích ♥'); }
            Data.setFav(f); after();
        } else openDlg({ malId: id, title: a.title, img: a.img, eps: a.eps, status: 'plan', watched: 0 }, 'Thêm vào My List', after);
    });
}

/* ===== Hộp thoại thêm / sửa (Create + Update) ===== */
let editing = null, afterSave = () => { };
document.body.insertAdjacentHTML('beforeend', `<dialog id="dlg"><h3 id="dt" style="margin:0"></h3>
  <label>Tên anime</label><input id="f_title">
  <label>Link ảnh bìa (tuỳ chọn)</label><input id="f_img">
  <label>Tổng số tập</label><input id="f_eps" type="number" min="0">
  <label>Trạng thái</label><select id="f_st">${Object.entries(ST).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
  <label>Số tập đã xem</label><input id="f_w" type="number" min="0">
  <label>Điểm của bạn (0–10)</label><input id="f_r" type="number" min="0" max="10">
  <label>Ghi chú</label><textarea id="f_note" rows="2"></textarea>
  <div class="end"><button class="btn ghost" id="cancel">Huỷ</button><button class="btn" id="saveBtn">Lưu</button></div></dialog>`);
function openDlg(item, title, cb) {
    editing = item; afterSave = cb || (() => { });
    $('#dt').textContent = title;
    $('#f_title').value = item.title || ''; $('#f_img').value = item.img || '';
    $('#f_eps').value = item.eps || 0; $('#f_st').value = item.status || 'plan';
    $('#f_w').value = item.watched || 0; $('#f_r').value = item.rating || 0; $('#f_note').value = item.note || '';
    $('#dlg').showModal();
}
$('#cancel').onclick = () => $('#dlg').close();
$('#saveBtn').onclick = () => {
    const title = $('#f_title').value.trim();
    if (!title) return $('#f_title').focus();
    const eps = Math.max(0, +$('#f_eps').value || 0), status = $('#f_st').value;
    let watched = Math.max(0, +$('#f_w').value || 0);
    if (eps && watched > eps) watched = eps;
    if (status === 'completed' && eps) watched = eps;
    const d = {
        title, img: $('#f_img').value.trim(), eps, status, watched,
        rating: Math.min(10, Math.max(0, +$('#f_r').value || 0)), note: $('#f_note').value.trim()
    };
    const list = Data.list();
    if (editing.uid) Object.assign(list.find(x => x.uid === editing.uid), d);
    else list.unshift({ uid: Date.now() + Math.random().toString(36).slice(2, 6), malId: editing.malId || null, ...d });
    Data.setList(list); $('#dlg').close(); toast('Đã lưu ✓'); afterSave();
};