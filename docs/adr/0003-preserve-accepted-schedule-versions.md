# Preserve accepted schedule versions

StudyFlow will preserve every accepted schedule as an immutable version with its creation time and revision reason, while presenting only the current accepted version as the active plan. New revisions create new versions instead of mutating historical schedules. The additional storage and versioning complexity are accepted because static-versus-adaptive evaluation, recovery analysis, and measurement of schedule changes require the exact plan that existed at each point in time.
