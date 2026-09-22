export type TranslationTarget = 'zh-Hans' | 'en';
export type TranslationSource = 'manual' | 'selection' | 'screenshot';
export type TranslationPhase = 'idle' | 'capturing' | 'translating' | 'done' | 'cancelled' | 'error';
export type TranslationError = 'no-selection' | 'no-text' | 'not-configured' | 'capture-failed' | 'request-failed' | 'empty-result';

export interface TranslationInput {
  text: string;
  source: TranslationSource;
  /** Transfers one capture reference to the translation feature. */
  captureId?: string;
}

export interface TranslationSnapshot {
  revision: number;
  sourceVersion: number;
  source: TranslationSource;
  text: string;
  target: TranslationTarget;
  result: string;
  phase: TranslationPhase;
  error?: TranslationError;
  detail?: string;
}

export interface TranslationAPI {
  getState(): Promise<TranslationSnapshot>;
  translate(text: string, target: TranslationTarget): Promise<void>;
  cancel(): Promise<void>;
  close(): Promise<void>;
  copy(): Promise<void>;
  openSettings(): Promise<void>;
  onState(callback: (state: TranslationSnapshot) => void): () => void;
}

declare global {
  interface Window { translationAPI: TranslationAPI }
}
