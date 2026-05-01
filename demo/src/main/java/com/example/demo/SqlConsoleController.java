package com.example.demo;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.http.ResponseEntity;
import org.springframework.http.HttpStatus;

import java.util.List;
import java.util.Map;
import java.util.HashMap;

@RestController
@CrossOrigin(origins = "*")
public class SqlConsoleController {

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @PostMapping("/api/sql")
    public ResponseEntity<Object> executeSql(@RequestBody Map<String, String> payload) {
        String sql = payload.get("sql").trim();
        try {
            if (sql.toLowerCase().startsWith("select")) {
                List<Map<String, Object>> result = jdbcTemplate.queryForList(sql);
                return ResponseEntity.ok(result);
            } else {
                jdbcTemplate.execute(sql);
                Map<String, String> success = new HashMap<>();
                success.put("message", "SQLを実行しました（結果セットなし）");
                return ResponseEntity.ok(List.of(success));
            }
        } catch (Exception e) {
            Map<String, String> error = new HashMap<>();
            error.put("message", e.getMessage());
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(error);
        }
    }
}
