import {Address, beginCell, Cell, toNano} from "@ton/core";
import {buildJettonOnchainMetadata, JettonMetadata} from "./ContentUtils";

export const AdminMultisigOpcodes = {
    changeAdminMultisig: 0x1345e3e,
    cancelChangingAdminMultisig: 0x69dd9cb,
    changeTransactionMultisig: 0x5fb0ba98,
    cancelChangingTransactionMultisig: 0x75f23ec3,
    changeContent: 0x34d22003,
    cancelChangingContent: 0x47a4e755,
    changeCommissionFactor: 0x7ea2bdae,
    cancelChangingCommissionFactor: 0x2357a2f4,
    changeCommissionAddress: 0x65cecbcc,
    cancelChangingCommissionAddress: 0x69fc24e6,
    changeFinancialCode: 0x60ef7f7b,
    cancelChangingFinancialCode: 0x3f21bfc,
    sendCommission: 0x43deb294,
    transferJetton: 0x384a37da,
    returnTon: 0x54fa365
}


export function getAdminMultisigInternalPayload(payload: Cell, walletId: number = 0, queryOffset: number = 7200): Cell {
    const time = BigInt(Math.floor(Date.now() / 1000 + queryOffset));
    const queryId = time << 32n;

    return beginCell()
        .storeUint(walletId, 32)
        .storeUint(queryId, 64)
        .storeRef(payload)
        .endCell()
}

export function getChangeAdminMultisigPayload(adminAddress: string): Cell {
    return beginCell()
        .storeUint(AdminMultisigOpcodes.changeAdminMultisig, 32)
        .storeAddress(Address.parse(adminAddress))
        .endCell()
}

export function getCancelChangingAdminMultisigPayload(): Cell {
    return beginCell()
        .storeUint(AdminMultisigOpcodes.cancelChangingAdminMultisig, 32)
        .endCell()
}

export function getChangeTransactionMultisigPayload(adminAddress: string): Cell {
    return beginCell()
        .storeUint(AdminMultisigOpcodes.changeTransactionMultisig, 32)
        .storeAddress(Address.parse(adminAddress))
        .endCell()
}

export function getCancelChangingTransactionMultisigPayload(): Cell {
    return beginCell()
        .storeUint(AdminMultisigOpcodes.cancelChangingTransactionMultisig, 32)
        .endCell()
}

export function getChangeContentPayload(content: JettonMetadata): Cell {
    return beginCell()
        .storeUint(AdminMultisigOpcodes.changeContent, 32)
        .storeRef(buildJettonOnchainMetadata(content))
        .endCell()
}

export function getCancelChangingContentPayload(): Cell {
    return beginCell()
        .storeUint(AdminMultisigOpcodes.cancelChangingContent, 32)
        .endCell()
}

export function getChangeCommissionFactorPayload(commissionFactor: number): Cell {
    return beginCell()
        .storeUint(AdminMultisigOpcodes.changeCommissionFactor, 32)
        .storeUint(commissionFactor, 16)
        .endCell()
}

export function getCancelChangingCommissionFactorPayload(): Cell {
    return beginCell()
        .storeUint(AdminMultisigOpcodes.cancelChangingCommissionFactor, 32)
        .endCell()
}

export function getChangeCommissionAddressPayload(commissionAddress: string): Cell {
    return beginCell()
        .storeUint(AdminMultisigOpcodes.changeCommissionAddress, 32)
        .storeAddress(Address.parse(commissionAddress))
        .endCell()
}

export function getCancelChangingCommissionAddressPayload(): Cell {
    return beginCell()
        .storeUint(AdminMultisigOpcodes.cancelChangingCommissionAddress, 32)
        .endCell()
}

export function getChangeFinancialCodePayload(financialCode: Cell): Cell {
    return beginCell()
        .storeUint(AdminMultisigOpcodes.changeFinancialCode, 32)
        .storeRef(financialCode)
        .endCell()
}

export function getCancelChangingFinancialCodePayload(): Cell {
    return beginCell()
        .storeUint(AdminMultisigOpcodes.cancelChangingFinancialCode, 32)
        .endCell()
}

export function getSendCommissionPayload(): Cell {
    return beginCell()
        .storeUint(AdminMultisigOpcodes.sendCommission, 32)
        .endCell()
}

export function getTransferJettonPayload(jettonWalletAddress: string, destinationAddress: string, jettonAmount: number): Cell {
    return beginCell()
        .storeUint(AdminMultisigOpcodes.transferJetton, 32)
        .storeAddress(Address.parse(jettonWalletAddress))
        .storeAddress(Address.parse(destinationAddress))
        .storeCoins(toNano(jettonAmount.toString()))
        .endCell()
}


export function getReturnTonPayload(destinationAddress: string): Cell {
    return beginCell()
        .storeUint(AdminMultisigOpcodes.returnTon, 32)
        .storeAddress(Address.parse(destinationAddress))
        .endCell()
}
