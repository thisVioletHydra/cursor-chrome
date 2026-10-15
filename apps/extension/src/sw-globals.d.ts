// Service worker global (the extension compiles with the DOM lib; WebWorker lib would clash with it).
declare var ServiceWorkerGlobalScope: { new (): unknown; prototype: unknown } | undefined;
