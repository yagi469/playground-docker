'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Editor from '@monaco-editor/react';

interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
}

export default function SpringBookEditor() {
  const [projects, setProjects] = useState<string[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [content, setContent] = useState<string>('');
  const [output, setOutput] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  // Resizing state
  const [projectWidth, setProjectWidth] = useState(192); // 48 * 4
  const [fileWidth, setFileWidth] = useState(256); // 64 * 4
  const isResizingProject = useRef(false);
  const isResizingFile = useRef(false);

  // Fetch projects on mount
  useEffect(() => {
    fetch('/api/spring-book/projects')
      .then(res => res.json())
      .then(data => setProjects(Array.isArray(data) ? data : []))
      .catch(err => console.error('Failed to fetch projects', err));
  }, []);

  const toggleFolder = (path: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  // Fetch file tree when project changes
  useEffect(() => {
    if (selectedProject) {
      Promise.resolve().then(() => setLoading(true));
      fetch(`/api/spring-book/files?project=${selectedProject}`)
        .then(res => res.json())
        .then((data: unknown) => {
          setFileTree(Array.isArray(data) ? data : []);
          setSelectedFile(null);
          setContent('');
          setExpandedFolders(new Set());
        })
        .finally(() => setLoading(false));
    }
  }, [selectedProject]);

  // Fetch file content when file changes
  const handleFileClick = (file: FileNode) => {
    if (file.isDirectory) {
      toggleFolder(file.path);
      return;
    }
    setSelectedFile(file.path);
    setLoading(true);
    fetch(`/api/spring-book/file?project=${selectedProject}&path=${file.path}`)
      .then(res => res.json())
      .then(data => setContent(data.content || ''))
      .finally(() => setLoading(false));
  };

  const handleSave = async () => {
    if (!selectedProject || !selectedFile) return;
    setSaving(true);
    try {
      const res = await fetch('/api/spring-book/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: selectedProject, path: selectedFile, content }),
      });
      if (!res.ok) throw new Error('Failed to save');
      alert('保存しました');
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      alert(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  const handleExecute = async (command: string) => {
    if (!selectedProject) return;
    setExecuting(true);
    setOutput(`Running: ${command}...\n`);
    try {
      const res = await fetch('/api/spring-book/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: selectedProject, command }),
      });
      const data = await res.json();
      setOutput(prev => prev + (data.stdout || '') + (data.stderr || '') + (data.error || ''));
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setOutput(prev => prev + `Error: ${errorMessage}`);
    } finally {
      setExecuting(false);
    }
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isResizingProject.current) {
      setProjectWidth(e.clientX - 24);
    } else if (isResizingFile.current) {
      setFileWidth(e.clientX - projectWidth - 24);
    }
  }, [projectWidth]);

  const stopResizing = useCallback(() => {
    isResizingProject.current = false;
    isResizingFile.current = false;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', stopResizing);
  }, [handleMouseMove]); // Note: stopResizing is recursively referenced, which is tricky with useCallback

  // Re-defining stopResizing to avoid recursive dependency for simplicity in linting
  const stopResizingRef = useRef<() => void>(() => {});
  stopResizingRef.current = () => {
    isResizingProject.current = false;
    isResizingFile.current = false;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', stopResizingRef.current);
  };

  const startResizingProject = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizingProject.current = true;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', stopResizingRef.current);
  };

  const startResizingFile = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizingFile.current = true;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', stopResizingRef.current);
  };

  const renderFileTree = (nodes: FileNode[], level = 0) => {
    return nodes.map(node => (
      <div key={node.path}>
        <div
          className={`cursor-pointer hover:bg-blue-100 p-1 rounded text-sm flex items-center gap-1 whitespace-nowrap ${selectedFile === node.path ? 'bg-blue-200' : ''}`}
          style={{ paddingLeft: `${level * 12 + 4}px` }}
          onClick={() => handleFileClick(node)}
        >
          <span className="w-4 text-center text-[10px] text-gray-400">
            {node.isDirectory ? (expandedFolders.has(node.path) ? '▼' : '▶') : ''}
          </span>
          <span>{node.isDirectory ? '📁' : '📄'}</span>
          <span className="truncate" title={node.name}>{node.name}</span>
        </div>
        {node.isDirectory && expandedFolders.has(node.path) && node.children && renderFileTree(node.children, level + 1)}
      </div>
    ));
  };

  const getLanguage = (filename: string) => {
    if (filename.endsWith('.java')) return 'java';
    if (filename.endsWith('.xml')) return 'xml';
    if (filename.endsWith('.adoc')) return 'asciidoc';
    return 'plaintext';
  };

  return (
    <div className="flex h-[calc(100vh-100px)] w-full border rounded-xl overflow-hidden bg-white shadow-lg">
      {/* Project Sidebar */}
      <div style={{ width: `${projectWidth}px` }} className="flex-shrink-0 bg-gray-50 flex flex-col relative group">
        <div className="p-3 bg-gray-100 border-b font-bold text-sm whitespace-nowrap">プロジェクト</div>
        <div className="flex-1 overflow-y-auto p-2">
          {projects.map(p => (
            <div
              key={p}
              className={`cursor-pointer p-2 rounded text-xs hover:bg-blue-50 break-all ${selectedProject === p ? 'bg-blue-100 font-bold' : ''}`}
              onClick={() => setSelectedProject(p)}
            >
              {p}
            </div>
          ))}
        </div>
        <div 
          onMouseDown={startResizingProject}
          className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-blue-400 active:bg-blue-600 transition-colors z-10"
        />
      </div>

      {/* File Tree Sidebar */}
      <div style={{ width: `${fileWidth}px` }} className="flex-shrink-0 border-l bg-white flex flex-col overflow-hidden relative group">
        <div className="p-3 bg-gray-100 border-b font-bold text-sm whitespace-nowrap">ファイル</div>
        <div className="flex-1 overflow-auto p-2">
          {loading && !selectedProject ? <div className="text-gray-400 italic">読み込み中...</div> : renderFileTree(fileTree)}
          {!selectedProject && <div className="text-gray-400 text-center mt-10 italic">プロジェクトを選択してください</div>}
        </div>
        <div 
          onMouseDown={startResizingFile}
          className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-blue-400 active:bg-blue-600 transition-colors z-10"
        />
      </div>

      {/* Editor & Console */}
      <div className="flex-1 min-w-0 flex flex-col bg-gray-100 border-l">
        {/* Toolbar */}
        <div className="p-2 bg-white border-b flex gap-2 items-center">
          <button
            onClick={handleSave}
            disabled={!selectedFile || saving}
            className="bg-green-600 text-white px-3 py-1 rounded text-sm font-bold disabled:bg-gray-300"
          >
            {saving ? '保存中...' : '保存'}
          </button>
          <div className="h-6 w-px bg-gray-300 mx-1" />
          <button
            onClick={() => handleExecute('mvn clean test')}
            disabled={!selectedProject || executing}
            className="bg-blue-600 text-white px-3 py-1 rounded text-sm font-bold disabled:bg-gray-300"
          >
            mvn test
          </button>
          <button
            onClick={() => handleExecute('mvn spring-boot:run')}
            disabled={!selectedProject || executing}
            className="bg-indigo-600 text-white px-3 py-1 rounded text-sm font-bold disabled:bg-gray-300"
          >
            mvn run
          </button>
          <span className="ml-auto text-xs text-gray-500 font-mono truncate max-w-[300px]" title={selectedFile || ''}>
            {selectedFile || 'ファイル未選択'}
          </span>
        </div>

        {/* Editor Area */}
        <div className="flex-1 bg-white relative">
          {loading && (
            <div className="absolute inset-0 bg-white/50 z-10 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          )}
          <Editor
            height="100%"
            language={selectedFile ? getLanguage(selectedFile) : 'plaintext'}
            value={content}
            onChange={(val) => setContent(val || '')}
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              scrollBeyondLastLine: false,
              automaticLayout: true,
            }}
          />
        </div>

        {/* Console Area */}
        <div className="h-64 border-t bg-black text-green-400 font-mono text-xs overflow-hidden flex flex-col">
          <div className="p-2 bg-gray-800 text-gray-300 flex justify-between items-center">
            <span>実行結果</span>
            <div className="flex gap-4">
              <button 
                onClick={() => {
                  navigator.clipboard.writeText(output);
                  alert('コピーしました');
                }} 
                className="text-[10px] hover:underline"
                disabled={!output}
              >
                コピー
              </button>
              <button onClick={() => setOutput('')} className="text-[10px] hover:underline">クリア</button>
            </div>
          </div>
          <pre className="flex-1 p-2 overflow-auto whitespace-pre-wrap">
            {output || 'ここに実行結果が表示されます...'}
          </pre>
        </div>
      </div>
    </div>
  );
}
