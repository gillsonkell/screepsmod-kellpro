CREATE TABLE player_scores (
  id SERIAL PRIMARY KEY,
  created_date TIMESTAMP DEFAULT NOW(),
  player_id TEXT,
  gcl INT,
  tick INT
);

CREATE INDEX player_scores_created_date ON player_scores (created_date);
CREATE INDEX player_scores_player_id ON player_scores (player_id);
