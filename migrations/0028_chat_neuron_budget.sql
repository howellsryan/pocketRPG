-- Neuron budget for the help chatbot's global AI spend (see
-- functions/_lib/chat/quota.js). Replaces the chat_global_usage call-count
-- circuit-breaker: milli_neurons accumulates estimated Workers AI usage so AI
-- calls stop before the free 10,000 neurons/day allocation is exceeded and
-- the chatbot can never bill the account. chat_global_usage (0027) is left in
-- place so deployments running older code keep working; drop it in a later
-- migration once this code is live everywhere.
CREATE TABLE IF NOT EXISTS chat_neuron_usage (
  day_key TEXT PRIMARY KEY,
  milli_neurons INTEGER NOT NULL DEFAULT 0
);
