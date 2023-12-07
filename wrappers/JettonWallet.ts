import {
    Address,
    beginCell,
    Cell,
    Contract,
    contractAddress,
    ContractProvider, fromNano,
    Sender,
    SendMode, Slice,
    toNano
} from "ton-core";

export type JettonWalletConfig = {
    balance: number;
    ownerAddress: string;
    jettonMasterAddress: string;
    jettonWalletCode: Cell;
}

export enum JettonWalletOpCodes {
    Burn = 0x595f07bc,
    InternalTransfer = 0x178d4519,
    Transfer = 0xf8a7ea5,
    ReturnTon = 4,
}

export const JettonWalletErrors = {
    noErrors: 0,

    notBounceableOp: 200,

    notWorkchain: 333,
    notMasterchain: 334,

    notFromJettonMaster: 704,
    notFromOwner: 705,
    insufficientJettonBalance: 706,
    notFromJettonMasterOrOwner: 707,
    emptyForwardPayload: 708,
    insufficientMsgValue: 709,

    unknownOp: 0xffff,
}

export function jettonWalletConfigToCell(config: JettonWalletConfig): Cell {
    return beginCell()
        .storeCoins(toNano(config.balance))
        .storeAddress(Address.parse(config.ownerAddress))
        .storeAddress(Address.parse(config.jettonMasterAddress))
        .storeRef(config.jettonWalletCode)
        .endCell()
}

export class JettonWallet implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell, data: Cell },
    ) {
    }

    static createFromAddress(address: Address) {
        return new JettonWallet(address)
    }

    static createFromConfig(config: JettonWalletConfig, code: Cell, workchain = 0) {
        const data = jettonWalletConfigToCell(config)
        const init = {code, data}
        return new JettonWallet(contractAddress(workchain, init), init)
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .endCell(),
        })
    }

    async sendBurn(
        provider: ContractProvider,
        via: Sender,
        value: bigint,
        opts: {
            queryId?: number;
            jettonAmount: number;
        }
    ) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(JettonWalletOpCodes.Burn, 32)
                .storeUint(opts.queryId || 0, 64)
                .storeCoins(toNano(opts.jettonAmount.toString()))
                .endCell(),
        })
    }

    async sendTransfer(
        provider: ContractProvider,
        via: Sender,
        value: bigint,
        opts: {
            queryId?: number;
            jettonAmount: number;
            toOwnerAddress: string;
            responseAddress?: string;
            forwardTonAmount?: number
            forwardPayload?: Slice
        }
    ) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(JettonWalletOpCodes.Transfer, 32)
                .storeUint(opts.queryId || 0, 64)
                .storeCoins(toNano(opts.jettonAmount))
                .storeAddress(Address.parse(opts.toOwnerAddress))
                .storeAddress(opts.responseAddress ? Address.parse(opts.responseAddress) : null)
                .storeDict(null) // custom payload
                .storeCoins(opts.forwardTonAmount || 0)
                .storeMaybeSlice(opts.forwardPayload)
                .endCell(),
        })
    }

    async sendReceive(
        provider: ContractProvider,
        via: Sender,
        value: bigint,
        opts: {
            queryId?: number;
            jettonAmount: number;
            fromOwnerAddress?: string;
            responseAddress?: string;
            forwardTonAmount?: number
            forwardPayload?: Slice
        }
    ) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(JettonWalletOpCodes.InternalTransfer, 32)
                .storeUint(opts.queryId || 0, 64)
                .storeCoins(toNano(opts.jettonAmount))
                .storeAddress(opts.fromOwnerAddress ? Address.parse(opts.fromOwnerAddress) : null)
                .storeAddress(opts.responseAddress ? Address.parse(opts.responseAddress) : null)
                .storeCoins(toNano(opts.forwardTonAmount?.toString() || 0))
                .storeMaybeSlice(opts.forwardPayload)
                .endCell(),
        })
    }

    async sendReturnTon(
        provider: ContractProvider,
        via: Sender,
        value: bigint,
    ) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(JettonWalletOpCodes.ReturnTon, 32)
                .endCell(),
        })
    }


    async getWalletData(provider: ContractProvider): Promise<JettonWalletConfig>{
        const result = await provider.get('get_wallet_data', [])
        return {
            balance: Number(fromNano(result.stack.readNumber())),
            ownerAddress: result.stack.readAddress().toString(),
            jettonMasterAddress: result.stack.readAddress().toString(),
            jettonWalletCode: result.stack.readCell()
        }
    }
}
