'use client';

import { useEffect, useState } from 'react';

export default function HelloMessage() {
  const [message, setMessage] = useState<string>('Loading...');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // 確実に疎通させるため、IPを直接指定
    const backendUrl = `http://${window.location.hostname}:8081/` ;
    
    console.log('Fetching from backend:', backendUrl);

    fetch(backendUrl)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to fetch: ${res.status}`);
        }
        return res.text();
      })
      .then((data) => {
        console.log('Data received:', data);
        setMessage(data);
      })
      .catch((err) => {
        console.error('Fetch error:', err);
        setError(`Error connecting to ${backendUrl}.`);
      });
  }, []);

  return (
    <div className="p-4 border rounded-lg bg-white shadow-sm text-black">
      <h2 className="text-xl font-bold mb-2 text-gray-800">Backend Response:</h2>
      {error ? (
        <div className="text-red-500">
          <p className="font-medium">{error}</p>
        </div>
      ) : (
        <p className="text-green-600 font-mono text-lg">{message}</p>
      )}
    </div>
  );
}
