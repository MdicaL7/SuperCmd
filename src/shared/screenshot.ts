/** Capture IDs are owned references. Consumers release each acquired reference. */
export type CaptureMode = 'region' | 'window' | 'fullscreen';
export interface CaptureArtifact {
  id: string;
  previewDataUrl: string;
  width: number;
  height: number;
}
export type CaptureFailure = { status: 'cancelled' } | { status: 'error'; message: string };
export type CaptureResult = { status: 'ok'; artifact: CaptureArtifact } | CaptureFailure;
export type CaptureOCRResult = { status: 'ok'; artifact: CaptureArtifact; text: string } | CaptureFailure;
export type ScreenshotActionResult = { status: 'ok'; text?: string } | CaptureFailure;
export interface ScreenshotAPI {
  getCurrent(): Promise<{ artifact: CaptureArtifact; pinned: boolean } | null>;
  copy(): Promise<ScreenshotActionResult>;
  save(): Promise<ScreenshotActionResult>;
  pin(): Promise<ScreenshotActionResult>;
  recognize(): Promise<ScreenshotActionResult>;
  translate(): Promise<ScreenshotActionResult>;
  close(): void;
  zoom(factor: number): void;
}
