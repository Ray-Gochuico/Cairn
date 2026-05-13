// Browser-shim for Node's `os` module, aliased in vite.config.ts.
//
// `yahoo-finance2` transitively imports `@deno/shim-deno`, which calls
// `os.platform()` at module load. In the Tauri WebView there is no Node
// runtime, so Vite externalises `os` to an empty object and the call
// throws "os.platform is not a function". yahoo-finance2 itself doesn't
// use the filesystem at runtime — it only needs the shim's init to
// succeed so the package is callable — so a permissive stub is enough.
//
// Values here are deliberately conservative: "browser" platform string,
// empty arrays for collection getters, '/' for path-like fields. Nothing
// downstream branches on these in the snapshot-derivation code path; if
// anything ever does, we'll know because tests will fail.

export const EOL = '\n';
export const platform = () => 'browser';
export const arch = () => 'x64';
export const cpus = () => [];
export const endianness = () => 'LE' as const;
export const freemem = () => 0;
export const totalmem = () => 0;
export const homedir = () => '/';
export const hostname = () => 'localhost';
export const loadavg = () => [0, 0, 0];
export const networkInterfaces = () => ({});
export const release = () => '';
export const tmpdir = () => '/tmp';
export const type = () => 'Linux';
export const uptime = () => 0;
export const userInfo = () => ({
  username: 'user',
  uid: 0,
  gid: 0,
  shell: null,
  homedir: '/',
});
export const version = () => '';

const osShim = {
  EOL,
  platform,
  arch,
  cpus,
  endianness,
  freemem,
  totalmem,
  homedir,
  hostname,
  loadavg,
  networkInterfaces,
  release,
  tmpdir,
  type,
  uptime,
  userInfo,
  version,
};

export default osShim;
