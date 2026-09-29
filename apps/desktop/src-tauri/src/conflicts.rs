/// Differences up to 75 ms are treated as the same boundary.
pub(crate) const TEMPORAL_EPSILON_US: u64 = 75_000;
/// Only a short partial overlap can merge automatically for removal cuts.
pub(crate) const CUT_AUTO_MERGE_OVERLAP_US: u64 = 250_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum IntervalRelation {
    New,
    Duplicate,
    Contained,
    Contains,
    Touching,
    Overlap,
    Conflict,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ConflictClass {
    New,
    Duplicate,
    Contained,
    Contains,
    Mergeable,
    Overlap,
    Conflict,
}

pub(crate) fn overlap_us(new_start: u64, new_end: u64, old_start: u64, old_end: u64) -> u64 {
    new_end
        .min(old_end)
        .saturating_sub(new_start.max(old_start))
}

pub(crate) fn classify_interval(
    new_start: u64,
    new_end: u64,
    old_start: u64,
    old_end: u64,
) -> IntervalRelation {
    if new_start >= new_end || old_start >= old_end {
        return IntervalRelation::Conflict;
    }
    if new_start.abs_diff(old_start) <= TEMPORAL_EPSILON_US
        && new_end.abs_diff(old_end) <= TEMPORAL_EPSILON_US
    {
        return IntervalRelation::Duplicate;
    }
    if new_end.saturating_add(TEMPORAL_EPSILON_US) < old_start
        || old_end.saturating_add(TEMPORAL_EPSILON_US) < new_start
    {
        return IntervalRelation::New;
    }
    if overlap_us(new_start, new_end, old_start, old_end) == 0 {
        return IntervalRelation::Touching;
    }
    if new_start.saturating_add(TEMPORAL_EPSILON_US) >= old_start
        && new_end <= old_end.saturating_add(TEMPORAL_EPSILON_US)
    {
        return IntervalRelation::Contained;
    }
    if new_start <= old_start.saturating_add(TEMPORAL_EPSILON_US)
        && new_end.saturating_add(TEMPORAL_EPSILON_US) >= old_end
    {
        return IntervalRelation::Contains;
    }
    IntervalRelation::Overlap
}

pub(crate) fn classify_cut(
    new_start: u64,
    new_end: u64,
    old_start: u64,
    old_end: u64,
    compatible_action: bool,
) -> ConflictClass {
    use ConflictClass as C;
    match classify_interval(new_start, new_end, old_start, old_end) {
        IntervalRelation::New => C::New,
        IntervalRelation::Conflict => C::Conflict,
        _ if !compatible_action => C::Conflict,
        IntervalRelation::Duplicate => C::Duplicate,
        IntervalRelation::Contained => C::Contained,
        IntervalRelation::Contains => C::Contains,
        IntervalRelation::Touching | IntervalRelation::Overlap => {
            if overlap_us(new_start, new_end, old_start, old_end) <= CUT_AUTO_MERGE_OVERLAP_US {
                C::Mergeable
            } else {
                C::Overlap
            }
        }
    }
}

pub(crate) fn classify_camera(
    new_start: u64,
    new_end: u64,
    old_start: u64,
    old_end: u64,
    same_effect: bool,
) -> ConflictClass {
    use ConflictClass as C;
    match classify_interval(new_start, new_end, old_start, old_end) {
        IntervalRelation::New | IntervalRelation::Touching => C::New,
        IntervalRelation::Conflict => C::Conflict,
        _ if !same_effect => C::Conflict,
        IntervalRelation::Duplicate => C::Duplicate,
        IntervalRelation::Contained => C::Contained,
        IntervalRelation::Contains | IntervalRelation::Overlap => C::Overlap,
    }
}

pub(crate) fn timecode(us: u64) -> String {
    let millis = us / 1_000;
    let hours = millis / 3_600_000;
    let minutes = millis / 60_000 % 60;
    let seconds = millis / 1_000 % 60;
    format!("{hours:02}:{minutes:02}:{seconds:02}.{:03}", millis % 1_000)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_interval_relations_and_epsilon() {
        assert_eq!(
            classify_interval(0, 1_000_000, 3_000_000, 4_000_000),
            IntervalRelation::New
        );
        assert_eq!(
            classify_interval(1_050_000, 2_960_000, 1_000_000, 3_000_000),
            IntervalRelation::Duplicate
        );
        assert_eq!(
            classify_interval(2_000_000, 3_000_000, 1_000_000, 4_000_000),
            IntervalRelation::Contained
        );
        assert_eq!(
            classify_interval(1_000_000, 4_000_000, 2_000_000, 3_000_000),
            IntervalRelation::Contains
        );
        assert_eq!(
            classify_interval(0, 1_000_000, 1_000_000, 2_000_000),
            IntervalRelation::Touching
        );
        assert_eq!(
            classify_interval(0, 2_000_000, 1_000_000, 3_000_000),
            IntervalRelation::Overlap
        );
        assert_eq!(classify_interval(2, 1, 1, 3), IntervalRelation::Conflict);
    }

    #[test]
    fn cut_and_camera_policies_are_distinct() {
        assert_eq!(
            classify_cut(14_800_000, 20_000_000, 10_000_000, 15_000_000, true),
            ConflictClass::Mergeable
        );
        assert_eq!(
            classify_cut(43_000_000, 48_000_000, 45_000_000, 52_000_000, true),
            ConflictClass::Overlap
        );
        assert_eq!(classify_cut(10, 20, 15, 25, false), ConflictClass::Conflict);
        assert_eq!(
            classify_camera(10, 20, 15, 25, false),
            ConflictClass::Conflict
        );
        assert_eq!(
            classify_camera(10_000_000, 20_000_000, 15_000_000, 25_000_000, true),
            ConflictClass::Overlap
        );
    }

    #[test]
    fn shows_hour_precision() {
        assert_eq!(timecode(3_600_123_000), "01:00:00.123");
    }
}
