'use client';

import React, { useState, useEffect, useCallback } from 'react';

export default function SqlConsole() {
  const [sql, setSql] = useState('SELECT * FROM message;');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [tables, setTables] = useState([]);

  const getBackendUrl = () => 'http://3.112.83.83:8081/api/sql';

  const fetchTables = useCallback(async () => {
    try {
      const res = await fetch(getBackendUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name;" }),
      });
      if (res.ok) {
        const data = await res.json();
        setTables(data.map(t => t.table_name));
      }
    } catch (err) {
      console.error('Failed to fetch tables:', err);
    }
  }, []);

  useEffect(() => {
    fetchTables();
  }, [fetchTables]);

  const executeSql = async (overrideSql = null) => {
    const query = overrideSql || sql;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(getBackendUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: query }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Error ' + res.status);
      }
      setResults(data);
      if (!query.toLowerCase().trim().startsWith('select')) fetchTables();
    } catch (err) {
      setError(err.message);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const columns = results.length > 0 ? Object.keys(results[0]) : [];

  return (
    <div className="w-full max-w-6xl flex flex-col gap-6">
      <div className="flex flex-col md:flex-row gap-4 h-[500px]">
        {/* Sidebar: Table List */}
        <div className="w-full md:w-64 border rounded-xl bg-gray-50 shadow-md flex flex-col overflow-hidden">
          <div className="p-3 bg-gray-100 border-b font-bold text-sm text-gray-700 flex justify-between items-center">
            <span>テーブル一覧</span>
            <button onClick={fetchTables} className="text-[10px] bg-white border px-1 rounded hover:bg-gray-50">更新</button>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            <ul className="space-y-1">
              {tables.map(table => (
                <li key={table} className="group">
                  <div className="flex items-center justify-between p-2 rounded hover:bg-blue-50 cursor-pointer transition-colors"
                    onClick={() => setSql('SELECT * FROM ' + table + ';')}>
                    <span className="text-sm text-gray-700 font-mono">{table}</span>
                    <button 
                      onClick={(e) => { e.stopPropagation(); executeSql('SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = '' + table + '' ORDER BY ordinal_position;'); }}
                      className="hidden group-hover:block text-[10px] text-blue-600 underline"
                    >
                      構造
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Main: SQL Editor */}
        <div className="flex-1 border rounded-xl bg-gray-50 shadow-md flex flex-col overflow-hidden">
          <div className="p-3 bg-gray-100 border-b font-bold text-sm text-gray-700">
            SQL エディタ
          </div>
          <textarea
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            className="flex-1 p-4 font-mono text-sm text-black bg-white focus:outline-none"
            placeholder="SQLを入力..."
          />
          <div className="p-3 bg-white border-t flex gap-2">
            <button onClick={() => executeSql()}
              disabled={loading}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded font-bold text-sm disabled:bg-gray-400 transition-colors">
              実行 (F5)
            </button>
          </div>
        </div>
      </div>

      {/* Results Area */}
      <div className="w-full border rounded-xl bg-gray-50 shadow-md min-h-[200px] flex flex-col overflow-hidden">
        <div className="p-3 bg-gray-100 border-b font-bold text-sm text-gray-700">
          実行結果 {results.length > 0 && <span className="font-normal text-gray-500 ml-2">({results.length} 件)</span>}
        </div>
        <div className="flex-1 overflow-auto max-h-[400px]">
          {error ? (
            <div className="p-4 text-red-600 font-mono text-sm bg-red-50">
              {error}
            </div>
          ) : results.length > 0 ? (
            <table className="min-w-full divide-y divide-gray-200 border-collapse">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  {columns.map(col => (
                    <th key={col} className="px-4 py-2 text-left text-xs font-bold text-gray-600 uppercase border">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200 font-mono text-xs">
                {results.map((row, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    {columns.map(col => (
                      <td key={col} className="px-4 py-2 text-gray-700 border whitespace-nowrap">
                        {row[col] === null ? <span className="text-gray-300">NULL</span> : String(row[col])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-12 text-center text-gray-400 italic">結果なし</div>
          )}
        </div>
      </div>
    </div>
  );
}
' > frontend/src/components/SqlConsole.tsx