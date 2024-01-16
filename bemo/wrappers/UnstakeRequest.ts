import {
    Address,
    beginCell,
    Cell,
    Contract,
    contractAddress,
    ContractProvider, fromNano,
    Sender,
    SendMode,
    toNano
} from 'ton-core';

export type UnstakeRequestData = {
    index: number;
    financialAddress: string;
    ownerAddress?: string;
    withdrawTonAmount: number;
    withdrawJettonAmount: number;
    unlockTimestamp: number;
};

export type UnstakeRequestConfig = {
    index: number;
    financialAddress: string;
};

export const UnstakeRequestErrors = {
    noErrors: 0,

    notAllowed: 50,
    unlockTimestampHasNotExpiredYet: 51,

    insufficientBalance: 103
}

export const UnstakeRequestOpCodes = {
    deploy: 100,
    return: 101
}

export function unstakeRequestConfigToCell(config: UnstakeRequestConfig): Cell {
    return beginCell()
        .storeUint(config.index, 64)
        .storeAddress(Address.parse(config.financialAddress))
        .endCell();
}

export class UnstakeRequest implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static createFromAddress(address: Address) {
        return new UnstakeRequest(address);
    }

    static createFromConfig(config: UnstakeRequestConfig, code: Cell, workchain = 0) {
        const data = unstakeRequestConfigToCell(config);
        const init = { code, data };
        return new UnstakeRequest(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    async sendInit(provider: ContractProvider, via: Sender, value: bigint, opts: {
        ownerAddress: string;
        withdrawTonAmount: number;
        withdrawJettonAmount: number;
        unlockTimestamp: number
    }) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(UnstakeRequestOpCodes.deploy, 32)
                .storeAddress(Address.parse(opts.ownerAddress))
                .storeCoins(toNano(opts.withdrawTonAmount.toString()))
                .storeCoins(toNano(opts.withdrawJettonAmount.toString()))
                .storeUint(opts.unlockTimestamp, 32)
                .endCell(),
        });
    }

    async sendReturn(provider: ContractProvider, via: Sender, value: bigint, opts: {
        unlockTimestamp: number
    }) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(UnstakeRequestOpCodes.return, 32)
                .storeUint(opts.unlockTimestamp, 32)
                .endCell(),
        });
    }

    async sendInternalUnstake(provider: ContractProvider, via: Sender, value: bigint){
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    async sendExternalUnstake(provider: ContractProvider){
        await provider.external(beginCell().endCell());
    }

    async getUnstakeData(provider: ContractProvider): Promise<UnstakeRequestData> {
        const result = await provider.get('get_unstake_data', [])

        return {
            index: result.stack.readNumber(),
            financialAddress: result.stack.readAddress().toString(),
            ownerAddress: result.stack.readAddressOpt()?.toString(),
            withdrawTonAmount: Number(fromNano(result.stack.readNumber())),
            withdrawJettonAmount: Number(fromNano(result.stack.readNumber())),
            unlockTimestamp: result.stack.readNumber()
        }
    }
}
