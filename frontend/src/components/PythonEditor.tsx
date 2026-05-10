'use client';

import React, { useState, useEffect, useRef } from 'react';
import Editor, { Monaco } from '@monaco-editor/react';

interface ExecuteResponse {
  stdout: string;
  images: string[];
  error?: string;
  success: boolean;
}

const PythonEditor: React.FC = () => {
  const [files, setFiles] = useState<string[]>([]);
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [code, setCode] = useState<string>('import matplotlib.pyplot as plt\nprint("Select a file or start coding!")');
  const [output, setOutput] = useState<string>('');
  const [images, setImages] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [isModified, setIsModified] = useState<boolean>(false);
  const monacoRef = useRef<Monaco | null>(null);
  const currentFileRef = useRef<string | null>(null);
  const codeRef = useRef<string>(code);

  // Keep refs in sync with state to avoid stale closures in Monaco commands
  useEffect(() => {
    currentFileRef.current = currentFile;
  }, [currentFile]);

  useEffect(() => {
    codeRef.current = code;
  }, [code]);

  const handleEditorWillMount = (monaco: Monaco) => {
    monacoRef.current = monaco;
    
    // Register custom completion provider for Python
    monaco.languages.registerCompletionItemProvider('python', {
      provideCompletionItems: async (model, position) => {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn
        };

        const codeText = model.getValue();
        try {
          const res = await fetch('/api/python/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              code: codeText,
              line: position.lineNumber,
              column: position.column - 1,
              filename: currentFileRef.current || 'current_script.py'
            })
          });
          const data = await res.json();
          
          const suggestions = (data.completions || []).map((c: any) => ({
            label: c.label,
            kind: monaco.languages.CompletionItemKind[c.kind.charAt(0).toUpperCase() + c.kind.slice(1)] || monaco.languages.CompletionItemKind.Property,
            detail: c.detail,
            documentation: c.documentation,
            insertText: c.insertText,
            range: range
          }));

          return { suggestions };
        } catch (err) {
          return { suggestions: [] };
        }
      }
    });
  };

  useEffect(() => {
    fetchFiles();
  }, []);

  const fetchFiles = async () => {
    try {
      const res = await fetch('/api/python/files');
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Server returned ${res.status}: ${text}`);
      }
      const data = await res.json();
      setFiles(Array.isArray(data.files) ? data.files : []);
    } catch (err) {
      console.error('Failed to fetch files:', err);
      setFiles([]);
    }
  };

  const handleFileSelect = async (filename: string) => {
    if (filename.endsWith('.png')) {
      setCurrentFile(filename);
      // For PNG, we just display it, no need to load into editor
      setImages([`/api/python/files/raw/${filename}?t=${Date.now()}`]);
      setOutput(`Viewing image: ${filename}`);
      return;
    }

    if (isModified && !confirm('Changes may be lost. Continue?')) return;
    
    try {
      const res = await fetch(`/api/python/files/${filename}`);
      const data = await res.json();
      setCurrentFile(filename);
      setCode(data.content);
      setIsModified(false);
      setOutput(`Loaded file: ${filename}`);
      setImages([]);
    } catch (err) {
      alert('Failed to load file');
    }
  };

  const handleSave = async (contentToSave?: string) => {
    // Use ref to get the latest filename
    const filename = currentFileRef.current || prompt('Enter filename (e.g. script.py):');
    if (!filename) return;
    
    const finalFilename = filename.endsWith('.py') ? filename : `${filename}.py`;
    
    setSaving(true);
    try {
      const res = await fetch('/api/python/files/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: finalFilename, content: contentToSave || codeRef.current }),
      });
      if (res.ok) {
        setCurrentFile(finalFilename);
        setIsModified(false);
        fetchFiles();
      }
    } catch (err) {
      alert('Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleEditorDidMount = (editor: any) => {
    // Add Ctrl+S (Cmd+S on Mac) save command
    editor.addCommand(window.monaco.KeyMod.CtrlCmd | window.monaco.KeyCode.KeyS, () => {
      const currentContent = editor.getValue();
      handleSave(currentContent);
    });
  };

  const handleExecute = async () => {
    setLoading(true);
    setOutput('');
    setImages([]);
    try {
      const response = await fetch('/api/python/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code }),
      });

      const data: ExecuteResponse = await response.json();
      if (data.success) {
        setOutput(data.stdout || 'Execution finished (no output).');
        setImages(data.images);
      } else {
        setOutput(`Error: ${data.error}\n\n${data.stdout}`);
      }
    } catch (err) {
      setOutput(`Failed to connect to Python backend: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex w-full gap-4 text-black h-[800px]">
      {/* File Explorer */}
      <div className="w-64 flex flex-col border border-gray-300 rounded-lg bg-gray-50 overflow-hidden">
        <div className="p-3 border-b bg-gray-100 font-bold flex justify-between items-center">
          <span>Files</span>
          <button 
            onClick={() => { setCurrentFile(null); setCode(''); setIsModified(false); }}
            className="text-xs bg-white border px-2 py-1 rounded hover:bg-gray-50"
          >
            New
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {files.map(f => (
            <div 
              key={f} 
              onClick={() => handleFileSelect(f)}
              className={`p-2 px-3 cursor-pointer truncate hover:bg-blue-100 transition-colors border-l-4 ${
                currentFile === f ? 'bg-blue-50 border-blue-500 font-semibold' : 'border-transparent'
              }`}
            >
              {f}
            </div>
          ))}
        </div>
      </div>

      {/* Main Editor & Results */}
      <div className="flex-1 flex flex-col gap-4 overflow-hidden">
        <div className="flex flex-col border border-gray-300 rounded-lg overflow-hidden h-[500px]">
          <div className="bg-gray-100 px-4 py-2 border-b flex justify-between items-center text-sm font-mono">
            <span>{currentFile ? (isModified ? `${currentFile}*` : currentFile) : 'untitled.py'}</span>
            <div className="flex gap-2">
              <button
                onClick={() => handleSave()}
                disabled={saving}
                className="px-3 py-1 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={handleExecute}
                disabled={loading}
                className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
              >
                {loading ? 'Running...' : 'Run'}
              </button>
            </div>
          </div>
          <div className="flex-1">
            <Editor
              height="100%"
              defaultLanguage="python"
              value={code}
              beforeMount={handleEditorWillMount}
              onMount={handleEditorDidMount}
              onChange={(value) => { setCode(value || ''); setIsModified(true); }}
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                scrollBeyondLastLine: false,
                automaticLayout: true,
                suggestOnTriggerCharacters: true,
                quickSuggestions: { other: true, comments: false, strings: true },
              }}
            />
          </div>
        </div>

        <div className="flex-1 flex flex-col gap-4 overflow-y-auto pr-2">
          <div className="bg-gray-100 p-4 rounded-lg min-h-[100px] border border-gray-200 overflow-x-auto">
            <h3 className="text-sm font-semibold text-gray-700 mb-2 uppercase tracking-wider">Console Output</h3>
            <pre 
              className="whitespace-pre font-mono text-sm leading-none" 
              style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' }}
            >
              {output || 'No output yet.'}
            </pre>
          </div>

          {images.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {images.map((img, index) => (
                <div key={index} className="bg-white border border-gray-200 p-2 rounded-lg shadow-sm">
                  <img src={img} alt={`Plot ${index}`} className="w-full h-auto" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PythonEditor;
