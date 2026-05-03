import Link from 'next/link';

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-64px)] p-8 gap-8 font-[family-name:var(--font-geist-sans)] text-black bg-white">
      <header className="text-center">
        <h1 className="text-4xl font-bold mb-4">Demo App</h1>
        <p className="text-xl text-gray-500">Spring Boot + Postgres + Next.js のデモアプリケーション</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full max-w-4xl mt-8">
        <Link href="/messages" className="group p-8 border rounded-2xl bg-gray-50 hover:bg-blue-50 hover:border-blue-200 transition-all shadow-sm">
          <h2 className="text-2xl font-bold mb-3 group-hover:text-blue-600">メッセージ投稿 &rarr;</h2>
          <p className="text-gray-600 leading-relaxed">掲示板形式でメッセージの投稿と一覧表示が可能です。バックエンドのAPIを通じてPostgreSQLにデータを保存します。</p>
        </Link>

        <Link href="/sql-console" className="group p-8 border rounded-2xl bg-gray-50 hover:bg-blue-50 hover:border-blue-200 transition-all shadow-sm">
          <h2 className="text-2xl font-bold mb-3 group-hover:text-blue-600">SQL エディタ &rarr;</h2>
          <p className="text-gray-600 leading-relaxed">データベースに直 接SQLを実行して結果を確認できます。テーブル一覧の表示やテーブル構造の確 認も可能です。</p>
        </Link>

        <Link href="/spring-book" className="group p-8 border rounded-2xl bg-gray-50 hover:bg-blue-50 hover:border-blue-200 transition-all shadow-sm">
          <h2 className="text-2xl font-bold mb-3 group-hover:text-blue-600">Spring-Book エディタ &rarr;</h2>
          <p className="text-gray-600 leading-relaxed">Spring Bootの学習プロジェクトをブラウザ上で閲覧・編集・実行できます。Mavenコマンドの実行結果も確認可能です。</p>
        </Link>
        </div>

      <footer className="mt-16 text-gray-400 text-sm">
        Built with Next.js (App Router), TypeScript, and Tailwind CSS.
      </footer>
    </div>
  );
}
