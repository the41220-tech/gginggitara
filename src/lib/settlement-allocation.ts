export type SettlementParty = {
  readonly id: string;
  readonly partySize: number;
};

export function allocateExactPartyAmounts(
  actualTotal: number,
  totalPeople: number,
  parties: readonly SettlementParty[],
): readonly number[] | null {
  if (!Number.isInteger(actualTotal) || actualTotal < 0 || !Number.isInteger(totalPeople) || totalPeople < 1) return null;
  if (parties.length === 0 || new Set(parties.map((party) => party.id)).size !== parties.length) return null;

  const partyPeople = parties.reduce((sum, party) => sum + party.partySize, 0);
  if (!parties.every((party) => Number.isInteger(party.partySize) && party.partySize > 0) || partyPeople !== totalPeople) return null;

  const perPersonFloor = Math.floor(actualTotal / totalPeople);
  let remainingExtraWon = actualTotal % totalPeople;
  return parties.map((party) => {
    const extraWon = Math.min(party.partySize, remainingExtraWon);
    remainingExtraWon -= extraWon;
    return perPersonFloor * party.partySize + extraWon;
  });
}
