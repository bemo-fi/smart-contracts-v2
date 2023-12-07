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
} from "ton-core";

export type NominatorProxyConfig = {
    walletId?: number;
    depositAmount?: number;
    financialAddress: string;
    nominatorPoolAddress: string;
    depositTime?: number;
    withdrawnTime?: number;
    lastWithdrawAddress?: string
}

export function nominatorProxyConfigToCell(config: NominatorProxyConfig): Cell {
    let cell = beginCell()
        .storeUint(config.walletId ?? 0, 32)
        .storeCoins(config.depositAmount ? toNano(config.depositAmount) : 0)
        .storeAddress(Address.parse(config.financialAddress))
        .storeAddress(Address.parse(config.nominatorPoolAddress))
        .storeUint(config.depositTime ?? 0, 64)
        .storeUint(config.withdrawnTime ?? 0, 64)

        if(config.lastWithdrawAddress != null){
            cell.storeAddress(Address.parse(config.lastWithdrawAddress))
        } else {
            cell.storeSlice(beginCell().storeUint(0, 2).endCell().beginParse())
        }

    return cell.endCell()
}

export const NominatorProxyOpcodes = {
    receiveTon: 0,
    sendTonToFinancial: 1,
    acceptTon: 2
}

export const NominatorProxyErrors = {
    noErrors: 0,
    insufficientBalance: 103,
    notBounceableOp: 200,
    accessDenied: 201,
    unknownAction: 202,
    notDeposited: 203,
    excessMsgValue: 204,
    withdrawHasAlreadyBeenMade: 205,
    withdrawTimeHasNotYetCome: 206,
    unknownOp: 0xffff,
}

export class NominatorProxy implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell, data: Cell },
    ) {}

    static createFromAddress(address: Address) {
        return new NominatorProxy(address)
    }

    static createFromConfig(config: NominatorProxyConfig, code: Cell, workchain = 0) {
        const data = nominatorProxyConfigToCell(config)
        const init = { code, data }
        return new NominatorProxy(contractAddress(workchain, init), init)
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(NominatorProxyOpcodes.acceptTon,32)
                .endCell(),
        })
    }

    async sendTonToNominatorProxy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(NominatorProxyOpcodes.receiveTon,32)
                .endCell(),
        })
    }

    async sendTonToFinancial(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(NominatorProxyOpcodes.sendTonToFinancial,32)
                .endCell(),
        })
    }

    async sendTon(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(2,32)
                .endCell(),
        })
    }

    async getProxyData(provider: ContractProvider): Promise<NominatorProxyConfig>{
        const result = await provider.get('get_proxy_data', [])

        return {
            walletId: result.stack.readNumber(),
            depositAmount: Number(fromNano(result.stack.readNumber())),
            financialAddress: result.stack.readAddress().toString(),
            nominatorPoolAddress: result.stack.readAddress().toString(),
            depositTime: result.stack.readNumber(),
            withdrawnTime: result.stack.readNumber(),
            lastWithdrawAddress: result.stack.readAddressOpt()?.toString()
        }
    }
}
