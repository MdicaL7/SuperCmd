import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, File, Folder, FolderOpen, X } from 'lucide-react';
import { useI18n } from '../i18n';
import type { FileShelfItem, FileShelfResult, FileShelfSnapshot } from '../../../shared/file-shelf';
import './file-shelf.css';

const empty: FileShelfSnapshot = { items: [], alwaysOnTop: true, mode: 'shelf' };

export default function FileShelfApp(): React.ReactElement {
  const { t } = useI18n();
  const [state, setState] = useState<FileShelfSnapshot>(empty);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [draggingOver, setDraggingOver] = useState(false);
  const [notice, setNotice] = useState('');
  const dragDepth = useRef(0);
  const operationActive = useRef(false);

  const applySnapshot = useCallback((snapshot: FileShelfSnapshot) => {
    setState(snapshot);
    setSelected((ids) => ids.filter((id) => snapshot.items.some((item) => item.id === id)));
  }, []);

  useEffect(() => {
    let disposed = false;
    const update = (snapshot: FileShelfSnapshot) => { if (!disposed) applySnapshot(snapshot); };
    window.fileShelf.getState().then(update).catch(() => {});
    const stopChanges = window.fileShelf.onChanged(update);
    const stopErrors = window.fileShelf.onError((message) => {
      if (!disposed) {
        setNotice(message);
        setTimeout(() => setNotice(''), 3500);
      }
    });
    return () => { disposed = true; stopChanges(); stopErrors(); };
  }, [applySnapshot]);

  const run = useCallback(async (operation: () => Promise<FileShelfResult>) => {
    if (operationActive.current) return;
    operationActive.current = true;
    setBusy(true);
    try {
      const result = await operation();
      if (!result.ok && result.error) {
        setNotice(result.error);
        setTimeout(() => setNotice(''), 3500);
      }
      applySnapshot(await window.fileShelf.getState());
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : String(reason));
      setTimeout(() => setNotice(''), 3500);
    } finally {
      setBusy(false);
      operationActive.current = false;
    }
  }, [applySnapshot]);

  // Keyboard shortcuts (Esc, Cmd+C, Delete, Cmd+A)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (state.mode === 'target') {
          void window.fileShelf.cancelTarget();
        } else {
          void window.fileShelf.hide();
        }
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        const idsToCopy = selected.length > 0 ? selected : state.items.map((i) => i.id);
        if (idsToCopy.length > 0) {
          void run(() => window.fileShelf.copy(idsToCopy));
        }
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        if (selected.length > 0) {
          void run(() => window.fileShelf.remove(selected));
        }
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        setSelected(state.items.map((i) => i.id));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [run, selected, state.items, state.mode]);

  // Selection
  const handleItemClick = (id: string, event: React.MouseEvent) => {
    event.stopPropagation();
    if (event.metaKey || event.ctrlKey) {
      setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    } else {
      setSelected([id]);
    }
  };

  // Drag Out
  const handleDragStart = (item: FileShelfItem, event: React.DragEvent) => {
    event.preventDefault();
    if (!item.available) return;
    const idsToDrag = selected.includes(item.id) && selected.length > 1 ? selected : [item.id];
    window.fileShelf.startDrag(idsToDrag);
  };

  // Context Menu
  const handleContextMenu = (itemId?: string) => (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    void window.fileShelf.showContextMenu(itemId);
  };

  // Drop Target Mode (During Active Drag + Shake)
  if (state.mode === 'target') {
    return (
      <main
        className={`file-shelf-target ${draggingOver ? 'drag-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          if (Array.from(e.dataTransfer.types).includes('Files')) {
            dragDepth.current++;
            setDraggingOver(true);
          }
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (!dragDepth.current) setDraggingOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          dragDepth.current = 0;
          setDraggingOver(false);
          const files = Array.from(e.dataTransfer.files);
          void run(() => window.fileShelf.addFiles(files));
        }}
        onClick={() => void window.fileShelf.cancelTarget()}
      >
        <div className="target-capsule">
          <div className="target-icon">
            <ArrowDownToLine size={26} strokeWidth={2} />
          </div>
          <span className="target-text">{t('fileShelf.dropHere')}</span>
          <span className="target-subtext">{t('fileShelf.dropHint')}</span>
        </div>
      </main>
    );
  }

  // Shelf Mode (Compact Floating Tray)
  return (
    <main
      className={`file-shelf-compact ${draggingOver ? 'shelf-drag-over' : ''}`}
      onContextMenu={handleContextMenu()}
      onClick={() => setSelected([])}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        if (Array.from(e.dataTransfer.types).includes('Files')) {
          dragDepth.current++;
          setDraggingOver(true);
        }
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDraggingOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setDraggingOver(false);
        const files = Array.from(e.dataTransfer.files);
        void run(() => window.fileShelf.addFiles(files));
      }}
    >
      <header className="shelf-header">
        <div className="shelf-drag-handle">
          <span className="shelf-title">{t('fileShelf.title')}</span>
          {state.items.length > 0 && (
            <span className="shelf-badge">{state.items.length}</span>
          )}
        </div>
        <button
          className="shelf-close-btn"
          aria-label="Close"
          title="Esc"
          onClick={(e) => {
            e.stopPropagation();
            void window.fileShelf.hide();
          }}
        >
          <X size={13} />
        </button>
      </header>

      {notice && <div className="shelf-toast">{notice}</div>}

      <div className="shelf-content">
        {state.items.length === 0 ? (
          <div className="shelf-empty-tray">
            <FolderOpen size={24} className="empty-icon" />
            <p>{t('fileShelf.dropHere')}</p>
          </div>
        ) : (
          <div className={`shelf-grid count-${Math.min(state.items.length, 6)}`}>
            {state.items.map((item) => {
              const isSelected = selected.includes(item.id);
              return (
                <div
                  key={item.id}
                  className={`shelf-item-card ${isSelected ? 'is-selected' : ''} ${!item.available ? 'is-unavailable' : ''}`}
                  draggable={item.available && !busy}
                  onClick={(e) => handleItemClick(item.id, e)}
                  onContextMenu={handleContextMenu(item.id)}
                  onDragStart={(e) => handleDragStart(item, e)}
                  title={item.name}
                  tabIndex={0}
                >
                  <div className="item-thumbnail">
                    {item.iconDataUrl ? (
                      <img src={item.iconDataUrl} alt="" draggable={false} />
                    ) : item.kind === 'directory' ? (
                      <Folder size={26} />
                    ) : (
                      <File size={26} />
                    )}
                  </div>
                  <span className="item-name">{item.name}</span>
                  {!item.available && (
                    <span className="item-unavailable-dot" title={t('fileShelf.missing')} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {draggingOver && (
        <div className="shelf-drop-scrim">
          <ArrowDownToLine size={24} />
          <span>{t('fileShelf.dropHere')}</span>
        </div>
      )}
    </main>
  );
}
