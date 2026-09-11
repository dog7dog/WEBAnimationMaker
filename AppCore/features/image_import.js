// ══════════════════════════════════════════════════════════════
// 画像（PNG/JPEG/SVG等）の取り込みとコピー
//   type:'image' のコア図形として扱う。
//     { type:'image', x, y, w, h, rot, src(dataURL), naturalW, naturalH }
//
//   入れ方は3通り:
//     ・ファイルメニュー / コマンドパレットから選ぶ
//     ・デザイン面へドラッグ&ドロップ
//     ・クリップボードから貼り付け（⌘V）
//   出し方は「画像をコピー」(⌘⇧C)で、OSのクリップボードへPNGとして書き出す。
//
//   SVGはベクタとして解析せず、dataURLのまま<img>として貼る
//   （canvasのdrawImageにも、DOMミラーのbackground-imageにもそのまま使える）。
// ══════════════════════════════════════════════════════════════

const IMAGE_IMPORT_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';

// srcごとのHTMLImageElementキャッシュ。canvas描画から毎フレーム呼ばれるので
// 同じsrcで作り直さないようにし、読み込み完了時に一度だけ再描画する。
const _shapeImageCache = {};

function getShapeImage(src) {
  if (!src) return null;
  let img = _shapeImageCache[src];
  if (!img) {
    img = new Image();
    img.onload = () => { if (typeof redraw === 'function') redraw(); };
    img.src = src;
    _shapeImageCache[src] = img;
  }
  return img;
}

// キャンバスに収まる大きさに縮める（元より大きくはしない）
function _fitImageSize(naturalW, naturalH) {
  const maxW = (docW || 1280) * 0.8;
  const maxH = (docH || 720) * 0.8;
  const w = naturalW || 320;
  const h = naturalH || 240;
  const k = Math.min(1, maxW / w, maxH / h);
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

// dataURLから画像図形を作ってシーンに追加する。
// x/y を省略した場合はキャンバス中央に置く。
function addImageShape(src, opts = {}) {
  return new Promise(resolve => {
    const probe = new Image();
    probe.onload = () => {
      // SVGなどで固有サイズが取れない場合があるのでフォールバックする
      const natW = probe.naturalWidth || 320;
      const natH = probe.naturalHeight || 240;
      const size = _fitImageSize(natW, natH);

      const x = Number.isFinite(opts.x) ? Math.round(opts.x - size.w / 2) : Math.round(((docW || 1280) - size.w) / 2);
      const y = Number.isFinite(opts.y) ? Math.round(opts.y - size.h / 2) : Math.round(((docH || 720) - size.h) / 2);

      if (typeof saveState === 'function') saveState();
      if (typeof ensureShapeIds === 'function') ensureShapeIds();

      const shape = {
        type: 'image',
        x, y, w: size.w, h: size.h, rot: 0,
        src, naturalW: natW, naturalH: natH,
        color: '#ffffff', sw: 0, dash: '0', fill: false,
        opa: 100, hidden: false,
        name: opts.name || '画像',
        layerId: typeof getDrawableActiveLayerId === 'function' ? getDrawableActiveLayerId() : 'layer-1'
      };

      shapes.push(shape);
      _shapeImageCache[src] = probe;
      if (typeof ensureShapeIds === 'function') ensureShapeIds();
      selected = shape;

      if (typeof syncAll === 'function') syncAll();
      else if (typeof redraw === 'function') redraw();

      if (typeof toast === 'function') toast('ti-photo', '画像を追加しました');
      resolve(shape);
    };
    probe.onerror = () => {
      if (typeof toast === 'function') toast('ti-alert-triangle', '画像を読み込めませんでした');
      resolve(null);
    };
    probe.src = src;
  });
}

function _readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ファイル群を順に取り込む（同じ位置に重ならないよう少しずらす）
async function importImageFiles(files, opts = {}) {
  const list = Array.from(files || []).filter(f => /^image\//.test(f.type));
  if (!list.length) return [];

  const added = [];
  for (let i = 0; i < list.length; i++) {
    const file = list[i];
    try {
      const src = await _readFileAsDataUrl(file);
      const shape = await addImageShape(src, {
        x: Number.isFinite(opts.x) ? opts.x + i * 24 : undefined,
        y: Number.isFinite(opts.y) ? opts.y + i * 24 : undefined,
        name: file.name.replace(/\.[^.]+$/, '')
      });
      if (shape) added.push(shape);
    } catch (e) {
      console.error('[image_import] 読み込みに失敗しました', file?.name, e);
      if (typeof toast === 'function') toast('ti-alert-triangle', '画像を読み込めませんでした');
    }
  }
  return added;
}

// ファイルメニュー/コマンドパレットから
function openImageFilePicker() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = IMAGE_IMPORT_ACCEPT;
  input.multiple = true;
  input.onchange = e => importImageFiles(e.target.files);
  input.click();
}

function initImageDropZone() {
  const wrap = document.getElementById('cv-wrap');
  if (!wrap || wrap.dataset.imageDropBound === '1') return;
  wrap.dataset.imageDropBound = '1';

  // ドラッグ中は中身を読めないので、種類だけで受け入れるか決める
  //   ファイルのドラッグ … items に kind:'file'
  //   ブラウザの画像     … types に 'text/uri-list'
  const mayHaveImage = e => {
    const dt = e.dataTransfer;
    if (!dt) return false;
    if (Array.from(dt.items || []).some(it => it.kind === 'file')) return true;
    return Array.from(dt.types || []).includes('text/uri-list');
  };

  wrap.addEventListener('dragover', e => {
    if (!mayHaveImage(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    wrap.classList.add('image-drop-hover');
  });

  wrap.addEventListener('dragleave', e => {
    if (e.target === wrap) wrap.classList.remove('image-drop-hover');
  });

  wrap.addEventListener('drop', e => {
    const dt = e.dataTransfer;
    if (!dt || !_clipboardHasImage(dt)) return;
    e.preventDefault();
    wrap.classList.remove('image-drop-hover');
    // ドロップ位置をキャンバス座標に変換して、そこを中心に配置する
    const pos = typeof canvasCoords === 'function' ? canvasCoords(e) : {};
    importImagesFromClipboard(dt, pos);
  });
}

// ── クリップボードから貼り付け ───────────────────────────────

// クリップボード/ドロップのアイテムから画像ファイルを取り出す。
// スクリーンショット、ブラウザでコピーした画像、ファイルのコピーが対象。
function _clipboardImageFiles(dataTransfer) {
  const out = [];
  Array.from(dataTransfer?.items || []).forEach(it => {
    if (it.kind !== 'file' || !/^image\//.test(it.type)) return;
    const file = it.getAsFile();
    if (file) out.push(file);
  });
  if (out.length) return out;
  // items を持たないブラウザ向け
  return Array.from(dataTransfer?.files || []).filter(f => /^image\//.test(f.type));
}

// クリップボード/ドロップのテキストが画像URLか
const IMAGE_URL_RE = /^https?:\/\/\S+\.(png|jpe?g|gif|webp|svg)(\?\S*)?$/i;

// 貼り付け/ドロップのテキストを取り出す。
// ブラウザから画像をドラッグすると text/uri-list で渡ってくる。
function _transferText(dataTransfer) {
  if (!dataTransfer?.getData) return '';
  const raw = dataTransfer.getData('text/uri-list') || dataTransfer.getData('text/plain') || '';
  // uri-list はコメント行(#)を含みうるので、最初のURL行だけ見る
  return String(raw).split(/[\r\n]+/).find(line => line && !line.startsWith('#'))?.trim() || '';
}

// クリップボード/ドロップに画像（ファイル・dataURL・画像URL）が入っているか。
// paste イベントでは await をまたぐと preventDefault が効かないので、
// 「扱うかどうか」はこれで同期的に決める。
function _clipboardHasImage(dataTransfer) {
  if (_clipboardImageFiles(dataTransfer).length) return true;
  const text = _transferText(dataTransfer);
  return /^data:image\//.test(text) || IMAGE_URL_RE.test(text);
}

// URLから画像を取り込む。別ドメインの画像はCORSで読めないことがあるので、
// 失敗したら理由がわかるように知らせる（dataURLとして埋め込めないと
// 書き出したページで表示できないため、URL参照のままにはしない）。
async function importImageFromUrl(url, opts = {}) {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    if (!/^image\//.test(blob.type)) throw new Error('画像ではありません');
    const src = await _readFileAsDataUrl(blob);
    return await addImageShape(src, opts);
  } catch (e) {
    console.warn('[image_import] URLから画像を取り込めませんでした', url, e);
    if (typeof toast === 'function') {
      toast('ti-alert-triangle', 'この画像URLは読み込めませんでした（CORS制限の可能性）');
    }
    return null;
  }
}

// クリップボードの中身を見て、画像があれば取り込む。
// 画像が無ければ false を返し、図形の貼り付け(paste)に任せる。
async function importImagesFromClipboard(dataTransfer, opts = {}) {
  const files = _clipboardImageFiles(dataTransfer);
  if (files.length) {
    const added = await importImageFiles(files, opts);
    return added.length > 0;
  }

  const text = _transferText(dataTransfer);
  if (/^data:image\//.test(text)) {
    return !!(await addImageShape(text, opts));
  }
  if (IMAGE_URL_RE.test(text)) {
    return !!(await importImageFromUrl(text, opts));
  }
  return false;
}

// ⌘V は paste イベントでクリップボードを読みたいので events.js 側では
// 打ち消さない。paste イベントが来ないブラウザのために、少し待ってから
// 図形の貼り付けへ自分で倒す。paste イベントが来たらこれは取り消される。
let _pasteFallbackTimer = null;

function schedulePasteFallback() {
  clearTimeout(_pasteFallbackTimer);
  _pasteFallbackTimer = setTimeout(() => {
    _pasteFallbackTimer = null;
    if (typeof paste === 'function') paste();
  }, 150);
}

function _cancelPasteFallback() {
  clearTimeout(_pasteFallbackTimer);
  _pasteFallbackTimer = null;
}

function initClipboardImagePaste() {
  if (document.body.dataset.imagePasteBound === '1') return;
  document.body.dataset.imagePasteBound = '1';

  document.addEventListener('paste', e => {
    // 入力欄やテキストエディタの中では、ふつうの文字の貼り付けに任せる
    if (typeof isTypingContext === 'function' && isTypingContext()) return;
    _cancelPasteFallback();

    const data = e.clipboardData;

    // 画像が無ければ、アプリ内でコピーした図形の貼り付けに回す
    if (!data || !_clipboardHasImage(data)) {
      if (typeof paste === 'function') paste();
      return;
    }

    e.preventDefault();
    importImagesFromClipboard(data);
  });
}

// ── OSのクリップボードへコピー ───────────────────────────────

// 画像図形を元の解像度のPNGにする。回転や拡大縮小はかけず、
// 「その画像そのもの」を他のアプリへ渡せるようにする。
function _imageShapeToPngBlob(s) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      // SVGなどで固有サイズが取れない場合はキャンバス上の大きさで代用する
      c.width = Math.max(1, Math.round(img.naturalWidth || s.w || 1));
      c.height = Math.max(1, Math.round(img.naturalHeight || s.h || 1));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(b => (b ? resolve(b) : reject(new Error('PNGに変換できませんでした'))), 'image/png');
    };
    img.onerror = () => reject(new Error('画像を読み込めませんでした'));
    img.src = s.src;
  });
}

// 選択中の画像をOSのクリップボードへ置く（他のアプリへ貼れるようにする）。
// アプリ内での複製は従来どおり ⌘C → ⌘V。
async function copySelectedImageToClipboard() {
  const s = (typeof selected !== 'undefined' && selected) || null;
  if (!s || s.type !== 'image') {
    if (typeof toast === 'function') toast('ti-info-circle', '画像を選択してください');
    return false;
  }
  if (!navigator.clipboard || typeof navigator.clipboard.write !== 'function'
      || typeof ClipboardItem === 'undefined') {
    if (typeof toast === 'function') toast('ti-alert-triangle', 'このブラウザは画像のコピーに未対応です');
    return false;
  }
  try {
    const blob = await _imageShapeToPngBlob(s);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    if (typeof toast === 'function') toast('ti-copy', '画像をコピーしました');
    return true;
  } catch (e) {
    console.error('[image_import] 画像のコピーに失敗しました', e);
    if (typeof toast === 'function') toast('ti-alert-triangle', '画像をコピーできませんでした');
    return false;
  }
}

window.openImageFilePicker = openImageFilePicker;
window.importImagesFromClipboard = importImagesFromClipboard;
window.copySelectedImageToClipboard = copySelectedImageToClipboard;
window.schedulePasteFallback = schedulePasteFallback;
