import {
    Address,
    beginCell,
    Cell,
    Contract,
    contractAddress,
    ContractProvider, Dictionary,
    Sender,
    SendMode,
    toNano
} from 'ton-core';

export const NominatorPoolCodeBase64 = "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"

export type NominatorPoolConfig = {
    validatorAddress: string;
    validatorRewardPercent: number;
    maxNominatorsCount: number;
    minValidatorStake: number;
    minNominatorStake: number;
};

export function nominatorPoolConfigToCell(config: NominatorPoolConfig): Cell {
    if (config.validatorRewardPercent > 100 && config.validatorRewardPercent < 0) {
        throw new Error("invalid percentage")
    }

    const validatorAddress = Address.parse(config.validatorAddress)

    const validatorConfig = beginCell()
        .storeBuffer(validatorAddress.hash, 32)
        .storeUint(config.validatorRewardPercent * 100, 16)
        .storeUint(config.maxNominatorsCount, 16)
        .storeCoins(toNano(config.minValidatorStake))
        .storeCoins(toNano(config.minNominatorStake))
        .endCell();

    return beginCell()
        .storeUint(0, 8)
        .storeUint(0, 16)
        .storeCoins(0)
        .storeCoins(0)
        .storeRef(validatorConfig)
        .storeDict(Dictionary.empty())
        .storeDict(Dictionary.empty())
        .storeUint(0, 32)
        .storeUint(0, 256)
        .storeUint(0, 8)
        .storeUint(0, 32)
        .storeUint(0, 32)
        .storeDict(Dictionary.empty())
        .endCell();
}

export class NominatorPool implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static createFromAddress(address: Address) {
        return new NominatorPool(address);
    }

    static createFromConfig(config: NominatorPoolConfig, code: Cell, workchain = 0) {
        const data = nominatorPoolConfigToCell(config);
        const init = { code, data };
        return new NominatorPool(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    async sendDistributeShare(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(1,32)
                .storeUint(0,64)
                .endCell(),
        })
    }

    async sendValidatorDeposit(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(4,32)
                .storeUint(0,64)
                .endCell(),
        })
    }

    async getNominatorList(provider: ContractProvider) {
        const result = await provider.get('has_withdraw_requests', [])
        return result.stack
    }
}
