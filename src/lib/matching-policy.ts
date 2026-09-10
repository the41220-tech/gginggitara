export type MatchingCandidateEntry = {
  readonly id: string;
  readonly partySize: number;
  readonly departureMode: "fast" | "cheap";
  readonly priorityAt: string;
  readonly queueDeadlineAt: string;
};

export type MatchingCandidate = {
  readonly entryIds: readonly string[];
  readonly totalPartySize: number;
};

type CandidateAccumulator = {
  readonly entries: readonly MatchingCandidateEntry[];
  readonly totalPartySize: number;
};

const MAX_CAPACITY = 4;

function compareEntries(left: MatchingCandidateEntry, right: MatchingCandidateEntry): number {
  const priorityOrder = left.priorityAt.localeCompare(right.priorityAt);
  return priorityOrder === 0 ? left.id.localeCompare(right.id) : priorityOrder;
}

function enumerateCandidates(entries: readonly MatchingCandidateEntry[]): readonly CandidateAccumulator[] {
  const combinations: CandidateAccumulator[] = [];

  function visit(startIndex: number, selected: CandidateAccumulator): void {
    for (let index = startIndex; index < entries.length; index += 1) {
      const entry = entries[index];
      if (!entry || selected.totalPartySize + entry.partySize > MAX_CAPACITY) continue;

      const next = {
        entries: [...selected.entries, entry],
        totalPartySize: selected.totalPartySize + entry.partySize,
      } satisfies CandidateAccumulator;
      combinations.push(next);

      if (next.entries.length < MAX_CAPACITY) visit(index + 1, next);
    }
  }

  visit(0, { entries: [], totalPartySize: 0 });
  return combinations;
}

export function selectMatchCandidate(
  entries: readonly MatchingCandidateEntry[],
  serverNow: string,
): MatchingCandidate | null {
  const sorted = [...entries].sort(compareEntries);
  const eligible = enumerateCandidates(sorted).filter((candidate) => {
    if (candidate.entries.length < 2) return false;
    if (candidate.totalPartySize === MAX_CAPACITY) return true;
    if (candidate.totalPartySize < 2 || candidate.totalPartySize > 3) return false;

    const allFast = candidate.entries.every((entry) => entry.departureMode === "fast");
    const oldestDeadline = candidate.entries.reduce(
      (oldest, entry) => entry.queueDeadlineAt < oldest ? entry.queueDeadlineAt : oldest,
      candidate.entries[0]?.queueDeadlineAt ?? serverNow,
    );
    return allFast || oldestDeadline <= serverNow;
  });

  eligible.sort((left, right) => {
    const leftOldest = left.entries[0];
    const rightOldest = right.entries[0];
    if (!leftOldest || !rightOldest) return 0;
    const fifoOrder = compareEntries(leftOldest, rightOldest);
    if (fifoOrder !== 0) return fifoOrder;
    const fullnessOrder = Number(right.totalPartySize === MAX_CAPACITY) - Number(left.totalPartySize === MAX_CAPACITY);
    if (fullnessOrder !== 0) return fullnessOrder;
    if (left.totalPartySize !== right.totalPartySize) return right.totalPartySize - left.totalPartySize;
    return left.entries.length - right.entries.length;
  });

  const selected = eligible[0];
  return selected
    ? {
        entryIds: selected.entries.map((entry) => entry.id),
        totalPartySize: selected.totalPartySize,
      }
    : null;
}
