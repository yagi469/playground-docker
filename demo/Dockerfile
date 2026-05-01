# ベースイメージとして eclipse-temurin:25-jdk を使用
  FROM eclipse-temurin:25-jdk-alpine
  
  # Maven と inotify-tools をインストール
  RUN apk add --no-cache maven inotify-tools
  
  # 作業ディレクトリを設定
  WORKDIR /app
  
  # 依存関係を事前にダウンロード（ビルド時間短縮のため）
  COPY demo/pom.xml .
  RUN mvn dependency:go-offline -B
  
  # プロジェクトのソースコードをコピー
  COPY demo/ .
  
  # JAR ファイルを作成（テストはスキップ）
  RUN mvn clean package -DskipTests
  
  # ホットリロードを有効にする環境変数を設定
  ENV JAVA_OPTS="-Dspring.devtools.restart.enabled=true -Dspring.devtools.livereload.enabled=true"
  
  # アプリケーションの起動（ホットリロード用にmvn spring-boot:runをデフォルトコマンドに）
  CMD ["mvn", "spring-boot:run"]
