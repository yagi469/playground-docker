DROP TABLE IF EXISTS exam_scores;
CREATE TABLE exam_scores(
    name    varchar(255)
  , subject varchar(255)
  , score   integer
);

INSERT INTO exam_scores
VALUES
    ('生徒A', '国語',  69)
  , ('生徒B', '国語',  87)
  , ('生徒C', '国語',  65)
  , ('生徒D', '国語',  73)
  , ('生徒E', '国語',  61)
  , ('生徒A', '数学', 100)
  , ('生徒B', '数学',  12)
  , ('生徒C', '数学',   7)
  , ('生徒D', '数学',  73)
  , ('生徒E', '数学',  56)
;
