CREATE TABLE IF NOT EXISTS chat_usage (
  character_id INTEGER NOT NULL REFERENCES characters(id),
  day_key      TEXT    NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (character_id, day_key)
);

CREATE TABLE IF NOT EXISTS chat_neuron_usage (
  day_key       TEXT PRIMARY KEY,
  milli_neurons INTEGER NOT NULL DEFAULT 0
);
