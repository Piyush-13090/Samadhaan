# Model wrappers

Loading and inference wrappers for locally hosted models (vision classifiers,
sentence-transformer embedders, image similarity encoders).

Empty by design: no model is bundled in the foundation milestone. Each model
arrives with the milestone that needs it, exposing a narrow interface that
`app/services/` calls, so a hosted API can be swapped for a local model without
touching route or service code. See `docs/ML_PLAN.md`.
