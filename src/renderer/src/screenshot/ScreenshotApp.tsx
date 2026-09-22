import React, { useEffect, useState } from 'react';
import { Copy, Download, Pin, ScanText, Languages, X, Minus, Plus } from 'lucide-react';
import type { CaptureArtifact, ScreenshotActionResult } from '../../../shared/screenshot';
import { useI18n } from '../i18n';
import './screenshot.css';

export default function ScreenshotApp() {
  const { t } = useI18n();
  const [capture, setCapture] = useState<{ artifact: CaptureArtifact; pinned: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    window.screenshotAPI.getCurrent().then(value => { if (alive) setCapture(value); });
    return () => { alive = false; };
  }, []);

  async function run(operation: 'copy' | 'save' | 'pin' | 'recognize' | 'translate') {
    if (busy) return;
    setBusy(true); setMessage('');
    try {
      const result: ScreenshotActionResult = await window.screenshotAPI[operation]();
      if (result.status === 'error') setMessage(result.message);
      else if (result.status === 'ok') {
        if (operation === 'recognize') setText(result.text || '');
        if ((operation === 'recognize' || operation === 'translate') && !result.text?.trim()) setMessage(t('screenshot.noText'));
        else setMessage(t(`screenshot.done.${operation}`));
      }
    } catch { setMessage(t('screenshot.error')); }
    finally { setBusy(false); }
  }
  const actions = [
    ['copy', Copy], ['save', Download], ['pin', Pin], ['recognize', ScanText], ['translate', Languages],
  ] as const;
  return <main className={`screenshot-app ${capture?.pinned ? 'is-pinned' : ''}`}>
    <header className="screenshot-toolbar">
      <span className="screenshot-title">{t(capture?.pinned ? 'screenshot.pinned' : 'screenshot.title')}</span>
      <div className="screenshot-actions">
        {actions.filter(([action]) => !capture?.pinned || action === 'copy' || action === 'save').map(([action, Icon]) =>
          <button key={action} type="button" title={t(`screenshot.${action}`)} aria-label={t(`screenshot.${action}`)} disabled={busy || !capture} onClick={() => void run(action)}><Icon size={17}/></button>)}
        {capture?.pinned && <>
          <button aria-label={t('screenshot.zoomOut')} title={t('screenshot.zoomOut')} onClick={() => window.screenshotAPI.zoom(0.8)}><Minus size={16}/></button>
          <button aria-label={t('screenshot.zoomIn')} title={t('screenshot.zoomIn')} onClick={() => window.screenshotAPI.zoom(1.25)}><Plus size={16}/></button>
        </>}
        <button type="button" title={t('screenshot.close')} aria-label={t('screenshot.close')} onClick={() => window.screenshotAPI.close()}><X size={17}/></button>
      </div>
    </header>
    <div className="screenshot-image-area">
      {capture && <img draggable={false} src={capture.artifact.previewDataUrl} alt={t('screenshot.image')} />}
      {!capture && <span>{t('screenshot.loading')}</span>}
    </div>
    {text !== null && <section className="screenshot-ocr">
      <div><strong>{t('screenshot.recognized')}</strong><button onClick={() => void window.electron.clipboardWrite({text}).then(() => setMessage(t('screenshot.done.copy')))}>{t('screenshot.copyText')}</button></div>
      <textarea value={text} onChange={event => setText(event.target.value)} aria-label={t('screenshot.recognized')} spellCheck={false}/>
    </section>}
    {!capture?.pinned && <footer role="status">{busy ? t('screenshot.working') : message || t('screenshot.hint')}</footer>}
    {capture?.pinned && message && <div className="screenshot-toast" role="status">{message}</div>}
  </main>;
}
