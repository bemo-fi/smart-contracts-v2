import {Address, beginCell, Cell, toNano} from "ton-core";

export function getSendTonFromFinancialPayload(
    validatorAddress: string,
    validatorRewardPercent: number,
    maxNominatorsCount: number,
    minValidatorStake: number,
    minNominatorStake: number,
    amountInTon: number,
    walletId?: number
): Cell {
    if (validatorRewardPercent > 100 && validatorRewardPercent < 0) {
        throw new Error("invalid percentage")
    }
    return beginCell()
        .storeAddress(Address.parse(validatorAddress))
        .storeUint(validatorRewardPercent * 100, 16)
        .storeUint(maxNominatorsCount, 16)
        .storeCoins(toNano(minValidatorStake))
        .storeCoins(toNano(minNominatorStake))
        .storeUint(walletId ?? 0, 32)
        .storeCoins(toNano(amountInTon))
        .endCell()
}

