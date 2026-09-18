// ── DOM refs ─────────────────────────────────────────────────
const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
const area = document.getElementById('canvas-area');


// ── グローバル状態 ────────────────────────────────────────────
let color = '#3B8AE6';
// 枠線の色。null のあいだは塗りの色(color)と同じ色で描く
let strokeColor = null;
let doFill = false;
let tool = 'select';
let shapes = [];
let selected = null;
let multiSelected = [];

// Trigger→Animation/Action のインタラクションルール（プロジェクト全体で1つの配列）。
// Blocklyワークスペースから再生成される導出データ。今はまだ生成/参照する
// 処理が無いプレースホルダー（Slice 1以降で使用する）。
let interactions = [];

// ── レイヤー ─────────────────────────────────────────────────
let layers = [{ id: 'layer-1', name: 'Layer 1', type: 'normal', parentId: null, visible: true, locked: false, opacity: 1, blendMode: 'source-over', color: null, collapsed: false }];
let activeLayerId = 'layer-1';

// 描画パラメータ
let sw = 2;
let rr = 0;
let rot = 0;
let opa = 100;
let sides = 6;
let dash = '0';
let textFontFamily = 'sans-serif';
let textFontSize = 24;

// マウス状態
let isDown = false;
let sx = 0, sy = 0;
let dragSel = false;
let dragOx = 0, dragOy = 0;
let modBrushPoints = [];
let marqueeSelecting = false;
let marqueeRect = null;
let marqueeAppend = false;

// リサイズ状態
let resizing = false;
let resizeHandle = null;
let resizeStart = null;
let freeTransforming = false;
const HANDLE_R = 6;

// ペン/パス
let penPts = [];
let ghostX = 0, ghostY = 0;

// ── path ツール専用の状態 ─────────────────────────────────────
let pathPoints = [];   // 確定した点の配列
let pathDragging = false; // ドラッグ中か
let pathMouseX = 0;    // 現在のマウス位置
let pathMouseY = 0;
let pathDragMode = false; // ドラッグ描画モード（マウスを押したまま動かす）
let _eraserHover = null;  // 消しゴムホバー中の図形

// ブラシ
let brushSize = 16;
let brushOpa = 80;
let brushSpacing = 4;
let brushType = 'round';
let brushPts = [];
let bLastX = null, bLastY = null;

const API = '';
let currentProjectId = null;

// Undo スタック
let undoStack = [];
let redoStack = [];

// 再描画系の共有state
let canvasBg = '#111111';

// キャンバス（ドキュメント）の論理解像度。
// ウィンドウ/パネルの表示サイズとは切り離して固定し、縮小しても
// 図形が画面外に「消える」（実際は解像度自体が縮んでいた）事故を防ぐ。
let docW = Number(localStorage.getItem('mpDocW')) || 1280;
let docH = Number(localStorage.getItem('mpDocH')) || 720;

// 見る人の画面1つ分の高さ。「◯ページごとにスクロールしたとき」が
// 実際に使うのは見る人のブラウザの高さなので、ここで決めるのは
// デザイン中に区切り線をどこへ引くかという目安。
let pageViewHeight = Number(localStorage.getItem('mpPageViewH')) || 720;

// ページごとに吸い付くスクロール（1画面ずつピタッと止まる）
let pageSnap = false;

// コピペ
let clipboard = null;

// 書き出し等で参照するフレームレート
let FPS = Number(localStorage.getItem('mlcFPS') || 24);

// ── ユーティリティ ────────────────────────────────────────────
function setStatus(msg) {
  document.getElementById('status-txt').textContent = msg;
}

function toast(icon, msg) {
  const el = document.getElementById('toast');
  el.querySelector('i').className = 'ti ' + icon;
  document.getElementById('toast-msg').textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2400);
}

// テキスト入力中かどうかを判定する（グローバルなキーボードショートカットを
// 抑制すべきかの判定に使う）。Monaco Editor は input/textarea ではなく
// role="textbox" の div（EditContext API）にフォーカスするため、
// tagName だけのチェックでは Monaco 内での Space / Ctrl+C 等を誤検知できない。
function isTypingContext(el) {
  el = el || document.activeElement;
  if (!el) return false;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return true;
  if (el.isContentEditable) return true;
  if (el.closest && el.closest('.monaco-editor')) return true;
  return false;
}

// 生成コード/AI生成コードに渡す経過秒数。タイムライン(animT)の代わりに
// ページ表示からの実時間を使う（イベント駆動へ移行したため）。
const _mpStartedAt = performance.now();
function mpElapsedSeconds() { return (performance.now() - _mpStartedAt) / 1000; }
