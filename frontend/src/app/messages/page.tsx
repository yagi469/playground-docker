import MessageBoard from '@/components/MessageBoard';

export default function MessagesPage() {
  return (
    <div className="flex flex-col items-center min-h-screen p-8 gap-8 font-[family-name:var(--font-geist-sans)] text-black bg-white">
      <header className="text-center">
        <h1 className="text-3xl font-bold mb-2">メッセージ投稿</h1>
        <p className="text-gray-500">掲示板にメッセージを投稿できます</p>
      </header>

      <main className="flex flex-col gap-12 items-center w-full max-w-4xl">
        <MessageBoard />
      </main>
    </div>
  );
}
