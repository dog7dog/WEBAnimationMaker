// ══════════════════════════════════════════════════════════════
// 画像（PNG/JPEG/SVG等）の取り込み
//   type:'image' のコア図形として扱う。
//     { type:'image', x, y, w, h, rot, src(dataURL), naturalW, naturalH }
//   デザイン面へのドラッグ&ドロップと、ファイルメニューからの読み込みに対応。
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

  const hasImageFile = e =>
    Array.from(e.dataTransfer?.items || []).some(it => it.kind === 'file');

  wrap.addEventListener('dragover', e => {
    if (!hasImageFile(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    wrap.classList.add('image-drop-hover');
  });

  wrap.addEventListener('dragleave', e => {
    if (e.target === wrap) wrap.classList.remove('image-drop-hover');
  });

  wrap.addEventListener('drop', e => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    wrap.classList.remove('image-drop-hover');
    // ドロップ位置をキャンバス座標に変換して、そこを中心に配置する
    const pos = typeof canvasCoords === 'function' ? canvasCoords(e) : { x: undefined, y: undefined };
    importImageFiles(e.dataTransfer.files, pos);
  });
}

window.openImageFilePicker = openImageFilePicker;
