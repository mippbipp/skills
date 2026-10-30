import { StrictMode, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { CaptureUpdateAction, Excalidraw, restoreElements, serializeAsJSON } from '@excalidraw/excalidraw';
import type { ExcalidrawElement, OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI, ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types';
import '@excalidraw/excalidraw/index.css';
import { layoutIssues } from '../../layout.mjs';

const SAVE_DELAY = 600;

declare global {
  interface Window {
    // Exposed for automated checks (layout legibility, screenshots); not used by the page.
    atlasSketchApi?: ExcalidrawImperativeAPI;
    atlasLayoutIssues?: () => string[];
  }
}
window.atlasLayoutIssues = () => layoutIssues(window.atlasSketchApi?.getSceneElements() ?? []);

// atlas.excalidraw as build.mjs and this editor write it.
interface SceneFile {
  type: 'excalidraw';
  elements: ExcalidrawElement[];
  appState?: Partial<AppState>;
  files?: BinaryFiles;
}

type Versions = Map<string, number>;

const fetchScene = async (): Promise<SceneFile> => {
  const res = await fetch('/scene', { cache: 'no-store' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};

const versionsOf = (elements: readonly ExcalidrawElement[]): Versions => new Map(elements.map((e) => [e.id, e.version]));

// Saving only cares about content, not selection or scroll.
const contentKey = (elements: readonly ExcalidrawElement[], files: BinaryFiles | undefined) =>
  elements.map((e) => `${e.id}:${e.version}:${e.isDeleted ? 1 : 0}`).join(',') + '|' + Object.keys(files ?? {}).sort().join(',');

// Combine a rebuilt scene with unsaved local edits: per element the higher version wins.
// A local-only element is dropped if the remote used to have it (the build removed it),
// unless it was edited locally since.
function merge(local: readonly ExcalidrawElement[], remote: readonly ExcalidrawElement[], lastRemote: Versions): ExcalidrawElement[] {
  const out = new Map(remote.map((e) => [e.id, e]));
  for (const e of local) {
    const r = out.get(e.id);
    if (r) {
      if (e.version > r.version) out.set(e.id, e);
    } else if (!lastRemote.has(e.id) || e.version > (lastRemote.get(e.id) ?? 0)) {
      out.set(e.id, e);
    }
  }
  return [...out.values()];
}

// Save status lives outside App so updating it never re-renders the Excalidraw tree.
const status = (() => {
  let value = 'loaded';
  const subs = new Set<() => void>();
  return {
    set: (v: string) => {
      if (v === value) return;
      value = v;
      subs.forEach((f) => f());
    },
    get: () => value,
    subscribe: (f: () => void) => {
      subs.add(f);
      return () => void subs.delete(f);
    },
  };
})();
const setStatus = status.set;

function TopRight() {
  const value = useSyncExternalStore(status.subscribe, status.get);
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontFamily: 'system-ui', fontSize: 13 }}>
      <span role="status" aria-live="polite">{value}</span>
      <a href="/atlas.html" target="_blank" rel="noreferrer">Open atlas</a>
    </div>
  );
}
const renderTopRightUI = () => <TopRight />;

// What the agent will read on "updated diagram": fold.mjs's list for the saved sketch.
interface FoldItem { n: number; text: string; elements: string[] }
interface FoldState { stale: boolean; items: FoldItem[]; error?: string }

const panelStyle = {
  position: 'fixed', right: 16, bottom: 64, zIndex: 10, width: 320, maxHeight: '45vh', overflow: 'auto',
  background: 'rgba(255,255,255,0.96)', color: '#1b1b1f', border: '1px solid #d0d0d7', borderRadius: 8,
  boxShadow: '0 2px 10px rgba(0,0,0,0.12)', fontFamily: 'system-ui', fontSize: 13, lineHeight: 1.4,
} as const;

function select(ids: string[]) {
  const a = window.atlasSketchApi;
  if (!a) return;
  const els = a.getSceneElements().filter((e) => ids.includes(e.id));
  if (!els.length) return;
  a.updateScene({ appState: { selectedElementIds: Object.fromEntries(els.map((e) => [e.id, true] as const)) }, captureUpdate: CaptureUpdateAction.NEVER });
  a.scrollToContent(els, { animate: true });
}

function FoldPanel() {
  const [fold, setFold] = useState<FoldState | null>(null);
  const [open, setOpen] = useState(true);
  const saving = useSyncExternalStore(status.subscribe, () => status.get() === 'edited' || status.get() === 'saving…');

  useEffect(() => {
    const load = () =>
      fetch('/fold', { cache: 'no-store' })
        .then(async (r) => (r.ok ? r.json() : { stale: false, items: [], error: await r.text() }))
        .then(setFold, (e: unknown) => setFold({ stale: false, items: [], error: String(e) }));
    load();
    const events = new EventSource('/events');
    events.addEventListener('fold', load);
    events.addEventListener('scene', load);
    return () => events.close();
  }, []);

  const count = fold?.items.length ?? 0;
  return (
    <aside aria-label="Sketch edits the agent will see" style={panelStyle}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%', boxSizing: 'border-box', padding: '8px 12px', fontWeight: 600 }}
      >
        <span aria-live="polite">
          {count ? `${count} edit${count === 1 ? '' : 's'} for the agent` : 'No edits for the agent yet'}
          {saving ? ' (saving…)' : ''}
        </span>
        <span aria-hidden="true" style={{ float: 'right' }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div style={{ padding: '0 12px 10px' }}>
          {fold?.error && <p role="alert" style={{ margin: '4px 0', color: '#b42318' }}>{fold.error}</p>}
          {fold?.stale && <p style={{ margin: '4px 0', color: '#8a5a00' }}>data.mjs changed since the last build; the agent rebuilds before folding.</p>}
          {count > 0 && (
            <ol style={{ margin: 0, paddingLeft: 20 }}>
              {fold?.items.map((it) => (
                <li key={it.n} style={{ margin: '4px 0' }}>
                  <button
                    type="button"
                    onClick={() => select(it.elements)}
                    title="Select on the canvas"
                    style={{ all: 'unset', cursor: 'pointer', overflowWrap: 'anywhere' }}
                  >
                    {it.text}
                  </button>
                </li>
              ))}
            </ol>
          )}
          <p style={{ margin: '8px 0 0', color: '#5b5b66' }}>
            Say “updated diagram” to the agent to fold these. Answer a question with a note like <code>Q-B1: …</code>.
          </p>
        </div>
      )}
    </aside>
  );
}

function App() {
  const [initial, setInitial] = useState<ExcalidrawInitialDataState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const api = useRef<ExcalidrawImperativeAPI | null>(null);
  const setApi = useCallback((a: ExcalidrawImperativeAPI) => {
    api.current = a;
    window.atlasSketchApi = a;
  }, []);
  const savedKey = useRef('');
  const lastRemote = useRef<Versions>(new Map());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    fetchScene()
      .then((scene) => {
        lastRemote.current = versionsOf(scene.elements);
        savedKey.current = contentKey(scene.elements, scene.files);
        setInitial({ elements: scene.elements, appState: { ...scene.appState, collaborators: new Map() }, files: scene.files, scrollToContent: true });
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const save = useCallback(async () => {
    const a = api.current;
    if (!a) return;
    const elements = a.getSceneElements();
    const files = a.getFiles();
    const key = contentKey(elements, files);
    if (key === savedKey.current) return;
    setStatus('saving…');
    const body = serializeAsJSON(elements, a.getAppState(), files, 'local');
    const res = await fetch('/scene', { method: 'PUT', headers: { 'content-type': 'application/json' }, body });
    if (!res.ok) return setStatus(`save failed: ${await res.text()}`);
    savedKey.current = key;
    lastRemote.current = versionsOf(elements);
    setStatus('saved');
  }, []);

  const onChange = useCallback(
    (elements: readonly OrderedExcalidrawElement[], _appState: AppState, files: BinaryFiles) => {
      if (contentKey(elements, files) === savedKey.current) return;
      setStatus('edited');
      clearTimeout(timer.current);
      timer.current = setTimeout(save, SAVE_DELAY);
    },
    [save],
  );

  // Live reload when build.mjs or fold.mjs rewrites the file.
  useEffect(() => {
    if (!initial) return;
    const events = new EventSource('/events');
    events.addEventListener('scene', async () => {
      const a = api.current;
      if (!a) return;
      const scene = await fetchScene();
      const merged = merge(a.getSceneElementsIncludingDeleted(), scene.elements, lastRemote.current);
      lastRemote.current = versionsOf(scene.elements);
      savedKey.current = contentKey(scene.elements, scene.files);
      if (scene.files) a.addFiles(Object.values(scene.files));
      a.updateScene({ elements: restoreElements(merged, null), captureUpdate: CaptureUpdateAction.NEVER });
      setStatus('reloaded from disk');
    });
    return () => events.close();
  }, [initial]);

  if (error) return <p role="alert" style={{ padding: 24, fontFamily: 'system-ui' }}>Could not load the sketch: {error}</p>;
  if (!initial) return <p style={{ padding: 24, fontFamily: 'system-ui' }}>Loading sketch…</p>;

  return (
    <>
      <Excalidraw
        excalidrawAPI={setApi}
        initialData={initial}
        onChange={onChange}
        name="atlas"
        renderTopRightUI={renderTopRightUI}
      />
      <FoldPanel />
    </>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('#root missing from index.html');
createRoot(root).render(
  import.meta.env.DEV ? (
    <StrictMode>
      <App />
    </StrictMode>
  ) : (
    <App />
  ),
);
