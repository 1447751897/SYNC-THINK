// Ambient declarations for shell asset imports (inlined as data URLs by esbuild).
// NOTE: this file must stay free of top-level import/export statements — any
// import/export would turn it into an external module and make these wildcard
// declarations scope-local instead of global, breaking `import logo from './assets/x.png'`.
declare module '*.png' {
  const src: string;
  export default src;
}

declare module '*.svg' {
  const src: string;
  export default src;
}
