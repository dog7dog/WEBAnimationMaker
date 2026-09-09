// ══════════════════════════════════════════════════════════════
// Feature Pack: 自動保存 & クラッシュ復旧
//   既存 serializeProject() / deserializeProject() を利用し、
//   localStorage に定期スナップショット。起動時に復旧を提案。
// ══════════════════════════════════════════════════════════════

const MP_AUTOSAVE_KEY = 'mpAutosave';
const MP_AUTOSAVE_INTERVAL = 20000; // 20秒
let _mpAutosaveTimer = null;
let _mpLastAutosaveHash = '';

function mpAutosaveEnabled() {
  return localStorage.getItem('mpAutosaveEnabled') !== '0';
}

function mpDoAutosave() {
  if (!mpAutosaveEnabled()) return;
  if (typeof serializeProject !== 'function') return;
  if (!shapes || !shapes.length) return; // 空なら保存しない
  try {
    const data = serializeProject();
    const json = JSON.stringify(data);
    if (json === _mpLastAutosaveHash) return; // 変化なし
    _mpLastAutosaveHash = json;
    const name = (document.getElementById('proj-name')?.textContent || '無題.mlc');
    localStorage.setItem(MP_AUTOSAVE_KEY, JSON.stringify({
      name, data, ts: Date.now(), shapeCount: shapes.length
    }));
    mpFlashAutosaveBadge();
  } catch (e) {
    // 容量超過などは黙って無視（古い自動保存を消して再試行）
    try { localStorage.removeItem(MP_AUTOSAVE_KEY); } catch (e2) {}
  }
}

function mpFlashAutosaveBadge() {
  let b = document.getElementById('mp-autosave-badge');
  if (!b) {
    b = document.createElement('span');
    b.id = 'mp-autosave-badge';
    b.innerHTML = '<i class="ti ti-cloud-check"></i> 自動保存';
    const status = document.getElementById('status-txt');
    if (status && status.parentNode) status.parentNode.insertBefore(b, status);
  }
  b.classList.add('show');
  setTimeout(() => b.classList.remove('show'), 1500);
}

function mpCheckRecovery() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(MP_AUTOSAVE_KEY) || 'null'); }
  catch (e) { return; }
  if (!saved || !saved.data) return;
  // 直近に保存されたものだけ提案（7日以内）
  if (Date.now() - saved.ts > 7 * 24 * 3600 * 1000) return;

  const when = new Date(saved.ts).toLocaleString();
  const el = document.createElement('div');
  el.id = 'mp-recovery';
  el.className = 'mp-toast-card';
  el.innerHTML = `
    <div class="mp-rec-body">
      <i class="ti ti-history"></i>
      <div>
        <div class="mp-rec-title">前回の作業を復元しますか？</div>
        <div class="mp-rec-sub">${saved.name} · ${saved.shapeCount || 0}図形 · ${when}</div>
      </div>
    </div>
    <div class="mp-rec-btns">
      <button class="mp-btn-ghost" id="mp-rec-dismiss">破棄</button>
      <button class="mp-btn-accent" id="mp-rec-restore">復元</button>
    </div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));

  document.getElementById('mp-rec-restore').onclick = () => {
    try {
      if (typeof deserializeProject === 'function') {
        deserializeProject(saved.data);
        const pn = document.getElementById('proj-name');
        if (pn && saved.name) pn.textContent = saved.name;
        toast('ti-check', '前回の作業を復元しました');
      }
    } catch (e) { toast('ti-alert-triangle', '復元に失敗しました'); }
    el.remove();
  };
  document.getElementById('mp-rec-dismiss').onclick = () => {
    localStorage.removeItem(MP_AUTOSAVE_KEY);
    el.remove();
  };
  // 20秒で自動的に引っ込む（データは保持）
  setTimeout(() => { if (document.body.contains(el)) { el.classList.remove('show'); setTimeout(() => el.remove(), 400); } }, 20000);
}

function mpAutosaveStart() {
  if (_mpAutosaveTimer) clearInterval(_mpAutosaveTimer);
  _mpAutosaveTimer = setInterval(mpDoAutosave, MP_AUTOSAVE_INTERVAL);
  // ページ離脱前にも保存
  window.addEventListener('beforeunload', mpDoAutosave);
}

function mpToggleAutosave() {
  const on = !mpAutosaveEnabled();
  localStorage.setItem('mpAutosaveEnabled', on ? '1' : '0');
  toast(on ? 'ti-cloud-check' : 'ti-cloud-off', '自動保存: ' + (on ? 'ON' : 'OFF'));
  return on;
}

window.mpToggleAutosave = mpToggleAutosave;
window.mpDoAutosave = mpDoAutosave;

// 起動
function mpAutosaveInit() {
  mpAutosaveStart();
  setTimeout(mpCheckRecovery, 800); // 復旧提案は少し遅らせる
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mpAutosaveInit);
} else {
  setTimeout(mpAutosaveInit, 100);
}
