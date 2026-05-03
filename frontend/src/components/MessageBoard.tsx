'use client';

import React, { useState, useEffect, useCallback } from 'react';

interface Message {
  id: number;
  text: string;
}

export default function MessageBoard() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const getBackendUrl = () => {
    return '/api/messages';
  };

  const fetchMessages = useCallback(async () => {
    const url = getBackendUrl();
    setLoading(true);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
      const data = await res.json();
      setMessages(data);
      setError(null);
    } catch (err: unknown) {
      console.error('Fetch error:', err);
      setError(`接続エラー: バックエンドに接続できませんでした。`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      await fetchMessages();
    };
    init();
  }, [fetchMessages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    const url = getBackendUrl();
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: inputText }),
      });

      if (!res.ok) throw new Error('Failed to post message');
      
      setInputText('');
      await fetchMessages();
    } catch (err: unknown) {
      console.error('Post error:', err);
      alert('メッセージの送信に失敗しました。');
    }
  };

  return (
    <div className="w-full max-w-2xl space-y-6">
      <div className="p-6 border rounded-xl bg-gray-50 shadow-md">
        <h2 className="text-xl font-bold mb-4 text-gray-800 border-b pb-2">新規メッセージ投稿</h2>
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="メッセージを入力してください..."
            className="flex-1 p-2 border rounded-lg text-black bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-bold transition-colors">
            送信
          </button>
        </form>
      </div>

      <div className="p-6 border rounded-xl bg-gray-50 shadow-md">
        <div className="flex justify-between items-center mb-4 border-b pb-2">
          <h2 className="text-xl font-bold text-gray-800">メッセージ一覧</h2>
          <button 
            onClick={fetchMessages}
            className="text-xs bg-gray-200 hover:bg-gray-300 px-3 py-1 rounded text-gray-600 transition-colors"
          >
            更新
          </button>
        </div>
        
        {loading ? (
          <div className="flex justify-center py-8">
            <p className="text-blue-500 font-medium animate-pulse">読み込み中...</p>
          </div>
        ) : error ? (
          <div className="text-center p-4">
            <p className="text-red-500 font-medium">{error}</p>
            <button onClick={fetchMessages} className="mt-2 text-sm text-blue-600 hover:underline">再試行</button>
          </div>
        ) : (
          <ul className="space-y-3">
            {[...messages].reverse().map((msg) => (
              <li key={msg.id} className="p-3 bg-white rounded-lg shadow-sm border border-gray-100 flex gap-4 items-center">
                <span className="bg-blue-50 text-blue-600 px-2 py-1 rounded text-xs font-bold min-w-[40px] text-center">
                  #{msg.id}
                </span>
                <span className="text-gray-700 flex-1">{msg.text}</span>
              </li>
            ))}
            {messages.length === 0 && (
              <p className="text-gray-400 italic text-center py-4">メッセージがまだありません。</p>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
