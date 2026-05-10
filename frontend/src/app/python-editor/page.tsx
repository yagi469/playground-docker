import PythonEditor from '@/components/PythonEditor';

export default function PythonEditorPage() {
  return (
    <div className="flex flex-col items-center min-h-screen p-8 gap-8 font-[family-name:var(--font-geist-sans)] text-black bg-white">
      <header className="text-center">
        <h1 className="text-3xl font-bold mb-2">Python エディタ</h1>
        <p className="text-gray-500">Pythonコードを実行し、結果やグラフをリアルタイムで確認できます</p>
      </header>

      <main className="flex flex-col gap-12 items-center w-full max-w-6xl">
        <PythonEditor />
      </main>
    </div>
  );
}
