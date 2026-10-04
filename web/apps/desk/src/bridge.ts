// The window's link to its governing service. In the desktop app the address and the per-launch
// desk token come from the native side; in a browser (development, tests) from ?api=&token=.

interface TauriGlobal {
  core: {
    invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
  };
  webview: {
    getCurrentWebview: () => {
      onDragDropEvent: (
        handler: (event: {
          payload: { type: string; paths?: string[] };
        }) => void,
      ) => Promise<() => void>;
    };
  };
}

declare global {
  interface Window {
    __TAURI__?: TauriGlobal;
  }
}

export interface PickedFile {
  name: string;
  size: number;
  content_base64: string;
}

export const native = (): TauriGlobal | undefined => window.__TAURI__;

export async function bootstrap(): Promise<{ api: string; token: string }> {
  const tauri = native();
  if (tauri) return tauri.core.invoke("bootstrap");
  const params = new URLSearchParams(location.search);
  const api = params.get("api") ?? "http://127.0.0.1:8097";
  const token =
    params.get("token") ?? sessionStorage.getItem("betsee-desk-token") ?? "";
  sessionStorage.setItem("betsee-desk-token", token);
  return { api, token };
}

let base = "";
let token = "";

export function configure(next: { api: string; token: string }) {
  base = next.api;
  token = next.token;
}

/** fetch() against the governing service; same-origin API paths are re-pointed to it. */
export const deskFetch: typeof fetch = async (input, init) => {
  const request = new Request(input instanceof URL ? input.href : input, init);
  const url = new URL(request.url);
  const target =
    url.origin === location.origin
      ? `${base}${url.pathname}${url.search}`
      : request.url;
  const headers = new Headers(request.headers);
  headers.set("x-desk-token", token);
  headers.delete("authorization");
  const body = ["GET", "HEAD"].includes(request.method)
    ? undefined
    : await request.arrayBuffer();
  return fetch(target, {
    method: request.method,
    headers,
    body,
    signal: request.signal,
  });
};

export async function desk<T>(path: string, body?: unknown): Promise<T> {
  const response = await deskFetch(`${location.origin}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const value = text ? JSON.parse(text) : undefined;
  if (!response.ok)
    throw new Error(value?.message ?? `HTTP ${response.status}`);
  return value as T;
}

export async function openSignIn() {
  const tauri = native();
  if (tauri) await tauri.core.invoke("open_sign_in");
  else window.open(`${base}/desk/login`, "_blank", "noopener");
}

export async function openExternal(url: string) {
  const tauri = native();
  if (tauri) await tauri.core.invoke("open_external", { url });
  else window.open(url, "_blank", "noopener");
}

function readInBrowser(file: File): Promise<PickedFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`${file.name} could not be read`));
    reader.onload = () => {
      const data = String(reader.result);
      resolve({
        name: file.name,
        size: file.size,
        content_base64: data.slice(data.indexOf(",") + 1),
      });
    };
    reader.readAsDataURL(file);
  });
}

/** Native file picker in the app; a hidden file input in a browser. */
export async function pickFiles(): Promise<{
  files: PickedFile[];
  errors: string[];
}> {
  const tauri = native();
  if (tauri) {
    const results =
      await tauri.core.invoke<Array<{ Ok?: PickedFile; Err?: string }>>(
        "pick_files",
      );
    return split(results);
  }
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  const chosen = await new Promise<File[]>((resolve) => {
    input.onchange = () => resolve([...(input.files ?? [])]);
    input.click();
  });
  return readFiles(chosen);
}

export async function readFiles(
  files: File[],
): Promise<{ files: PickedFile[]; errors: string[] }> {
  const settled = await Promise.allSettled(files.map(readInBrowser));
  return {
    files: settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : [])),
    errors: settled.flatMap((r) =>
      r.status === "rejected" ? [String(r.reason?.message ?? r.reason)] : [],
    ),
  };
}

function split(results: Array<{ Ok?: PickedFile; Err?: string }>) {
  return {
    files: results.flatMap((r) => (r.Ok ? [r.Ok] : [])),
    errors: results.flatMap((r) => (r.Err ? [r.Err] : [])),
  };
}

export async function readDropped(paths: string[]) {
  const tauri = native();
  if (!tauri) return { files: [], errors: [] };
  return split(await tauri.core.invoke("read_dropped", { paths }));
}

/** Native save dialog in the app; a download link in a browser. */
export async function saveFile(
  name: string,
  contentBase64: string,
): Promise<string | null> {
  const tauri = native();
  if (tauri) return tauri.core.invoke("save_file", { name, contentBase64 });
  const link = document.createElement("a");
  link.href = `data:application/octet-stream;base64,${contentBase64}`;
  link.download = name;
  link.click();
  return name;
}
