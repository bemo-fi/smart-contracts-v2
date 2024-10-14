import {
    Address,
    beginCell,
    Cell,
    Contract,
    contractAddress,
    ContractProvider,
    fromNano,
    Sender,
    SendMode,
    toNano
} from "@ton/core";
import {
    buildJettonOnchainMetadata,
    JettonMetadata,
    JettonMetaDataKeys,
    persistenceType,
    readJettonMetadata
} from "./utils/ContentUtils";
import {StorageStats} from "../tests/GasUtils";

export interface FinancialData {
    jettonTotalSupply: number;
    tonTotalSupply: number;
    commissionTotalSupply: number
    commissionFactor: number;
    commissionAddress?: string;
    persistenceType: persistenceType;
    metadata: { [s in JettonMetaDataKeys]?: string };
    isJettonDeployerFaultyOnChainData?: boolean;
    jettonWalletCode: Cell;
    adminAddress?: string;
    transactionAdminAddress?: string;
    contentUri?: string;
    lastLockupEpoch: number;
    lockupSupply: number;
    nextLockupSupply: number;
    laterLockupSupply: number;
    nextUnstakeRequestIndex: number;
    unstakeRequestCode: Cell;
}

export type FinancialConfig = {
    jettonTotalSupply?: number;
    tonTotalSupply?: number;
    commissionTotalSupply?: number;
    commissionFactor: number;
    commissionAddress: string;
    adminAddress: string;
    transactionAdminAddress: string;
    content: JettonMetadata;
    jettonWalletCode: Cell;
    lastLockupEpoch?: number;
    lockupSupply?: number;
    nextLockupSupply?: number;
    laterLockupSupply?: number;
    nextUnstakeRequestIndex?: number;
    unstakeRequestCode: Cell;
}

export const FinancialOpcodes = {
    mint: 0,
    stake: 0x4253c4d5,
    receiveTonWithReward: 1,
    burnNotification: 0x7bdd97de,
    unstake: 10,
    unstakeNotification: 0x90c80a07,
    getPools: 14,
    provideWalletAddress: 0x2c76b973,
    changeAdmin: 2,
    changeTransactionAdmin: 3,
    changeContent: 4,
    changeCommissionFactor: 5,
    changeCommissionAddress: 6,
    sendTon: 70,
    sendCommission: 80,
    acceptTon: 9,
    refreshLockupConfig: 11,
    deployUnstakeRequest: 100,
    returnUnstakeRequest: 101,
    updateUnstakeRequestCode: 90,
    updateCode: 5000,
    transferJetton: 0xf8a7ea5,
    provideQuote: 0xad83913f,
    takeQuote: 0xa420458,
    takeWalletAddress: 0xd1735400,
}

export const FinancialErrors = {
    noErrors: 0,

    invalidCommissionFactor: 46,

    notFromAdmin: 73,
    notFromJettonWallet: 74,
    notFromTransactionAdmin: 75,
    notFromUnstakeRequest: 76,

    insufficientBalance: 103,
    insufficientCommissionBalance: 104,
    msgValueLessThanReward: 105,

    notBounceableOp: 200,

    notWorkchain: 333,
    notMasterchain: 334,

    insufficientMsgValue: 709,

    unknownOp: 0xffff,
}

export function financialConfigToCell(config: FinancialConfig): Cell {
    return beginCell()
        .storeCoins(config.jettonTotalSupply ? toNano(config.jettonTotalSupply.toString()) : 1)
        .storeCoins(config.tonTotalSupply ? toNano(config.tonTotalSupply.toString()) : 1)
        .storeCoins(config.commissionTotalSupply ? toNano(config.commissionTotalSupply.toString()) : 0)
        .storeUint(config.commissionFactor, 16)
        .storeAddress(Address.parse(config.commissionAddress))
        .storeAddress(Address.parse(config.adminAddress))
        .storeAddress(Address.parse(config.transactionAdminAddress))
        .storeRef(buildJettonOnchainMetadata(config.content))
        .storeRef(config.jettonWalletCode)
        .storeRef(beginCell()
            .storeUint(config.lastLockupEpoch ?? 0, 32)
            .storeCoins(config.lockupSupply ? toNano(config.lockupSupply.toString()) : 0)
            .storeCoins(config.nextLockupSupply ? toNano(config.nextLockupSupply.toString()) : 0)
            .storeCoins(config.laterLockupSupply ? toNano(config.laterLockupSupply.toString()) : 0)
            .storeUint(config.nextUnstakeRequestIndex ?? 0, 64)
            .storeRef(config.unstakeRequestCode)
            .endCell())
        .endCell();
}

export class Financial implements Contract {

    static storageStats = new StorageStats(26889, 57);

    static stakeGas = 11382n
    static burnNotificationGas = 15293n
    static unstakeGas = 12116n

    constructor(
        readonly address: Address,
        readonly init?: { code: Cell, data: Cell },
    ) {
    }

    static createFromAddress(address: Address) {
        return new Financial(address)
    }

    static createFromConfig(config: FinancialConfig, code: Cell, workchain = 0) {
        const data = financialConfigToCell(config)
        const init = {code, data}
        return new Financial(contractAddress(workchain, init), init)
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(FinancialOpcodes.acceptTon, 32)
                .endCell(),
        })
    }

    async sendTonToFinancial(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(FinancialOpcodes.mint, 32)
                .endCell(),
        })
    }

    async sendStake(provider: ContractProvider, via: Sender, value: bigint, opts:{
        queryId?: number;
        forwardAmount: number;
        forwardPayload: Cell | null;
    }) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(FinancialOpcodes.stake, 32)
                .storeUint(opts.queryId ?? 0, 64)
                .storeCoins(toNano(opts.forwardAmount.toFixed(9)))
                .storeMaybeRef(opts.forwardPayload)
                .endCell(),
        })
    }

    async sendTonWithReward(
        provider: ContractProvider,
        via: Sender, value: bigint,
        opts: {
            reward: number;
        }
    ) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(FinancialOpcodes.receiveTonWithReward, 32)
                .storeCoins(toNano(opts.reward))
                .endCell(),
        })
    }

    async sendBurnNotification(
        provider: ContractProvider,
        via: Sender, value: bigint,
        opts: {
            queryId?: number;
            withdrawJettonAmount: number;
            fromAddress: string;
            receiverAddress?: string;
            customData?: Cell;
        }
    ) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(FinancialOpcodes.burnNotification, 32)
                .storeUint(opts.queryId || 0, 64)
                .storeCoins(opts.withdrawJettonAmount)
                .storeAddress(Address.parse(opts.fromAddress))
                .storeAddress(Address.parse(opts?.receiverAddress ? opts.receiverAddress : opts.fromAddress))
                .storeMaybeRef(opts.customData)
                .endCell(),
        })
    }

    async sendUnstake(
        provider: ContractProvider,
        via: Sender, value: bigint,
        opts: {
            index: number;
            ownerAddress: string;
            withdrawTonAmount: number;
            withdrawJettonAmount: number;
            forwardPayload?: Cell;
        }
    ) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(FinancialOpcodes.unstake, 32)
                .storeUint(opts.index, 64)
                .storeAddress(Address.parse(opts.ownerAddress))
                .storeCoins(toNano(opts.withdrawTonAmount.toString()))
                .storeCoins(toNano(opts.withdrawJettonAmount.toString()))
                .storeMaybeRef(opts.forwardPayload)
                .endCell(),
        })
    }

    async sendAcceptTon(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(FinancialOpcodes.acceptTon, 32)
                .endCell(),
        })
    }

    async sendRefreshLockupConfig(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(FinancialOpcodes.refreshLockupConfig, 32)
                .endCell(),
        })
    }

    async sendDiscovery(
        provider: ContractProvider,
        via: Sender,
        value: bigint = toNano('0.1'),
        opts: {
            queryId?: number;
            owner: string,
            includeAddress: boolean,
        }
    ) {
        await provider.internal(via, {
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(FinancialOpcodes.provideWalletAddress, 32)
                .storeUint(opts.queryId ?? 0, 64) // op, queryId
                .storeAddress(Address.parse(opts.owner))
                .storeBit(opts.includeAddress)
                .endCell(),
            value: value,
        });
    }

    async sendChangeAdmin(
        provider: ContractProvider,
        via: Sender, value: bigint,
        opts: {
            newAdminAddress: string
        }
    ) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(FinancialOpcodes.changeAdmin, 32)
                .storeAddress(Address.parse(opts.newAdminAddress))
                .endCell(),
        })
    }

    async sendChangeTransactionAdmin(
        provider: ContractProvider,
        via: Sender, value: bigint,
        opts: {
            newTransactionAdminAddress: string
        }
    ) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(FinancialOpcodes.changeTransactionAdmin, 32)
                .storeAddress(Address.parse(opts.newTransactionAdminAddress))
                .endCell(),
        })
    }

    async sendChangeContent(
        provider: ContractProvider,
        via: Sender, value: bigint,
        opts: {
            newContent: JettonMetadata
        }
    ) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(FinancialOpcodes.changeContent, 32)
                .storeRef(buildJettonOnchainMetadata(opts.newContent))
                .endCell(),
        })
    }

    async sendChangeCommissionFactor(
        provider: ContractProvider,
        via: Sender, value: bigint,
        opts: {
            newCommissionFactor: number
        }
    ) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(FinancialOpcodes.changeCommissionFactor, 32) // commission base 1000, example: 150/1000 = 0,15 = 15%
                .storeUint(opts.newCommissionFactor, 16)
                .endCell(),
        })
    }

    async sendGetPools(
        provider: ContractProvider,
        via: Sender, value: bigint,
        opts: {
            queryId?: number
        }
    ) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(FinancialOpcodes.getPools, 32)
                .storeUint(opts.queryId ?? 0, 64)
                .endCell(),
        })
    }

    async sendGetQuote(
        provider: ContractProvider,
        via: Sender, value: bigint,
        opts: {
            queryId: number,
            customPayload: Cell | null
        }
    ) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(FinancialOpcodes.provideQuote, 32)
                .storeUint(opts.queryId, 64)
                .storeMaybeRef(opts.customPayload)
                .endCell(),
        })
    }

    async sendChangeCommissionAddress(
        provider: ContractProvider,
        via: Sender, value: bigint,
        opts: {
            newCommissionAddress: string
        }
    ) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(FinancialOpcodes.changeCommissionAddress, 32)
                .storeAddress(Address.parse(opts.newCommissionAddress))
                .endCell(),
        })
    }

    async sendTonFromFinancial(
        provider: ContractProvider,
        via: Sender, value: bigint,
        opts: {
            destinationAddress: string
            amount: number
            payload?: Cell
        }
    ) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(FinancialOpcodes.sendTon, 32)
                .storeAddress(Address.parse(opts.destinationAddress))
                .storeCoins(toNano(opts.amount.toString()))
                .storeMaybeRef(opts.payload)
                .endCell(),
        })
    }

    async sendCommissionFromFinancial(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(FinancialOpcodes.sendCommission, 32)
                .endCell(),
        })
    }

    async sendUpdateCode(provider: ContractProvider, via: Sender, value: bigint, opts: { newCode: Cell }) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(FinancialOpcodes.updateCode, 32)
                .storeRef(opts.newCode)
                .endCell(),
        })
    }

    async sendTransferJetton(
        provider: ContractProvider,
        via: Sender,
        value: bigint,
        opts: {
            jettonWalletAddress: string,
            destinationAddress: string,
            jettonAmount: number
        }
    ) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(FinancialOpcodes.transferJetton, 32)
                .storeAddress(Address.parse(opts.jettonWalletAddress))
                .storeAddress(Address.parse(opts.destinationAddress))
                .storeCoins(toNano(opts.jettonAmount.toString()))
                .endCell(),
        })
    }

    async getFinancialData(provider: ContractProvider): Promise<FinancialData> {
        const result = await provider.get('get_full_data', [])

        const jettonTotalSupply = Number(fromNano(result.stack.readBigNumber()))
        const tonTotalSupply = Number(fromNano(result.stack.readBigNumber()))
        const commissionTotalSupply = Number(fromNano(result.stack.readBigNumber()))
        const commissionFactor = result.stack.readNumber()
        const commissionAddress = result.stack.readAddressOpt()?.toString()
        const adminAddress = result.stack.readAddressOpt()?.toString()
        const transactionAdminAddress = result.stack.readAddressOpt()?.toString()
        const contentCell = result.stack.readCell()
        const jettonWalletCode = result.stack.readCell()
        const unstakeRequestCode = result.stack.readCell()
        const lastLockupEpoch = result.stack.readNumber()
        const lockupSupply = Number(fromNano(result.stack.readBigNumber()))
        const nextLockupSupply = Number(fromNano(result.stack.readBigNumber()))
        const laterLockupSupply = Number(fromNano(result.stack.readBigNumber()))
        const nextUnstakeRequestIndex = result.stack.readNumber()

        const jettonContent = await readJettonMetadata(contentCell);
        const persistenceType = jettonContent.persistenceType;
        const metadata = jettonContent.metadata;
        const contentUri = jettonContent.contentUri ? jettonContent.contentUri : metadata.uri;
        const isJettonDeployerFaultyOnChainData = jettonContent.isJettonDeployerFaultyOnChainData;

        return {
            jettonTotalSupply,
            tonTotalSupply,
            commissionTotalSupply,
            commissionFactor,
            commissionAddress,
            adminAddress,
            transactionAdminAddress,
            contentUri,
            isJettonDeployerFaultyOnChainData,
            jettonWalletCode,
            metadata,
            persistenceType,
            unstakeRequestCode,
            lastLockupEpoch,
            lockupSupply,
            nextLockupSupply,
            laterLockupSupply,
            nextUnstakeRequestIndex
        }
    }

    async getTotalSupply(provider: ContractProvider) {
        const result = await provider.get('get_full_data', [])
        return result.stack.readBigNumber();
    }

    async getWalletAddress(provider: ContractProvider, address: string): Promise<Address> {
        const userAddress = Address.parse(address)
        const cell = beginCell().storeAddress(userAddress).endCell();
        const result = await provider.get('get_wallet_address', [{type: "slice", cell: cell}])
        return result.stack.readAddress()
    }

    // returns false if there is no such method in smart, and true if there is
    async getTestUpgradeCodeInfo(provider: ContractProvider): Promise<boolean> {
        try {
            const result = await provider.get('get_test_info', [])
            return result.stack.readNumber() == -1
        } catch (e) {
            return false;
        }
    }

    async getUnstakeRequestAddress(provider: ContractProvider, index: number): Promise<Address> {
        const result = await provider.get('get_unstake_request_address', [{type: "int", value: BigInt(index)}])
        return result.stack.readAddress()
    }

    async getLockupPeriod(provider: ContractProvider): Promise<number> {
        const result = await provider.get('get_lockup_period', [])
        return result.stack.readNumber()
    }
}
