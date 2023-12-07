import {
    Address,
    beginCell,
    Cell,
    Contract,
    contractAddress,
    ContractProvider,
    Dictionary,
    Sender,
    SendMode
} from 'ton-core';
import {Buffer} from "buffer";
import {buildJettonOnchainMetadata, JettonMetadata, readJettonMetadata} from "./utils/ContentUtils";
import {MultisigOrder} from "./utils/MultisigOrder";
import {sign} from "ton-crypto";

export type TempConfig = {
    adminMultisigAddress?: string,
    changingAdminMultisigTime?: number,
    transactionMultisigAddress?: string,
    changingTransactionMultisigTime?: number,
    commissionFactor?: number,
    changingCommissionTime?: number,
    commissionAddress?: string,
    changingCommissionAddressTime?: number,
    jettonContent?: JettonMetadata,
    changingContentTime?: number,
    changingFinancialCodeTime?: number,
    newFinancialCode?: Cell,
}

export type NK = {
    n: number,
    k: number
}

export type OwnerFlood = {
    owner_index: number,
    flood: number
}

export const AdminMultisigErrors = {
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
    updateDelayHasNotPassedYet: 40,
    INSUFFICIENT_INTERNAL_MSG_VALUE: 41,
    SENDER_ADDRESS_NOT_FOUND: 42,
    FLOOD_MORE_THAN_MAX: 43,
    MSG_DOESNT_MATCH: 44,
    QUERY_NOT_ACTIVE: 45,
    invalidCommissionFactor: 46,
    ExpiredQuery: 51
}

export type AdminMultisigConfig = {
    addresses: Address[],
    publicKeys: Buffer[],
    walletId: number;
    k: number;
    financialAddress: string;
    tempConfig?: TempConfig;
};

export function adminMultisigConfigToCell(config: AdminMultisigConfig): Cell {
    let owners = Dictionary.empty()
    let owners_addresses_info = Dictionary.empty()

    for (let i = 0; i < config.publicKeys.length; i += 1) {
        owners.set(i, Buffer.concat([config.publicKeys[i], Buffer.alloc(1)]))
    }

    for (let i = 0; i < config.addresses.length; i += 1) {
        var indexBuffer = new Buffer(1)
        indexBuffer.writeUint8(i)
        var floodBuffer = new Buffer(1)
        floodBuffer.writeUint8(0)

        owners_addresses_info.set(config.addresses[i].hash, Buffer.concat([indexBuffer, floodBuffer]))
    }

    const addressNone = beginCell().storeUint(0, 2).endCell().beginParse()

    let tempCell = beginCell()
    if (config.tempConfig?.adminMultisigAddress) {
        tempCell.storeAddress(Address.parse(config.tempConfig?.adminMultisigAddress))
    } else {
        tempCell.storeSlice(addressNone)
    }

    tempCell.storeUint(config.tempConfig?.changingAdminMultisigTime || 0n, 32)

    if (config.tempConfig?.transactionMultisigAddress) {
        tempCell.storeAddress(Address.parse(config.tempConfig?.transactionMultisigAddress))
    } else {
        tempCell.storeSlice(addressNone)
    }

    tempCell.storeUint(config.tempConfig?.changingTransactionMultisigTime || 0n, 32)

    tempCell
        .storeInt(config.tempConfig?.commissionFactor != undefined ? config.tempConfig?.commissionFactor : -1n, 16)
        .storeUint(config.tempConfig?.changingCommissionTime || 0n, 32)

    if (config.tempConfig?.commissionAddress) {
        tempCell.storeAddress(Address.parse(config.tempConfig.commissionAddress))
    } else {
        tempCell.storeSlice(addressNone)
    }
    tempCell.storeUint(config.tempConfig?.changingContentTime || 0n, 32)
    tempCell.storeUint(config.tempConfig?.changingFinancialCodeTime || 0n, 32)
    tempCell.storeUint(config.tempConfig?.changingCommissionAddressTime || 0n, 32)
    tempCell.storeRef(config.tempConfig?.jettonContent ? buildJettonOnchainMetadata(config.tempConfig.jettonContent) : beginCell().endCell())
    tempCell.storeRef(config.tempConfig?.newFinancialCode ?? beginCell().endCell())

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
        .storeRef(tempCell.endCell())
        .storeDict(
            owners_addresses_info,
            Dictionary.Keys.Buffer(32),
            Dictionary.Values.Buffer(2)
        )
        .endCell()
}

export class AdminMultisig implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static createFromAddress(address: Address) {
        return new AdminMultisig(address);
    }

    static createFromConfig(config: AdminMultisigConfig, code: Cell, workchain = 0) {
        const data = adminMultisigConfigToCell(config);
        const init = { code, data };
        return new AdminMultisig(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    async sendInternal(
        provider: ContractProvider,
        via: Sender, value: bigint,
        msgBody: Cell
    ) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: msgBody,
        })
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

    async getTempConfig(provider: ContractProvider): Promise<TempConfig> {
        const result = await provider.get('get_temp', [])
        return {
            adminMultisigAddress: result.stack.readAddressOpt()?.toString(),
            changingAdminMultisigTime: result.stack.readNumber(),
            transactionMultisigAddress: result.stack.readAddressOpt()?.toString(),
            changingTransactionMultisigTime: result.stack.readNumber(),
            commissionFactor: result.stack.readNumber(),
            changingCommissionTime: result.stack.readNumber(),
            commissionAddress: result.stack.readAddressOpt()?.toString(),
            changingCommissionAddressTime: result.stack.readNumber(),
            changingContentTime: result.stack.readNumber(),
            changingFinancialCodeTime: result.stack.readNumber(),
            jettonContent: (await readJettonMetadata(result.stack.readCell())).metadata as JettonMetadata,
            newFinancialCode: result.stack.readCell()
        }
    }

    async getNK(provider: ContractProvider): Promise<NK> {
        const result = await provider.get('get_n_k', [])
        return {
            n: result.stack.readNumber(),
            k: result.stack.readNumber()
        }
    }

    async getPublicKeys(provider: ContractProvider): Promise<Dictionary<number, Buffer>> {
        const result = await provider.get('get_public_keys', [])
        return result.stack.readCell().asSlice().loadDictDirect(
            Dictionary.Keys.Uint(8),
            Dictionary.Values.Buffer(32)
        );
    }

    async getOwnerFlood(provider: ContractProvider, address: string): Promise<OwnerFlood> {
        const ownerAddress = Address.parse(address)
        const cell = beginCell().storeAddress(ownerAddress).endCell();
        const result = await provider.get('get_owner_flood', [{type: "slice", cell: cell}])
        return {
            owner_index: result.stack.readNumber(),
            flood: result.stack.readNumber()
        }
    }
}
