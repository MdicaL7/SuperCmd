import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import type { FileShelfItem, FileShelfResult, FileShelfSnapshot } from '../../../shared/file-shelf';
import './file-shelf.css';

const empty: FileShelfSnapshot = { items: [], alwaysOnTop: true, mode: 'shelf' };

function isImageFile(fileName: string): boolean {
  return /\.(jpe?g|png|gif|webp|bmp|heic|tiff?)$/i.test(fileName);
}

function getItemCountLabel(items: FileShelfItem[]): string {
  const count = items.length;
  if (count === 0) return '0 Items';
  if (items.every((i) => isImageFile(i.name))) {
    return `${count} ${count === 1 ? 'Image' : 'Images'}`;
  }
  if (items.every((i) => i.kind === 'directory')) {
    return `${count} ${count === 1 ? 'Folder' : 'Folders'}`;
  }
  return `${count} ${count === 1 ? 'Item' : 'Items'}`;
}

export default function FileShelfApp(): React.ReactElement {
  const [state, setState] = useState<FileShelfSnapshot>(empty);
  const [draggingOver, setDraggingOver] = useState(false);
  const dragDepth = useRef(0);
  const operationActive = useRef(false);

  const applySnapshot = useCallback((snapshot: FileShelfSnapshot) => {
    setState(snapshot);
  }, []);

  useEffect(() => {
    let disposed = false;
    const update = (snapshot: FileShelfSnapshot) => { if (!disposed) applySnapshot(snapshot); };
    window.fileShelf.getState().then(update).catch(() => {});
    const stopChanges = window.fileShelf.onChanged(update);
    const stopErrors = window.fileShelf.onError((_message) => {
      // Intentionally suppress visual error banners on the shelf
      console.warn('[FileShelf error]', _message);
    });
    return () => { disposed = true; stopChanges(); stopErrors(); };
  }, [applySnapshot]);

  const run = useCallback(async (operation: () => Promise<FileShelfResult>) => {
    if (operationActive.current) return;
    operationActive.current = true;
    try {
      await operation();
      applySnapshot(await window.fileShelf.getState());
    } catch (reason) {
      console.error('[FileShelf]', reason);
    } finally {
      operationActive.current = false;
    }
  }, [applySnapshot]);

  // Global Keyboard shortcuts (Esc, Cmd+C, Delete, Backspace)
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
        const idsToCopy = state.items.map((i) => i.id);
        if (idsToCopy.length > 0) {
          void run(() => window.fileShelf.copy(idsToCopy));
        }
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        if (state.items.length > 0) {
          void run(() => window.fileShelf.clear());
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [run, state.items, state.mode]);

  // Handle Drag & Drop of incoming files
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    if (Array.from(e.dataTransfer.types).includes('Files')) {
      dragDepth.current++;
      setDraggingOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDraggingOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDraggingOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      void run(() => window.fileShelf.addFiles(files));
    }
  };

  // Drag Out: Drag the stack of files out to Finder or other apps
  const handlePileDragStart = (e: React.DragEvent) => {
    e.preventDefault();
    const available = state.items.filter((i) => i.available);
    if (available.length > 0) {
      window.fileShelf.startDrag(available.map((i) => i.id));
    }
  };

  // Context Menu
  const handleContextMenu = (itemId?: string) => (event?: React.MouseEvent) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    void window.fileShelf.showContextMenu(itemId);
  };

  // 1. Drop Target Mode (Initial Shake Gesture Target)
  // Per user requirement: "不需要任何的文字和图标，只需要一个优雅的框"
  if (state.mode === 'target') {
    return (
      <main
        className={`file-shelf-target ${draggingOver ? 'drag-over' : ''}`}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => void window.fileShelf.cancelTarget()}
      />
    );
  }

  // 2. Shelf Mode (Dropover 1:1 Floating Card Pile)
  const items = state.items;
  const displayItems = items.slice(-3);

  return (
    <main
      className={`file-shelf-dropover ${draggingOver ? 'drag-over' : ''}`}
      onContextMenu={handleContextMenu()}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Top Action Buttons */}
      <div className="shelf-top-bar">
        <button
          className="shelf-circle-btn close-btn"
          aria-label="Close"
          title="Close (Esc)"
          onClick={(e) => {
            e.stopPropagation();
            void window.fileShelf.hide();
          }}
        >
          <X size={12} strokeWidth={2.5} />
        </button>

        <button
          className="shelf-circle-btn more-btn"
          aria-label="Actions"
          title="More options"
          onClick={(e) => {
            e.stopPropagation();
            void window.fileShelf.showContextMenu();
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="4" cy="12" r="2.5" />
            <circle cx="12" cy="12" r="2.5" />
            <circle cx="20" cy="12" r="2.5" />
          </svg>
        </button>
      </div>

      {/* Center Stacked Pile */}
      <div
        className="shelf-pile-container"
        draggable={items.length > 0}
        onDragStart={handlePileDragStart}
        onContextMenu={handleContextMenu(displayItems[displayItems.length - 1]?.id)}
        title={items.length > 0 ? 'Drag out to Finder or other apps' : undefined}
      >
        {items.length === 0 ? null : (
          <div className={`pile-stack stack-${displayItems.length}`}>
            {displayItems.map((item, index) => {
              const positionClass =
                displayItems.length === 1
                  ? 'pos-single'
                  : displayItems.length === 2
                  ? index === 0 ? 'pos-back' : 'pos-front'
                  : index === 0 ? 'pos-left' : index === 1 ? 'pos-right' : 'pos-front';

              return (
                <div key={item.id} className={`polaroid-card ${positionClass}`}>
                  <div className="polaroid-inner">
                    {item.iconDataUrl ? (
                      <img src={item.iconDataUrl} alt={item.name} draggable={false} />
                    ) : (
                      <div className="polaroid-fallback">
                        <span className="file-ext">{item.name.split('.').pop() || 'FILE'}</span>
                      </div>
                    )}
                  </div>
                  {!item.available && <span className="unavailable-dot" />}
                </div>
              );
            })}

            {/* Red count badge when dragging files over, matching Dropover screenshot */}
            {draggingOver && (
              <div className="pile-drag-badge">
                {items.length + 1}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Capsule Counter */}
      <div className="shelf-bottom-bar">
        {items.length > 0 && (
          <button
            className="shelf-pill-btn"
            onClick={(e) => {
              e.stopPropagation();
              void window.fileShelf.showContextMenu();
            }}
          >
            <span className="pill-text">{getItemCountLabel(items)}</span>
            <ChevronDown size={11} strokeWidth={2.5} />
          </button>
        )}
      </div>
    </main>
  );
}
