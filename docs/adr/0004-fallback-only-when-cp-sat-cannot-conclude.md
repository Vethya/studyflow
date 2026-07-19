# Fall back only when CP-SAT cannot conclude

Google OR-Tools CP-SAT remains StudyFlow's authoritative scheduler with a four-second solver limit. A deterministic earliest-deadline-first greedy heuristic may use the remaining one second of the five-second request budget to generate a clearly labeled proposal only when CP-SAT times out or fails technically; it must preserve all hard constraints. A workload that CP-SAT proves infeasible returns Overload instead, because fallback scheduling must never disguise infeasibility as recovery.
