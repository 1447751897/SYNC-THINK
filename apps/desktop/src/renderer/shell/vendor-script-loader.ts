export interface VendorScriptLoaderOptions<T> {
  scriptSelector: string;
  scriptSource: string;
  markerAttribute: string;
  readVendor(): T | undefined;
  missingExportMessage: string;
  loadErrorMessage: string;
  beforeStart?(): void;
}

export interface VendorStylesheetOptions {
  selector: string;
  source: string;
  markerAttribute: string;
}

export function ensureVendorStylesheet(options: VendorStylesheetOptions): void {
  if (document.querySelector(options.selector)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL(options.source, window.location.href).href;
  link.setAttribute(options.markerAttribute, 'true');
  document.head.append(link);
}

export function createVendorScriptLoader<T>(options: VendorScriptLoaderOptions<T>): () => Promise<T> {
  let vendorPromise: Promise<T> | undefined;

  return () => {
    const loadedVendor = options.readVendor();
    if (loadedVendor) return Promise.resolve(loadedVendor);
    if (vendorPromise) return vendorPromise;

    options.beforeStart?.();
    vendorPromise = new Promise<T>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>(options.scriptSelector);
      const script = existing ?? document.createElement('script');
      const cleanupListeners = () => {
        script.removeEventListener('load', onLoad);
        script.removeEventListener('error', onError);
      };
      const onLoad = () => {
        cleanupListeners();
        const vendor = options.readVendor();
        if (vendor) {
          resolve(vendor);
        } else {
          script.remove();
          reject(new Error(options.missingExportMessage));
        }
      };
      const onError = () => {
        cleanupListeners();
        script.remove();
        reject(new Error(options.loadErrorMessage));
      };
      script.addEventListener('load', onLoad, { once: true });
      script.addEventListener('error', onError, { once: true });
      if (!existing) {
        script.src = new URL(options.scriptSource, window.location.href).href;
        script.async = true;
        script.setAttribute(options.markerAttribute, 'true');
        document.head.append(script);
      }
    }).catch((error: unknown) => {
      vendorPromise = undefined;
      throw error;
    });
    return vendorPromise;
  };
}
