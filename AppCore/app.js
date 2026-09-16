// ── 初期化 ───────────────────────────────────────────────────
setColor('#ffffff');
setStatus('準備完了');
initJSEditor();
initViewTabs();
initJeFileManager();
initImageDropZone();
initClipboardImagePaste();
setTimeout(() => { initRuler(); }, 50);
setTimeout(initGroupAndFpsControls, 80);
setTimeout(loadMods, 250);
