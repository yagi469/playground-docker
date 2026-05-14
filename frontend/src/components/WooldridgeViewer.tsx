'use client';

import React, { useState, useEffect } from 'react';

interface DatasetInfo {
  dataset: string;
  columns: string[];
  data: any[];
  total_rows: number;
}

const WooldridgeViewer: React.FC = () => {
  const [datasets, setDatasets] = useState<string[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<string>('');
  const [dataInfo, setDataInfo] = useState<DatasetInfo | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const API_BASE = 'http://localhost:8001';

  useEffect(() => {
    fetchDatasets();
  }, []);

  const fetchDatasets = async () => {
    try {
      const response = await fetch(`${API_BASE}/wooldridge/datasets`);
      if (!response.ok) throw new Error('Failed to fetch datasets');
      const data = await response.json();
      setDatasets(data.datasets);
      if (data.datasets.length > 0) {
        setSelectedDataset(data.datasets[0]);
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  const fetchDatasetData = async (datasetId: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/wooldridge/data/${datasetId}`);
      if (!response.ok) throw new Error('Failed to fetch dataset data');
      const data = await response.json();
      setDataInfo(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedDataset) {
      fetchDatasetData(selectedDataset);
    }
  }, [selectedDataset]);

  return (
    <div className="w-full flex flex-col gap-6 text-black">
      <div className="flex flex-col md:flex-row gap-4 items-end bg-gray-50 p-6 rounded-xl border shadow-sm">
        <div className="flex-1">
          <label className="block text-sm font-bold text-gray-700 mb-2">データセットを選択</label>
          <select 
            value={selectedDataset}
            onChange={(e) => setSelectedDataset(e.target.value)}
            className="w-full p-2.5 border rounded-lg bg-white shadow-sm focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all"
          >
            {datasets.map(ds => (
              <option key={ds} value={ds}>{ds}</option>
            ))}
          </select>
        </div>
        <button 
          onClick={() => fetchDatasetData(selectedDataset)}
          disabled={loading || !selectedDataset}
          className="bg-blue-600 text-white px-6 py-2.5 rounded-lg font-bold hover:bg-blue-700 disabled:bg-gray-400 transition-colors shadow-sm cursor-pointer"
        >
          {loading ? '読み込み中...' : '再読み込み'}
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg font-medium">
          エラー: {error}
        </div>
      )}

      {dataInfo && (
        <div className="w-full border rounded-xl bg-white shadow-md flex flex-col overflow-hidden">
          <div className="p-4 bg-gray-50 border-b flex justify-between items-center">
            <h2 className="text-lg font-bold text-gray-800">
              {dataInfo.dataset} <span className="text-sm font-normal text-gray-500 ml-2">(全 {dataInfo.total_rows} 行中、最初の100行を表示)</span>
            </h2>
          </div>
          <div className="flex-1 overflow-auto max-h-[600px]">
            <table className="min-w-full divide-y divide-gray-200 border-collapse">
              <thead className="bg-gray-100 sticky top-0 z-10">
                <tr>
                  {dataInfo.columns.map(col => (
                    <th key={col} className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase border tracking-wider">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200 font-mono text-sm">
                {dataInfo.data.map((row, i) => (
                  <tr key={i} className="hover:bg-blue-50 transition-colors">
                    {dataInfo.columns.map(col => (
                      <td key={col} className="px-4 py-2 border whitespace-nowrap text-gray-700">
                        {row[col] === null || row[col] === '' ? <span className="text-gray-300 italic">N/A</span> : String(row[col])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default WooldridgeViewer;
