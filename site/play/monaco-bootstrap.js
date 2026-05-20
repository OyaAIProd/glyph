// site/play/monaco-bootstrap.js
// Loads Monaco editor via its AMD loader from jsdelivr, then mounts a
// JSON-spec editor wired to Glyph's published JSON schema for autocomplete
// and inline validation. The AMD loader is the official path; trying to
// import Monaco as ESM doesn't work (the package ships its own loader).
const MONACO_VERSION = "0.45.0";
const MONACO_BASE = `https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min/vs`;

let _monacoPromise = null;

export function loadMonaco() {
  if (_monacoPromise) return _monacoPromise;
  _monacoPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${MONACO_BASE}/loader.js`;
    script.onerror = () => reject(new Error("monaco loader failed"));
    script.onload = () => {
      // The AMD loader defines a global `require`. We point it at the same
      // jsdelivr base so all monaco chunks (editor.main, language workers,
      // etc.) resolve from one CDN — no risk of mixed-version churn.
      window.require.config({ paths: { vs: MONACO_BASE } });
      window.require(["vs/editor/editor.main"], () => resolve(window.monaco));
    };
    document.head.appendChild(script);
  });
  return _monacoPromise;
}

export async function mountSpecEditor(host, initialValue, onChange) {
  const monaco = await loadMonaco();

  // Pull the Glyph JSON schema (copied next to this file by the bundle
  // build) so Monaco's built-in JSON language service gives us autocomplete
  // + red-squiggle validation against the published spec contract.
  const schema = await fetch("./spec.schema.json").then((r) => r.json());
  monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    schemas: [
      {
        uri: "https://glyph.dev/spec.schema.json",
        fileMatch: ["*"],
        schema,
      },
    ],
  });

  const editor = monaco.editor.create(host, {
    value: initialValue,
    language: "json",
    minimap: { enabled: false },
    fontSize: 13,
    scrollBeyondLastLine: false,
    wordWrap: "on",
    automaticLayout: true,
    theme: "vs",
  });

  editor.onDidChangeModelContent(() => {
    onChange(editor.getValue());
  });

  return editor;
}
