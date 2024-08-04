import {
    Address,
    beginCell,
    Cell,
    Contract,
    contractAddress,
    ContractProvider,
    Dictionary,
    Sender,
    SendMode, toNano
} from '@ton/core';
import {MultisigOrder} from "./utils/MultisigOrder";
import {sign} from "@ton/crypto";

export type TransactionMultisigConfig = {
    publicKeys: Buffer[],
    walletId: number;
    k: number;
    financialAddress: string;
    proxyCode: Cell;
    poolCode: Cell;
};

export type PoolAndProxyAddresses = {
    poolAddress: string;
    proxyAddress: string;
};

export type NK = {
    n: number,
    k: number
}

export const TransactionMultisigErrors = {
    noErrors: 0,
    senderPublicKeyNotFound: 31,
    invalidSenderSignature: 32,
    walletIdDoesNotMatch: 33,
    queryHasAlreadyBeenCompleted: 34,
    invalidQueryId: 35,
    notAllOwnersConfirmed: 36,
    publicKeyNotFound: 37,
    invalidSignature: 38,
    alreadySigned: 39,

    notMasterchain: 334,
}

export function transactionMultisigConfigToCell(config: TransactionMultisigConfig): Cell {
    let owners = Dictionary.empty()

    for (let i = 0; i < config.publicKeys.length; i += 1) {
        owners.set(i, Buffer.concat([config.publicKeys[i], Buffer.alloc(1)]))
    }

    return beginCell()
        .storeUint(config.walletId, 32)
        .storeUint(owners.size, 8)
        .storeUint(config.k, 8)
        .storeDict(
            owners,
            Dictionary.Keys.Uint(8),
            Dictionary.Values.Buffer(33)
        )
        .storeBit(0)
        .storeAddress(Address.parse(config.financialAddress))
        .storeRef(config.proxyCode)
        .storeRef(config.poolCode)
        .endCell()
}

export class TransactionMultisig implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {
    }

    static createFromAddress(address: Address) {
        return new TransactionMultisig(address);
    }

    static createFromConfig(config: TransactionMultisigConfig, code: Cell, workchain = 0) {
        const data = transactionMultisigConfigToCell(config);
        const init = {code, data};
        return new TransactionMultisig(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    async sendOrder(
        provider: ContractProvider,
        order: MultisigOrder,
        secretKey: Buffer,
        ownerId: number
    ) {
        let cell = order.toCell(ownerId);

        let signature = sign(cell.hash(), secretKey);
        cell = beginCell()
            .storeBuffer(signature)
            .storeSlice(cell.asSlice())
            .endCell();

        await provider.external(cell);
    }

    async sendWrongOrder(
        provider: ContractProvider,
        order: MultisigOrder,
        secretKey: Buffer,
        ownerId: number
    ) {
        let cell = order.toWrongCell(ownerId);

        let signature = sign(cell.hash(), secretKey);
        cell = beginCell()
            .storeBuffer(signature)
            .storeSlice(cell.asSlice())
            .endCell();

        await provider.external(cell);
    }

    async getNK(provider: ContractProvider): Promise<NK> {
        const result = await provider.get('get_n_k', [])
        return {
            n: result.stack.readNumber(),
            k: result.stack.readNumber()
        }
    }

    async getProxyCode(provider: ContractProvider): Promise<Cell> {
        const result = await provider.get('get_full_data', [])
        result.stack.readNumber()
        result.stack.readNumber()
        result.stack.readNumber()
        result.stack.readCell()
        result.stack.readCell()
        result.stack.readAddress()

        return result.stack.readCell()
    }

    async getPoolCode(provider: ContractProvider): Promise<Cell> {
        const result = await provider.get('get_full_data', [])
        result.stack.readNumber()
        result.stack.readNumber()
        result.stack.readNumber()
        result.stack.readCell()
        result.stack.readCell()
        result.stack.readAddress()
        result.stack.readCell()

        return result.stack.readCell()
    }

    async getPublicKeys(provider: ContractProvider): Promise<Dictionary<number, Buffer>> {
        const result = await provider.get('get_public_keys', [])
        return result.stack.readCell().asSlice().loadDictDirect(
            Dictionary.Keys.Uint(8),
            Dictionary.Values.Buffer(32)
        );
    }

    async getPoolAndProxyAddresses(
        provider: ContractProvider,
        validatorAddress: string,
        validatorRewardPercent: number,
        maxNominatorsCount: number,
        minValidatorStake: number,
        minNominatorStake: number,
        walletId?: number
    ): Promise<PoolAndProxyAddresses> {
        const validator = Address.parse(validatorAddress)
        const cell = beginCell().storeAddress(validator).endCell();

        if (validatorRewardPercent > 100 && validatorRewardPercent < 0) {
            throw new Error("invalid percentage")
        }
        const result = await provider.get('get_pool_proxy_addresses', [
            {type: "slice", cell: cell},
            {type: "int", value: BigInt(validatorRewardPercent * 100)},
            {type: "int", value: BigInt(maxNominatorsCount)},
            {type: "int", value: toNano(minValidatorStake)},
            {type: "int", value: toNano(minNominatorStake)},
            {type: "int", value: BigInt(walletId ?? 0)},
        ])
        return {
            poolAddress: result.stack.readAddress().toString(),
            proxyAddress: result.stack.readAddress().toString()
        };
    }
}
