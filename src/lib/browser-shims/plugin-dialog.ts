type OpenOptions = {
  directory?: boolean;
  multiple?: boolean;
  filters?: Array<{ name: string; extensions: string[] }>;
};

export async function open(opts: OpenOptions = {}): Promise<string | string[] | null> {
  if (opts.directory) {
    const stub = '/Users/you/Documents/Finance Statements';
    console.warn('[browser-shim/dialog] directory picker stubbed →', stub);
    return opts.multiple ? [stub] : stub;
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (opts.multiple) input.multiple = true;
    if (opts.filters?.length) {
      input.accept = opts.filters
        .flatMap((f) => f.extensions.map((e) => (e.startsWith('.') ? e : `.${e}`)))
        .join(',');
    }
    input.onchange = () => {
      const files = Array.from(input.files ?? []);
      if (files.length === 0) {
        resolve(null);
        return;
      }
      const paths = files.map((f) => f.name);
      resolve(opts.multiple ? paths : (paths[0] ?? null));
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export async function save(opts: { defaultPath?: string } = {}): Promise<string | null> {
  const stub = opts.defaultPath ?? '/Users/you/Downloads/export.csv';
  console.warn('[browser-shim/dialog] save dialog stubbed →', stub);
  return stub;
}

export async function message(msg: string): Promise<void> {
  window.alert(msg);
}

export async function confirm(msg: string): Promise<boolean> {
  return window.confirm(msg);
}

export async function ask(msg: string): Promise<boolean> {
  return window.confirm(msg);
}
