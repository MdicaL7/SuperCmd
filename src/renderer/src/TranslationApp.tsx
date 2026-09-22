import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, Languages, Loader2, RotateCcw, Settings, Square, X } from 'lucide-react';
import { useI18n } from './i18n';
import { applyAppFontSize } from './utils/font-size';
import { applyBaseColor } from './utils/base-color';
import { applyUiStyle } from './utils/ui-style';
import type { TranslationSnapshot, TranslationTarget } from '../../shared/translation';

const initial: TranslationSnapshot = { revision: -1, sourceVersion: 0, source: 'manual', text: '', target: 'zh-Hans', result: '', phase: 'idle' };
const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties;

export default function TranslationApp() {
  const { t } = useI18n();
  const [state, setState] = useState<TranslationSnapshot>(initial);
  const [text, setText] = useState('');
  const [target, setTarget] = useState<TranslationTarget>('zh-Hans');
  const [copied, setCopied] = useState(false);
  const [bridgeError, setBridgeError] = useState(false);
  const latest = useRef(initial);
  const input = useRef<HTMLTextAreaElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout>>();
  const busy = state.phase === 'translating' || state.phase === 'capturing';

  useEffect(() => {
    let active = true;
    const receive = (next: TranslationSnapshot) => {
      if (!active || next.revision <= latest.current.revision) return;
      const previous = latest.current;
      latest.current = next;
      if (next.text !== previous.text || next.sourceVersion !== previous.sourceVersion || previous.revision < 0) setText(next.text);
      if (next.target !== previous.target || next.sourceVersion !== previous.sourceVersion || previous.revision < 0) setTarget(next.target);
      setState(next);
      setCopied(false);
      setBridgeError(false);
    };
    const off = window.translationAPI.onState(receive);
    window.translationAPI.getState().then(receive).catch(() => { if (active) setBridgeError(true); });
    input.current?.focus();
    return () => { active = false; off(); if (copyTimer.current) clearTimeout(copyTimer.current); };
  }, []);

  useEffect(() => {
    let active = true;
    const apply = (settings: any) => {
      if (!active) return;
      applyAppFontSize(settings.fontSize);
      applyUiStyle(settings.uiStyle || 'default');
      applyBaseColor(settings.baseColor || '#101113');
    };
    window.electron.getSettings().then(apply).catch(() => {});
    const off = window.electron.onSettingsUpdated(apply);
    return () => { active = false; off?.(); };
  }, []);

  const submit = useCallback(() => {
    if (!text.trim()) return;
    setBridgeError(false);
    void window.translationAPI.translate(text, target).catch(() => setBridgeError(true));
  }, [text, target]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); void window.translationAPI.close(); }
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); submit(); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [submit]);

  const cancel = () => { void window.translationAPI.cancel().catch(() => setBridgeError(true)); };
  const copy = async () => {
    try {
      await window.translationAPI.copy();
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1600);
    } catch { setBridgeError(true); }
  };
  const error = bridgeError ? t('translation.errors.bridge') : state.error ? t(`translation.errors.${state.error}`) : '';

  return (
    <main className="h-screen flex flex-col overflow-hidden glass-effect" style={{ color: 'var(--text-primary)', background: 'var(--surface-base, var(--settings-panel-bg))' }}>
      <header className="flex items-center justify-between px-5 py-3 border-b border-[var(--ui-divider)] select-none" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <div className="flex items-center gap-2"><Languages size={18} /><strong className="text-sm">{t('translation.title')}</strong></div>
        <button style={noDrag} className="p-1.5 rounded-md hover:bg-black/10 dark:hover:bg-white/10" onClick={() => void window.translationAPI.close()} title={t('translation.close')} aria-label={t('translation.close')}><X size={17} /></button>
      </header>
      <div className="flex items-center gap-3 px-5 py-3 text-xs border-b border-[var(--ui-divider)]">
        <span className="opacity-65">{t('translation.autoDetect')}</span><span className="opacity-40">→</span>
        <label className="sr-only" htmlFor="translation-target">{t('translation.target')}</label>
        <select id="translation-target" className="bg-transparent border border-[var(--ui-divider)] rounded-md px-2 py-1" value={target} onChange={(event) => { cancel(); setTarget(event.target.value as TranslationTarget); }}>
          <option value="zh-Hans">{t('translation.chinese')}</option><option value="en">{t('translation.english')}</option>
        </select>
        <span className="ml-auto opacity-50">{t(`translation.sources.${state.source}`)}</span>
      </div>
      <section className="flex flex-col min-h-[130px] flex-1 px-5 pt-4 pb-3 border-b border-[var(--ui-divider)]">
        <label htmlFor="translation-source" className="text-xs opacity-60 mb-2">{t('translation.source')}</label>
        <textarea ref={input} id="translation-source" className="flex-1 w-full resize-none bg-transparent outline-none text-sm leading-relaxed" value={text} placeholder={t('translation.placeholder')} onChange={(event) => { if (busy) cancel(); setText(event.target.value); }} spellCheck={false} />
      </section>
      <section className="flex flex-col min-h-[130px] flex-1 px-5 pt-4 pb-3 overflow-hidden">
        <div className="flex items-center justify-between mb-2"><span className="text-xs opacity-60">{t('translation.result')}</span>
          <button className="flex items-center gap-1 text-xs px-2 py-1 rounded-md hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-30" disabled={!state.result} onClick={copy}>
            {copied ? <Check size={14} /> : <Copy size={14} />}{t(copied ? 'translation.copied' : 'translation.copy')}
          </button>
        </div>
        <div className="flex-1 overflow-auto text-sm leading-relaxed whitespace-pre-wrap break-words select-text">{state.result || <span className="opacity-35">{t(busy ? 'translation.working' : 'translation.resultPlaceholder')}</span>}</div>
      </section>
      {error && <div role="alert" className="mx-5 mb-3 rounded-lg px-3 py-2 text-xs bg-red-500/10 text-red-600 dark:text-red-300">
        <p>{error}</p>{state.detail && !bridgeError && <p className="mt-1 opacity-75 break-words max-h-16 overflow-auto">{state.detail}</p>}
        {state.error === 'not-configured' && <button className="mt-2 inline-flex items-center gap-1 underline" onClick={() => void window.translationAPI.openSettings()}><Settings size={13} />{t('translation.configure')}</button>}
      </div>}
      <footer className="flex items-center justify-between px-5 py-3 border-t border-[var(--ui-divider)]">
        <span role="status" aria-live="polite" className="text-xs opacity-50">{t(`translation.phases.${state.phase}`)}</span>
        {busy ? <button className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-[var(--ui-divider)] text-xs" onClick={cancel}><Loader2 size={14} className="animate-spin" /><Square size={10} />{t('translation.cancel')}</button>
          : <button className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-blue-600 text-white disabled:opacity-40 text-xs" disabled={!text.trim()} onClick={submit}><RotateCcw size={13} />{t(state.phase === 'idle' ? 'translation.translate' : 'translation.retry')}<span className="opacity-60 ml-1">⌘↵</span></button>}
      </footer>
    </main>
  );
}
