'use client';

import React, { useState, useEffect, useCallback } from 'react';

export default function SqlConsole() {
  const [sql, setSql] = useState('SELECT * FROM message;');
  const [results, setResults] = useState([]);
  const [editedResults, setEditedResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [tables, setTables] = useState([]);
  const [recipes, setRecipes] = useState({});
  const [activeTab, setActiveTab] = useState('tables'); // 'tables' or 'recipes'
  const [editingCell, setEditingCell] = useState(null); // { rowIndex, colName }

  const getBackendUrl = (path = '/api/sql') => `http://${window.location.hostname}:8081${path}`;

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

  const fetchRecipes = useCallback(async () => {
    try {
      const res = await fetch(getBackendUrl('/api/recipes'));
      if (res.ok) {
        const data = await res.json();
        setRecipes(data);
      }
    } catch (err) {
      console.error('Failed to fetch recipes:', err);
    }
  }, []);

  useEffect(() => {
    fetchTables();
    fetchRecipes();
  }, [fetchTables, fetchRecipes]);

  const loadRecipe = async (chapter, filename) => {
    try {
      const res = await fetch(getBackendUrl(`/api/recipes/${chapter}/${filename}`));
      if (res.ok) {
        const data = await res.json();
        setSql(data.content);
      }
    } catch (err) {
      alert('Failed to load recipe: ' + err.message);
    }
  };

  const executeSql = async (overrideSql = null) => {
    const query = overrideSql || sql;
    setLoading(true);
    setError(null);
    setEditingCell(null);
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
      setEditedResults(JSON.parse(JSON.stringify(data))); // Deep copy for editing
      if (!query.toLowerCase().trim().startsWith('select')) fetchTables();
    } catch (err) {
      setError(err.message);
      setResults([]);
      setEditedResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCellChange = (rowIndex, colName, value) => {
    const newData = [...editedResults];
    newData[rowIndex][colName] = value;
    setEditedResults(newData);
  };

  const saveRow = async (rowIndex) => {
    const originalRow = results[rowIndex];
    const editedRow = editedResults[rowIndex];
    
    // Extract table name from SQL
    const tableMatch = sql.match(/from\s+([a-zA-Z0-9_]+)/i);
    if (!tableMatch) {
      alert('テーブル名を特定できませんでした。SELECT文を修正してください。');
      return;
    }
    const tableName = tableMatch[1];

    // Find a suitable key column
    const potentialKeys = ['id', `${tableName}_id`.toLowerCase(), 'user_id'];
    let keyCol = Object.keys(editedRow).find(key => potentialKeys.includes(key.toLowerCase()));

    // Build UPDATE query
    const updates = Object.keys(editedRow)
      .filter(key => String(editedRow[key]) !== String(originalRow[key]))
      .map(key => {
        const val = editedRow[key];
        const escapedVal = typeof val === 'string' ? val.replace(/'/g, "''") : val;
        return `${key} = ${val === null ? 'NULL' : `'${escapedVal}'`}`;
      });

    if (updates.length === 0) {
      setEditingCell(null);
      return;
    }

    let whereClause = '';
    if (keyCol) {
      const keyVal = originalRow[keyCol];
      const escapedKeyVal = typeof keyVal === 'string' ? keyVal.replace(/'/g, "''") : keyVal;
      whereClause = `${keyCol} = '${escapedKeyVal}'`;
    } else {
      whereClause = Object.keys(originalRow)
        .map(key => {
          const val = originalRow[key];
          if (val === null) return `${key} IS NULL`;
          const escapedVal = typeof val === 'string' ? val.replace(/'/g, "''") : val;
          return `${key} = '${escapedVal}'`;
        })
        .join(' AND ');
    }

    const updateSql = `UPDATE ${tableName} SET ${updates.join(', ')} WHERE ${whereClause};`;

    setLoading(true);
    try {
      const res = await fetch(getBackendUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: updateSql }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Update failed');
      }
      
      await executeSql();
      alert('保存しました。');
    } catch (err) {
      alert('エラー: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const columns = editedResults.length > 0 ? Object.keys(editedResults[0]) : [];

  return (
    <div className="w-full max-w-6xl flex flex-col gap-6">
      <div className="flex flex-col md:flex-row gap-4 h-[500px]">
        <div className="w-full md:w-64 border rounded-xl bg-gray-50 shadow-md flex flex-col overflow-hidden">
          <div className="bg-gray-100 border-b flex">
            <button 
              onClick={() => setActiveTab('tables')}
              className={`flex-1 p-3 text-sm font-bold transition-colors ${activeTab === 'tables' ? 'bg-white text-blue-600 border-r' : 'text-gray-500 hover:bg-gray-50 border-r'}`}
            >
              テーブル
            </button>
            <button 
              onClick={() => setActiveTab('recipes')}
              className={`flex-1 p-3 text-sm font-bold transition-colors ${activeTab === 'recipes' ? 'bg-white text-blue-600' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              レシピ
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {activeTab === 'tables' ? (
              <ul className="space-y-1">
                {tables.map(table => (
                  <li key={table} className="group">
                    <div className="flex items-center justify-between p-2 rounded hover:bg-blue-50 cursor-pointer transition-colors"
                      onClick={() => setSql('SELECT * FROM ' + table + ';')}>
                      <span className="text-sm text-gray-700 font-mono">{table}</span>
                      <button 
                        onClick={(e) => { e.stopPropagation(); executeSql("SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = '" + table + "' ORDER BY ordinal_position;"); }}
                        className="hidden group-hover:block text-[10px] text-blue-600 underline"
                      >
                        構造
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="space-y-4">
                {Object.entries(recipes).map(([chapter, files]) => (
                  <div key={chapter}>
                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 px-2">{chapter}</h3>
                    <ul className="space-y-1">
                      {(files as string[]).map(file => (
                        <li key={file} className="group">
                          <div className="p-2 rounded hover:bg-blue-50 cursor-pointer transition-colors"
                            onClick={() => loadRecipe(chapter, file)}>
                            <span className="text-xs text-gray-700 font-mono block truncate" title={file}>{file}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 border rounded-xl bg-gray-50 shadow-md flex flex-col overflow-hidden">
          <div className="p-3 bg-gray-100 border-b font-bold text-sm text-gray-700 text-black">
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
              実行
            </button>
          </div>
        </div>
      </div>

      <div className="w-full border rounded-xl bg-gray-50 shadow-md min-h-[200px] flex flex-col overflow-hidden">
        <div className="p-3 bg-gray-100 border-b font-bold text-sm text-gray-700 flex justify-between items-center text-black">
          <span>実行結果 {editedResults.length > 0 && <span className="font-normal text-gray-500 ml-2">({editedResults.length} 件) - セルをクリックして編集</span>}</span>
        </div>
        <div className="flex-1 overflow-auto max-h-[400px]">
          {error ? (
            <div className="p-4 text-red-600 font-mono text-sm bg-red-50">
              {error}
            </div>
          ) : editedResults.length > 0 ? (
            <table className="min-w-full divide-y divide-gray-200 border-collapse">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-4 py-2 bg-gray-100 border w-20">操作</th>
                  {columns.map(col => (
                    <th key={col} className="px-4 py-2 text-left text-xs font-bold text-gray-600 uppercase border">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200 font-mono text-xs text-black">
                {editedResults.map((row, i) => {
                  const isModified = JSON.stringify(row) !== JSON.stringify(results[i]);
                  return (
                    <tr key={i} className={`hover:bg-gray-50 text-black ${isModified ? 'bg-yellow-50' : ''}`}>
                      <td className="px-2 py-1 border text-center">
                        {isModified && (
                          <button 
                            onClick={() => saveRow(i)}
                            className="bg-green-600 text-white px-2 py-1 rounded text-[10px] font-bold hover:bg-green-700 transition-colors shadow-sm"
                          >
                            保存
                          </button>
                        )}
                      </td>
                      {columns.map(col => (
                        <td 
                          key={col} 
                          className={`px-4 py-2 border whitespace-nowrap cursor-text transition-colors ${
                            editingCell?.rowIndex === i && editingCell?.colName === col ? 'p-0' : 
                            (String(row[col]) !== String(results[i][col]) ? 'bg-yellow-100' : '')
                          }`}
                          onClick={() => setEditingCell({ rowIndex: i, colName: col })}
                        >
                          {editingCell?.rowIndex === i && editingCell?.colName === col ? (
                            <input 
                              autoFocus
                              className="w-full h-full px-4 py-2 focus:outline-blue-500 border-none bg-blue-50 text-black"
                              value={row[col] === null ? '' : row[col]}
                              onChange={(e) => handleCellChange(i, col, e.target.value)}
                              onBlur={() => setEditingCell(null)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') setEditingCell(null);
                                if (e.key === 'Escape') {
                                  handleCellChange(i, col, results[i][col]);
                                  setEditingCell(null);
                                }
                              }}
                            />
                          ) : (
                            <div className="min-h-[1.25rem]">
                              {row[col] === null ? <span className="text-gray-300 italic">NULL</span> : String(row[col])}
                            </div>
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="p-12 text-center text-gray-400 italic text-black">結果なし</div>
          )}
        </div>
      </div>
    </div>
  );
}
