package com.example.demo;

import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.http.ResponseEntity;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.*;
import java.util.stream.Collectors;

@RestController
@CrossOrigin(origins = "*")
public class SqlRecipeController {

    private static final String RECIPES_DIR = "/app/sql-recipes";

    @GetMapping("/api/recipes")
    public ResponseEntity<Map<String, List<String>>> listRecipes() {
        File dir = new File(RECIPES_DIR);
        if (!dir.exists() || !dir.isDirectory()) {
            return ResponseEntity.notFound().build();
        }

        Map<String, List<String>> recipes = new TreeMap<>();
        File[] chapters = dir.listFiles(File::isDirectory);
        if (chapters != null) {
            for (File chapter : chapters) {
                File[] files = chapter.listFiles((d, name) -> name.endsWith(".sql"));
                if (files != null) {
                    List<String> fileNames = Arrays.stream(files)
                            .map(File::getName)
                            .sorted()
                            .collect(Collectors.toList());
                    recipes.put(chapter.getName(), fileNames);
                }
            }
        }
        return ResponseEntity.ok(recipes);
    }

    @GetMapping("/api/recipes/{chapter}/{filename}")
    public ResponseEntity<Map<String, String>> getRecipeContent(
            @PathVariable String chapter,
            @PathVariable String filename) {
        Path path = Paths.get(RECIPES_DIR, chapter, filename);
        if (!Files.exists(path)) {
            return ResponseEntity.notFound().build();
        }

        try {
            String content = Files.readString(path);
            Map<String, String> result = new HashMap<>();
            result.put("content", content);
            return ResponseEntity.ok(result);
        } catch (IOException e) {
            return ResponseEntity.internalServerError().build();
        }
    }

    @PostMapping("/api/recipes/{chapter}/{filename}")
    public ResponseEntity<Void> saveRecipe(
            @PathVariable String chapter,
            @PathVariable String filename,
            @RequestBody Map<String, String> body) {
        String content = body.get("content");
        if (content == null) {
            return ResponseEntity.badRequest().build();
        }

        // ファイル名を安全な形式に変換（スペースをアンダースコアに、ハイフンや日本語は許可）
        String sanitizedFilename = filename.replaceAll("[^a-zA-Z0-9\\s\\-_\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]", "")
                                          .trim()
                                          .replace(" ", "_");
        
        if (sanitizedFilename.isEmpty()) {
            sanitizedFilename = "untitled";
        }

        String safeFilename = sanitizedFilename.endsWith(".sql") ? sanitizedFilename : sanitizedFilename + ".sql";

        Path chapterPath = Paths.get(RECIPES_DIR, chapter);
        try {
            if (!Files.exists(chapterPath)) {
                Files.createDirectories(chapterPath);
            }
            Path filePath = chapterPath.resolve(safeFilename);
            Files.writeString(filePath, content);
            return ResponseEntity.ok().build();
        } catch (IOException e) {
            return ResponseEntity.internalServerError().build();
        }
    }
}
