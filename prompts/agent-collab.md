# Agent Collaboration & Debate

Orchestrate an autonomous multi-turn collaboration or debate between two sub-agents using `spawn_agent` to work out an architectural decision, API contract, or complex technical problem.

Specify the topic and optional roles/perspectives to begin. If the topic references an existing or active conversation, find it using `thread_list(active_only: true)` and `thread_read`.
