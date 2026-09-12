# Mock data

UI fixtures for the design system and page previews.

**This is presentation data only.** Nothing here reaches the database, and no
component fetches it directly at runtime — pages import a fixture and pass it
down as props.

That prop boundary is the point: when the real endpoints land, a page swaps
`import { NEARBY_PROBLEMS } from '@/data/problems'` for
`await problemsService.listNearby()`, and every component below it is unchanged
because it already receives typed `ProblemSummary` objects.

Shapes live in `@/types/domain`.
