import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, Copy, File, Folder, FolderOpen, Pin, PinOff, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { useI18n } from '../i18n';
import type { FileShelfResult, FileShelfSnapshot } from '../../../shared/file-shelf';
import './file-shelf.css';

const empty: FileShelfSnapshot = { items: [], alwaysOnTop: true };

export default function FileShelfApp(): React.ReactElement {
  const { t } = useI18n();
  const [state, setState] = useState(empty);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [draggingOver, setDraggingOver] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const anchor = useRef<string | null>(null);
  const dragDepth = useRef(0);
  const operationActive = useRef(false);
  const visibleItems = state.items.filter((item) => `${item.name}\n${item.path}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const chosen = state.items.filter((item) => selected.includes(item.id));
  const canTransfer = chosen.length > 0 && chosen.every((item) => item.available) && !busy;

  const applySnapshot = useCallback((snapshot: FileShelfSnapshot) => {
    setState(snapshot);
    setSelected((ids) => ids.filter((id) => snapshot.items.some((item) => item.id === id)));
    setLoading(false);
    if (snapshot.error) setError(snapshot.error);
  }, []);

  useEffect(() => {
    let disposed = false;
    const update = (snapshot: FileShelfSnapshot) => { if (!disposed) applySnapshot(snapshot); };
    window.fileShelf.getState().then(update).catch((reason) => { if (!disposed) { setError(String(reason)); setLoading(false); } });
    const stopChanges = window.fileShelf.onChanged(update);
    const stopErrors = window.fileShelf.onError((message) => { if (!disposed) { setError(message); setNotice(''); } });
    // A pinned shelf can remain visible while Finder changes or ejects a source.
    const refresh = window.setInterval(() => {
      if (!document.hidden) void window.fileShelf.getState().then(update).catch(() => {});
    }, 3000);
    return () => { disposed = true; window.clearInterval(refresh); stopChanges(); stopErrors(); };
  }, [applySnapshot]);

  const run = useCallback(async (operation: () => Promise<FileShelfResult>, successMessage = '') => {
    if (operationActive.current) return;
    operationActive.current = true;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await operation();
      if (!result.ok) setError(result.error || t('fileShelf.failed'));
      else if (!result.cancelled) {
        if (result.skipped?.length) setError(t('fileShelf.skipped', { count: result.skipped.length }) + ' ' + result.skipped.map((item) => item.path).join(', '));
        if (result.added !== undefined) setNotice(t('fileShelf.added', { count: result.added, duplicates: result.duplicates || 0 }));
        else if (successMessage) setNotice(successMessage);
      }
      applySnapshot(await window.fileShelf.getState());
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); operationActive.current = false; }
  }, [applySnapshot, t]);

  const copy = useCallback(() => {
    if (canTransfer) void run(() => window.fileShelf.copy(selected), t('fileShelf.copied', { count: selected.length }));
  }, [canTransfer, run, selected, t]);
  const remove = useCallback(() => {
    if (selected.length && !busy) void run(() => window.fileShelf.remove(selected), t('fileShelf.removed'));
  }, [busy, run, selected, t]);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault(); setSelected(visibleItems.map((item) => item.id));
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') {
        event.preventDefault(); copy();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault(); remove();
      }
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [copy, remove, visibleItems]);

  const select = (id: string, event: React.MouseEvent) => {
    if (event.shiftKey && anchor.current) {
      const from = visibleItems.findIndex((item) => item.id === anchor.current);
      const to = visibleItems.findIndex((item) => item.id === id);
      if (from >= 0 && to >= 0) { setSelected(visibleItems.slice(Math.min(from, to), Math.max(from, to) + 1).map((item) => item.id)); return; }
    }
    if (event.metaKey || event.ctrlKey) setSelected((ids) => ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]);
    else setSelected([id]);
    anchor.current = id;
  };

  return (
    <main className="file-shelf" onDragOver={(event) => {
      event.preventDefault(); event.dataTransfer.dropEffect = 'copy';
    }} onDragEnter={(event) => {
      event.preventDefault();
      if (Array.from(event.dataTransfer.types).includes('Files')) { dragDepth.current++; setDraggingOver(true); }
    }} onDragLeave={(event) => {
      event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDraggingOver(false);
    }} onDrop={(event) => {
      event.preventDefault(); dragDepth.current = 0; setDraggingOver(false);
      const files = Array.from(event.dataTransfer.files);
      if (operationActive.current) { setError(t('fileShelf.wait')); return; }
      void run(() => window.fileShelf.addFiles(files));
    }}>
      <header className="file-shelf-titlebar">
        <span>{t('fileShelf.title')}</span>
        <button className={`shelf-icon-button ${state.alwaysOnTop ? 'is-active' : ''}`} title={t(state.alwaysOnTop ? 'fileShelf.unpin' : 'fileShelf.pin')} aria-label={t(state.alwaysOnTop ? 'fileShelf.unpin' : 'fileShelf.pin')} disabled={busy} onClick={() => void run(() => window.fileShelf.setAlwaysOnTop(!state.alwaysOnTop))}>
          {state.alwaysOnTop ? <Pin size={15} /> : <PinOff size={15} />}
        </button>
      </header>

      <section className="shelf-heading">
        <div className="shelf-heading-icon"><ArrowDownToLine size={22} /></div>
        <div><h1>{t('fileShelf.heading')}</h1><p>{t('fileShelf.subtitle')}</p></div>
      </section>

      <div className="shelf-add-actions">
        <button disabled={busy || Boolean(state.error)} onClick={() => void run(() => window.fileShelf.chooseFiles('files'))}><Plus size={15} />{t('fileShelf.addFiles')}</button>
        <button disabled={busy || Boolean(state.error)} onClick={() => void run(() => window.fileShelf.chooseFiles('folders'))}><Folder size={15} />{t('fileShelf.addFolders')}</button>
      </div>

      {state.items.length > 0 && <div className="shelf-search"><Search size={15} /><input aria-label={t('fileShelf.search')} placeholder={t('fileShelf.search')} value={query} onChange={(event) => setQuery(event.target.value)} />{query && <button className="shelf-icon-button" aria-label={t('fileShelf.clearSearch')} onClick={() => setQuery('')}><X size={13} /></button>}</div>}

      <div className="shelf-selection-actions">
        <label><input type="checkbox" checked={visibleItems.length > 0 && visibleItems.every((item) => selected.includes(item.id))} disabled={!visibleItems.length || busy} onChange={(event) => setSelected(event.target.checked ? visibleItems.map((item) => item.id) : [])} />{t('fileShelf.selectAll')}</label>
        <span>{t('fileShelf.selected', { count: selected.length })}</span>
        <button className="shelf-icon-button" title={t('fileShelf.refresh')} aria-label={t('fileShelf.refresh')} onClick={() => { setError(''); window.fileShelf.getState().then(applySnapshot).catch((reason) => setError(String(reason))); }}><RefreshCw size={14} /></button>
      </div>

      <section className="shelf-items" aria-label={t('fileShelf.files')}>
        {loading ? <div className="shelf-empty"><p>{t('fileShelf.loading')}</p></div> : visibleItems.length === 0 ? <div className="shelf-empty"><div className="shelf-empty-icon"><FolderOpen size={36} strokeWidth={1.25} /></div><h2>{t(state.items.length ? 'fileShelf.noResults' : 'fileShelf.dropHere')}</h2><p>{t(state.items.length ? 'fileShelf.trySearch' : 'fileShelf.emptyHint')}</p></div> : visibleItems.map((item) => (
          <div key={item.id} className={`shelf-item ${selected.includes(item.id) ? 'selected' : ''} ${!item.available ? 'unavailable' : ''}`} draggable={item.available && !busy} tabIndex={0} role="group" aria-label={item.name} onMouseDown={(event) => {
            if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !selected.includes(item.id)) { setSelected([item.id]); anchor.current = item.id; }
          }} onClick={(event) => select(item.id, event)} onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); setSelected((ids) => ids.includes(item.id) ? ids.filter((id) => id !== item.id) : [...ids, item.id]); anchor.current = item.id; }
          }} onDragStart={(event) => {
            event.preventDefault();
            const ids = selected.includes(item.id) ? selected : [item.id];
            if (state.items.some((entry) => ids.includes(entry.id) && !entry.available)) { setError(t('fileShelf.unavailableSelection')); return; }
            setNotice(''); setError(''); window.fileShelf.startDrag(ids);
          }}>
            <input type="checkbox" aria-label={t('fileShelf.selectItem', { name: item.name })} checked={selected.includes(item.id)} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onChange={(event) => { setSelected((ids) => event.target.checked ? [...new Set([...ids, item.id])] : ids.filter((id) => id !== item.id)); anchor.current = item.id; }} />
            <div className="shelf-file-icon">{item.iconDataUrl ? <img src={item.iconDataUrl} alt="" draggable={false} /> : item.kind === 'directory' ? <Folder size={27} /> : <File size={27} />}</div>
            <div className="shelf-file-details"><div className="shelf-file-name" title={item.name}>{item.name}</div><div className="shelf-file-path" title={item.path}>{item.path.slice(0, item.path.lastIndexOf('/')) || '/'}</div>{!item.available && <div className="shelf-file-warning">{t(item.unavailableReason === 'missing' ? 'fileShelf.missing' : 'fileShelf.unreadable')}</div>}</div>
            <button className="shelf-icon-button shelf-reveal" disabled={!item.available || busy} title={t('fileShelf.reveal')} aria-label={t('fileShelf.reveal')} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); void run(() => window.fileShelf.reveal(item.id)); }}><FolderOpen size={16} /></button>
          </div>
        ))}
      </section>

      <div className="shelf-feedback" aria-live="polite">{error ? <p className="shelf-error" role="alert">{error}</p> : notice ? <p className="shelf-notice">{notice}</p> : <p>{t('fileShelf.referenceHint')}</p>}</div>
      <footer className="shelf-footer">
        <button className="shelf-copy" disabled={!canTransfer} onClick={copy}><Copy size={15} />{t('fileShelf.copy')}<kbd>⌘C</kbd></button>
        <button className="shelf-icon-button" disabled={!selected.length || busy || Boolean(state.error)} title={t('fileShelf.remove')} aria-label={t('fileShelf.remove')} onClick={remove}><Trash2 size={16} /></button>
        <button className="shelf-clear" disabled={!state.items.length || busy || Boolean(state.error)} onClick={() => void run(() => window.fileShelf.clear(), t('fileShelf.removed'))}>{t('fileShelf.clear')}</button>
      </footer>
      {draggingOver && <div className="shelf-drop-overlay"><ArrowDownToLine size={36} /><strong>{t('fileShelf.dropHere')}</strong><span>{t('fileShelf.dropHint')}</span></div>}
    </main>
  );
}
