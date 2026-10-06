"""Organisation matching (Prompt 14).

The current engine is an **embedding-assisted heuristic baseline**: real
semantic signals from the configured embedding model, combined by a weighted
formula. It is not a trained supervised model, and nothing here says it is.
`MatchingEngine` is the seam a trained model replaces later.
"""
