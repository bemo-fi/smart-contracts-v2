import {Blockchain, SandboxContract, TreasuryContract} from '@ton/sandbox';
import {beginCell, Cell, toNano} from '@ton/core';
import {AdminMultisig, AdminMultisigErrors, TempConfig} from '../wrappers/AdminMultisig';
import '@ton/test-utils';
import {compile} from '@ton/blueprint';
import {getOrderByPayload} from "../wrappers/utils/MultisigOrder";
import {
    getCancelChangingAdminMultisigPayload,
    getCancelChangingContentPayload,
    getCancelChangingTransactionMultisigPayload,
    getCancelChangingCommissionAddressPayload,
    getCancelChangingCommissionFactorPayload,
    getChangeAdminMultisigPayload,
    getChangeCommissionAddressPayload,
    getChangeCommissionFactorPayload,
    getChangeContentPayload,
    getChangeTransactionMultisigPayload,
    getSendCommissionPayload,
    getChangeFinancialCodePayload, getAdminMultisigInternalPayload, getTransferJettonPayload, getReturnTonPayload
} from "../wrappers/utils/AdminMultisigUtils";
import {buildJettonOnchainMetadata} from "../wrappers/utils/ContentUtils";
import {mnemonicNew, mnemonicToPrivateKey} from "ton-crypto";
import {KeyPair} from "ton-crypto/dist/primitives/nacl";
import {FinancialOpcodes} from "../wrappers/Financial";

describe('AdminMultisig', () => {
    let blockchain: Blockchain
    let code: Cell
    let financial: SandboxContract<TreasuryContract>
    let keypairs: KeyPair[]

    async function deployMultisig(n: number, tempConfig?: TempConfig, walletId: number = 0): Promise<SandboxContract<AdminMultisig>> {
        let mnemonics = []
        let publicKeys = []
        let addresses = []
        keypairs = []
        for (let i = 0; i < n; i++) {
            const wallet = await blockchain.treasury('owner' + i.toString())
            const mnemonic = await mnemonicNew()
            mnemonics.push(mnemonic)
            const keypair = await mnemonicToPrivateKey(mnemonic)
            keypairs.push(keypair)
            publicKeys.push(keypair.publicKey)
            addresses.push(wallet.address)
        }

        financial = await blockchain.treasury('financial')
        const multisig = blockchain.openContract(await AdminMultisig.createFromConfig({
            addresses: addresses,
            financialAddress: financial.address.toString(),
            k: n,
            tempConfig,
            publicKeys,
            walletId
        }, code))
        const deployer = await blockchain.treasury('deployer')
        const deployResult = await multisig.sendDeploy(deployer.getSender(), toNano('5'))

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: multisig.address,
            deploy: true,
            success: true
        })
        return multisig
    }

    beforeAll(async () => {
        code = await compile('AdminMultisig')
    })

    beforeEach(async () => {
        blockchain = await Blockchain.create()
    })

    it('[internal] should throw an error if signed by a non-owner', async () => {

        const n = 3
        const multisig = await deployMultisig(n)

        const initialTemp = await multisig.getTempConfig()
        expect(initialTemp.adminMultisigAddress).toBe(undefined)

        const newAdmin = await blockchain.treasury('newAdmin')
        const changeAdminMultisigPayload = getChangeAdminMultisigPayload(newAdmin.address.toString())
        const changeAdminMultisigMsg = getAdminMultisigInternalPayload(changeAdminMultisigPayload)

        const tonAmount = toNano('0.1')

        const anyone = await blockchain.treasury('anyone')

        const result = await multisig.sendInternal(anyone.getSender(), tonAmount, changeAdminMultisigMsg)

        expect(result.transactions.length).toBe(3)

        expect(result.transactions).toHaveTransaction({
            from: anyone.address,
            to: multisig.address,
            value: tonAmount,
            exitCode: AdminMultisigErrors.SENDER_ADDRESS_NOT_FOUND,
        })

        const temp = await multisig.getTempConfig()
        expect(temp.adminMultisigAddress).toBe(undefined)
    })

    it('[internal] real owner sends order should not throw error', async () => {
        const n = 3
        const multisig = await deployMultisig(n)
        const newAdmin = await blockchain.treasury('newAdmin')
        const changeAdminMultisigPayload = getChangeAdminMultisigPayload(newAdmin.address.toString())
        const changeAdminMultisigMsg = getAdminMultisigInternalPayload(changeAdminMultisigPayload)

        const tonAmount = toNano('0.1')

        const owner0 = await blockchain.treasury('owner0')

        const result = await multisig.sendInternal(owner0.getSender(), tonAmount, changeAdminMultisigMsg)

        expect(result.transactions.length).toBe(2)

        expect(result.transactions).toHaveTransaction({
            from: owner0.address,
            to: multisig.address,
            value: tonAmount,
            success: true,
        })

        const temp = await multisig.getTempConfig()
        expect(temp.adminMultisigAddress).toBe(undefined)

    })

    it('[internal] should change admin address but not send to financial', async () => {
        const n = 3
        const multisig = await deployMultisig(n)
        const newAdmin = await blockchain.treasury('newAdmin')
        const changeAdminMultisigPayload = getChangeAdminMultisigPayload(newAdmin.address.toString())
        const changeAdminMultisigMsg = getAdminMultisigInternalPayload(changeAdminMultisigPayload)

        const tonAmount = toNano('0.1')

        const owner0 = await blockchain.treasury('owner0')
        const owner1 = await blockchain.treasury('owner1')
        const owner2 = await blockchain.treasury('owner2')

        const result = await multisig.sendInternal(owner0.getSender(), tonAmount, changeAdminMultisigMsg)
        const result1 = await multisig.sendInternal(owner1.getSender(), tonAmount, changeAdminMultisigMsg)
        const result2 = await multisig.sendInternal(owner2.getSender(), tonAmount, changeAdminMultisigMsg)

        expect(result.transactions.length).toBe(2)

        expect(result.transactions).toHaveTransaction({
            from: owner0.address,
            to: multisig.address,
            value: tonAmount,
            success: true,
        })
        expect(result1.transactions.length).toBe(2)

        expect(result1.transactions).toHaveTransaction({
            from: owner1.address,
            to: multisig.address,
            value: tonAmount,
            success: true,
        })

        expect(result2.transactions.length).toBe(2)

        expect(result2.transactions).toHaveTransaction({
            from: owner2.address,
            to: multisig.address,
            value: tonAmount,
            success: true,
        })

        const temp = await multisig.getTempConfig()
        expect(temp.adminMultisigAddress).toBe(newAdmin.address.toString())

    })

    it('[internal] should throw error because different messages', async () => {
        const n = 3
        const multisig = await deployMultisig(n)
        const newAdmin = await blockchain.treasury('newAdmin')
        const newAdmin2 = await blockchain.treasury('newAdmin2')
        const changeAdminMultisigPayload = getChangeAdminMultisigPayload(newAdmin.address.toString())
        const changeAdminMultisigPayload2 = getChangeAdminMultisigPayload(newAdmin2.address.toString())
        const changeAdminMultisigMsg = getAdminMultisigInternalPayload(changeAdminMultisigPayload)
        const changeAdminMultisigMsg2 = getAdminMultisigInternalPayload(changeAdminMultisigPayload2)

        const tonAmount = toNano('0.1')

        const owner0 = await blockchain.treasury('owner0')
        const owner1 = await blockchain.treasury('owner1')

        const result = await multisig.sendInternal(owner0.getSender(), tonAmount, changeAdminMultisigMsg)
        const result1 = await multisig.sendInternal(owner1.getSender(), tonAmount, changeAdminMultisigMsg2)

        expect(result.transactions.length).toBe(2)

        expect(result.transactions).toHaveTransaction({
            from: owner0.address,
            to: multisig.address,
            value: tonAmount,
            success: true,
        })
        expect(result1.transactions.length).toBe(3)

        expect(result1.transactions).toHaveTransaction({
            from: owner1.address,
            to: multisig.address,
            value: tonAmount,
            success: false,
            exitCode: AdminMultisigErrors.MSG_DOESNT_MATCH
        })

        const temp = await multisig.getTempConfig()
        expect(temp.adminMultisigAddress).toBe(undefined)

    })

    it('[internal] should throw an error if backdated', async () => {
        const n = 3
        const multisig = await deployMultisig(n)
        const owner0 = await blockchain.treasury('owner0')
        const tonAmount = toNano('0.1')
        const newAdmin = await blockchain.treasury('newAdmin')
        const changeAdminMultisigPayload = getChangeAdminMultisigPayload(newAdmin.address.toString())
        const changeAdminMultisigOrder = getAdminMultisigInternalPayload(changeAdminMultisigPayload, 0, -7200)
        const result = await multisig.sendInternal(owner0.getSender(), tonAmount, changeAdminMultisigOrder)
        expect(result.transactions.length).toBe(3)

        expect(result.transactions).toHaveTransaction({
            from: owner0.address,
            to: multisig.address,
            value: tonAmount,
            success: false,
            exitCode: AdminMultisigErrors.invalidQueryId
        })

        const temp = await multisig.getTempConfig()
        expect(temp.adminMultisigAddress).toBe(undefined)
    })

    it('[internal] should throw an error if query id is too large', async () => {
        const n = 3
        const multisig = await deployMultisig(n)
        const owner0 = await blockchain.treasury('owner0')
        const tonAmount = toNano('0.1')
        const newAdmin = await blockchain.treasury('newAdmin')
        const changeAdminMultisigPayload = getChangeAdminMultisigPayload(newAdmin.address.toString())
        const changeAdminMultisigOrder = getAdminMultisigInternalPayload(changeAdminMultisigPayload, 0, 60 * 60 * 70)
        const result = await multisig.sendInternal(owner0.getSender(), tonAmount, changeAdminMultisigOrder)
        expect(result.transactions.length).toBe(3)

        expect(result.transactions).toHaveTransaction({
            from: owner0.address,
            to: multisig.address,
            value: tonAmount,
            success: false,
            exitCode: AdminMultisigErrors.invalidQueryId
        })

        const temp = await multisig.getTempConfig()
        expect(temp.adminMultisigAddress).toBe(undefined)
    })

    it('[internal] should change admin address and send to financial', async () => {
        const n = 3
        const newAdmin = await blockchain.treasury('newAdmin')

        const multisig = await deployMultisig(n, {
            adminMultisigAddress: newAdmin.address.toString(),
            changingAdminMultisigTime: Math.floor(Date.now() / 1000) - 60 * 60 * 180 // now - 180 hours
        })
        const changeAdminMultisigPayload = getChangeAdminMultisigPayload(newAdmin.address.toString())
        const changeAdminMultisigMsg = getAdminMultisigInternalPayload(changeAdminMultisigPayload)

        const tonAmount = toNano('0.1')

        const owner0 = await blockchain.treasury('owner0')
        const owner1 = await blockchain.treasury('owner1')
        const owner2 = await blockchain.treasury('owner2')

        const result = await multisig.sendInternal(owner0.getSender(), tonAmount, changeAdminMultisigMsg)
        const result1 = await multisig.sendInternal(owner1.getSender(), tonAmount, changeAdminMultisigMsg)
        const result2 = await multisig.sendInternal(owner2.getSender(), tonAmount, changeAdminMultisigMsg)

        expect(result.transactions.length).toBe(2)

        expect(result.transactions).toHaveTransaction({
            from: owner0.address,
            to: multisig.address,
            value: tonAmount,
            success: true,
        })
        expect(result1.transactions.length).toBe(2)

        expect(result1.transactions).toHaveTransaction({
            from: owner1.address,
            to: multisig.address,
            value: tonAmount,
            success: true,
        })

        expect(result2.transactions.length).toBe(3)

        expect(result2.transactions).toHaveTransaction({
            from: owner2.address,
            to: multisig.address,
            value: tonAmount,
            success: true,
        })

        expect(result2.transactions).toHaveTransaction({
            from: multisig.address,
            to: financial.address,
            body: beginCell().storeUint(FinancialOpcodes.changeAdmin, 32).storeAddress(newAdmin.address).endCell(),
            success: true,
        })

        const temp = await multisig.getTempConfig()
        expect(temp.adminMultisigAddress).toBe(undefined)

    })

    it('[internal] should throw error double sign', async () => {
        const n = 3
        const multisig = await deployMultisig(n)
        const newAdmin = await blockchain.treasury('newAdmin')
        const changeAdminMultisigPayload = getChangeAdminMultisigPayload(newAdmin.address.toString())
        const changeAdminMultisigMsg = getAdminMultisigInternalPayload(changeAdminMultisigPayload)

        const tonAmount = toNano('0.1')

        const owner0 = await blockchain.treasury('owner0')

        const result = await multisig.sendInternal(owner0.getSender(), tonAmount, changeAdminMultisigMsg)

        expect(result.transactions.length).toBe(2)

        expect(result.transactions).toHaveTransaction({
            from: owner0.address,
            to: multisig.address,
            value: tonAmount,
            success: true,
        })

        const result2 = await multisig.sendInternal(owner0.getSender(), tonAmount, changeAdminMultisigMsg)

        expect(result2.transactions.length).toBe(3)

        expect(result2.transactions).toHaveTransaction({
            from: owner0.address,
            to: multisig.address,
            value: tonAmount,
            exitCode: AdminMultisigErrors.alreadySigned,
            success: false,
        })

        const temp = await multisig.getTempConfig()
        expect(temp.adminMultisigAddress).toBe(undefined)

    })

    it('[internal] should throw error because flood is max', async () => {
        const n = 3
        const multisig = await deployMultisig(n)
        const newAdmin = await blockchain.treasury('newAdmin')
        const changeAdminMultisigPayload = getChangeAdminMultisigPayload(newAdmin.address.toString())

        const tonAmount = toNano('0.1')

        const owner0 = await blockchain.treasury('owner0')

        for (let i = 0; i < 10; i++) {
            let changeAdminMultisigMsg = getAdminMultisigInternalPayload(changeAdminMultisigPayload,  0, 7200 + i)
            let result = await multisig.sendInternal(owner0.getSender(), tonAmount, changeAdminMultisigMsg)
            expect(result.transactions.length).toBe(2)

            expect(result.transactions).toHaveTransaction({
                from: owner0.address,
                to: multisig.address,
                value: tonAmount,
                success: true,
            })
        }
        let changeAdminMultisigMsgNew = getAdminMultisigInternalPayload(changeAdminMultisigPayload,  0, 7200 + 100)

        let result = await multisig.sendInternal(owner0.getSender(), tonAmount, changeAdminMultisigMsgNew)

        expect(result.transactions.length).toBe(3)

        expect(result.transactions).toHaveTransaction({
            from: owner0.address,
            to: multisig.address,
            value: tonAmount,
            exitCode: AdminMultisigErrors.FLOOD_MORE_THAN_MAX,
            success: false,
        })

        const temp = await multisig.getTempConfig()
        expect(temp.adminMultisigAddress).toBe(undefined)

    })

    it('[internal] should decrease flood for owner', async () => {
        const n = 3
        blockchain.now = Math.floor(Date.now() / 1000)
        const multisig = await deployMultisig(n)
        const newAdmin = await blockchain.treasury('newAdmin')
        const changeAdminMultisigPayload = getChangeAdminMultisigPayload(newAdmin.address.toString())
        const changeAdminMultisigMsg1 = getAdminMultisigInternalPayload(changeAdminMultisigPayload, 0, 7200)
        const owner0 = await blockchain.treasury('owner0')
        const tonAmount = toNano('0.1')
        let initOwner0Flood = await multisig.getOwnerFlood(owner0.address.toString())
        await multisig.sendInternal(owner0.getSender(), tonAmount, changeAdminMultisigMsg1)
        let owner0Flood = await multisig.getOwnerFlood(owner0.address.toString())
        expect(owner0Flood.flood).toBe(initOwner0Flood.flood + 1)
        initOwner0Flood = owner0Flood
        blockchain.now = Math.floor(Date.now() / 1000) + 60 * 60 * 20
        const changeAdminMultisigMsg2 = getAdminMultisigInternalPayload(changeAdminMultisigPayload, 0, blockchain.now - Math.floor(Date.now() / 1000) + 60 * 60 * 20)
        const owner1 = await blockchain.treasury('owner1')
        const result = await multisig.sendInternal(owner1.getSender(), tonAmount, changeAdminMultisigMsg2)

        expect(result.transactions.length).toBe(2)

        expect(result.transactions).toHaveTransaction({
            to: multisig.address,
            from: owner1.address,
            exitCode: AdminMultisigErrors.noErrors
        })

        owner0Flood = await multisig.getOwnerFlood(owner0.address.toString())
        expect(owner0Flood.flood).toBe(initOwner0Flood.flood - 1)
    })

    it('should throw an error if signed by a non-owner', async () => {
        const n = 3
        const multisig = await deployMultisig(n)
        const newAdmin = await blockchain.treasury('newAdmin')
        const changeAdminMultisigPayload = getChangeAdminMultisigPayload(newAdmin.address.toString())
        const changeAdminMultisigOrder = getOrderByPayload(changeAdminMultisigPayload)
        for (let i = 1; i < n; i++) {
            changeAdminMultisigOrder.sign(i, keypairs[i].secretKey)
        }
        const nonOwnerMnemonic = await mnemonicNew()
        const nonOwnerKeyPair = await mnemonicToPrivateKey(nonOwnerMnemonic)
        try {
            await multisig.sendOrder(changeAdminMultisigOrder, nonOwnerKeyPair.secretKey, 0)
        } catch (e) {
        }
        const temp = await multisig.getTempConfig()
        expect(temp.adminMultisigAddress).toBe(undefined)
    })

    it('should throw an error if there is a non-owner signature in the signatures', async () => {
        const n = 3
        const multisig = await deployMultisig(n)
        const newAdmin = await blockchain.treasury('newAdmin')
        const changeAdminMultisigPayload = getChangeAdminMultisigPayload(newAdmin.address.toString())
        const changeAdminMultisigOrder = getOrderByPayload(changeAdminMultisigPayload)
        for (let i = 1; i < n; i++) {
            changeAdminMultisigOrder.sign(i, keypairs[i].secretKey)
        }
        const nonOwnerMnemonic = await mnemonicNew()
        const nonOwnerKeyPair = await mnemonicToPrivateKey(nonOwnerMnemonic)
        changeAdminMultisigOrder.sign(2, nonOwnerKeyPair.secretKey)
        const result = await multisig.sendOrder(changeAdminMultisigOrder, keypairs[0].secretKey, 0)
        expect(result.transactions.length).toBe(1)
        expect(result.transactions).toHaveTransaction({
            to: multisig.address,
            exitCode: 38
        })
        const temp = await multisig.getTempConfig()
        expect(temp.adminMultisigAddress).toBe(undefined)
    })

    it('should throw an error if not all owners signed the order', async () => {
        const n = 3
        const multisig = await deployMultisig(n)
        const newAdmin = await blockchain.treasury('newAdmin')
        const changeAdminMultisigPayload = getChangeAdminMultisigPayload(newAdmin.address.toString())
        const changeAdminMultisigOrder = getOrderByPayload(changeAdminMultisigPayload)
        for (let i = 1; i < n; i++) {
            changeAdminMultisigOrder.sign(i, keypairs[i].secretKey)
        }
        const result = await multisig.sendOrder(changeAdminMultisigOrder, keypairs[0].secretKey, 0)
        expect(result.transactions.length).toBe(1)
        expect(result.transactions).toHaveTransaction({
            to: multisig.address,
            exitCode: 36
        })
        const temp = await multisig.getTempConfig()
        expect(temp.adminMultisigAddress).toBe(undefined)
    })

    it('should throw an error if one owner signed k times', async () => {
        const n = 3
        const multisig = await deployMultisig(n)
        const newAdmin = await blockchain.treasury('newAdmin')
        const changeAdminMultisigPayload = getChangeAdminMultisigPayload(newAdmin.address.toString())
        const changeAdminMultisigOrder = getOrderByPayload(changeAdminMultisigPayload)
        for (let i = 0; i < n; i++) {
            changeAdminMultisigOrder.sign(i, keypairs[i].secretKey)
        }
        const result = await multisig.sendWrongOrder(changeAdminMultisigOrder, keypairs[0].secretKey, 0)
        expect(result.transactions.length).toBe(1)
        expect(result.transactions).toHaveTransaction({
            to: multisig.address,
            exitCode: AdminMultisigErrors.alreadySigned
        })
        const temp = await multisig.getTempConfig()
        expect(temp.adminMultisigAddress).toBe(undefined)
    })

    it('should throw an error if backdated', async () => {
        const n = 3
        const multisig = await deployMultisig(n)
        const newAdmin = await blockchain.treasury('newAdmin')
        const changeAdminMultisigPayload = getChangeAdminMultisigPayload(newAdmin.address.toString())
        const changeAdminMultisigOrder = getOrderByPayload(changeAdminMultisigPayload, 0, -7200)
        for (let i = 0; i < n; i++) {
            changeAdminMultisigOrder.sign(i, keypairs[i].secretKey)
        }
        // 35
        try {
            await multisig.sendOrder(changeAdminMultisigOrder, keypairs[0].secretKey, 0)
        } catch (e) {}

        const temp = await multisig.getTempConfig()
        expect(temp.adminMultisigAddress).toBe(undefined)
    })

    it('should throw an error if query id is too large', async () => {
        const n = 3
        const multisig = await deployMultisig(n)
        const newAdmin = await blockchain.treasury('newAdmin')
        const changeAdminMultisigPayload = getChangeAdminMultisigPayload(newAdmin.address.toString())
        const changeAdminMultisigOrder = getOrderByPayload(changeAdminMultisigPayload, 0, 60 * 60 * 70)
        for (let i = 0; i < n; i++) {
            changeAdminMultisigOrder.sign(i, keypairs[i].secretKey)
        }
        // 35
        try {
            await multisig.sendOrder(changeAdminMultisigOrder, keypairs[0].secretKey, 0)
        } catch (e) {}

        const temp = await multisig.getTempConfig()
        expect(temp.adminMultisigAddress).toBe(undefined)
    })

    //you need to manually check the error code, 34
    it('should throw an error if query has already been completed', async () => {
        const n = 3
        const multisig = await deployMultisig(n)
        const newAdmin = await blockchain.treasury('newAdmin')
        const changeAdminMultisigPayload = getChangeAdminMultisigPayload(newAdmin.address.toString())
        const changeAdminMultisigOrder = getOrderByPayload(changeAdminMultisigPayload, 0, 7200)
        for (let i = 0; i < n; i++) {
            changeAdminMultisigOrder.sign(i, keypairs[i].secretKey)
        }

        await multisig.sendOrder(changeAdminMultisigOrder, keypairs[0].secretKey, 0)
        let temp = await multisig.getTempConfig()
        expect(temp.adminMultisigAddress).toBe(newAdmin.address.toString())
        try {
            await multisig.sendOrder(changeAdminMultisigOrder, keypairs[0].secretKey, 0)
        } catch (e) {}

        temp = await multisig.getTempConfig()
        expect(temp.adminMultisigAddress).toBe(newAdmin.address.toString())
    })

    it('[change admin] should set new admin address but not send to financial', async () => {
        const n = 3
        const multisig = await deployMultisig(n)

        const initialTemp = await multisig.getTempConfig()
        expect(initialTemp.adminMultisigAddress).toBe(undefined)
        const newAdmin = await blockchain.treasury('newAdmin')
        const changeAdminMultisigPayload = getChangeAdminMultisigPayload(newAdmin.address.toString())
        const changeAdminMultisigOrder1 = getOrderByPayload(changeAdminMultisigPayload)
        const changeAdminMultisigOrder2 = getOrderByPayload(changeAdminMultisigPayload, 0, 7222)
        for (let i = 0; i < n; i++) {
            changeAdminMultisigOrder1.sign(i, keypairs[i].secretKey)
            changeAdminMultisigOrder2.sign(i, keypairs[i].secretKey)
        }

        const time = Math.floor(Date.now() / 1000);
        const result1 = await multisig.sendOrder(changeAdminMultisigOrder1, keypairs[0].secretKey, 0)
        expect(result1.transactions.length).toBe(1)
        expect(result1.transactions).toHaveTransaction({
            to: multisig.address,
            exitCode: AdminMultisigErrors.noErrors
        })
        const temp1 = await multisig.getTempConfig()
        expect(temp1.adminMultisigAddress).toBe(newAdmin.address.toString())
        expect(temp1.changingAdminMultisigTime).toBeGreaterThanOrEqual(time)

        try {
            await multisig.sendOrder(changeAdminMultisigOrder1, keypairs[0].secretKey, 0)
        } catch (e) {}

        const temp2 = await multisig.getTempConfig()
        expect(temp2.adminMultisigAddress).toBe(newAdmin.address.toString())
        expect(temp2.changingAdminMultisigTime).toBeGreaterThanOrEqual(time)

        const result3 = await multisig.sendOrder(changeAdminMultisigOrder2, keypairs[0].secretKey, 0)
        expect(result3.transactions.length).toBe(1)
        expect(result3.transactions).toHaveTransaction({
            to: multisig.address,
            exitCode: AdminMultisigErrors.updateDelayHasNotPassedYet
        })
        const temp3 = await multisig.getTempConfig()
        expect(temp3.adminMultisigAddress).toBe(newAdmin.address.toString())
        expect(temp3.changingAdminMultisigTime).toBeGreaterThanOrEqual(time)
    })

    it('[change admin] should send specified admin address to financial', async () => {
        const n = 3
        const newAdmin = await blockchain.treasury('newAdmin')
        const multisig = await deployMultisig(n, {
            adminMultisigAddress: newAdmin.address.toString(),
            changingAdminMultisigTime: Math.floor(Date.now() / 1000) - 60 * 60 * 180 // now - 180 hours
        })
        const initialTemp = await multisig.getTempConfig()
        expect(initialTemp.adminMultisigAddress).toBe(newAdmin.address.toString())
        const changeAdminMultisigPayload = getChangeAdminMultisigPayload(newAdmin.address.toString())
        const changeAdminMultisigOrder = getOrderByPayload(changeAdminMultisigPayload)
        for (let i = 0; i < n; i++) {
            changeAdminMultisigOrder.sign(i, keypairs[i].secretKey)
        }
        const result = await multisig.sendOrder(changeAdminMultisigOrder, keypairs[0].secretKey, 0)
        expect(result.transactions.length).toBe(2)
        expect(result.transactions).toHaveTransaction({
            to: multisig.address,
            exitCode: AdminMultisigErrors.noErrors
        })

        expect(result.transactions).toHaveTransaction({
            from: multisig.address,
            to: financial.address,
            body: beginCell().storeUint(FinancialOpcodes.changeAdmin, 32).storeAddress(newAdmin.address).endCell(),
            exitCode: AdminMultisigErrors.noErrors
        })

        const temp = await multisig.getTempConfig()
        expect(temp.adminMultisigAddress).toBe(undefined)
    })

    it('[cancel changing admin] should clear admin address in temp', async () => {
        const n = 3
        const multisig = await deployMultisig(n)
        const newAdmin = await blockchain.treasury('newAdmin')
        const initialTemp = await multisig.getTempConfig()
        expect(initialTemp.adminMultisigAddress).toBe(undefined)
        const changeAdminMultisigPayload = getChangeAdminMultisigPayload(newAdmin.address.toString())
        const changeAdminMultisigOrder = getOrderByPayload(changeAdminMultisigPayload)

        const cancelChangingAdminMultisigPayload = getCancelChangingAdminMultisigPayload()
        const cancelChangingAdminMultisigOrder1 = getOrderByPayload(cancelChangingAdminMultisigPayload, 0, 7222)
        const cancelChangingAdminMultisigOrder2 = getOrderByPayload(cancelChangingAdminMultisigPayload, 0, 7233)
        for (let i = 0; i < n; i++) {
            changeAdminMultisigOrder.sign(i, keypairs[i].secretKey)
            cancelChangingAdminMultisigOrder1.sign(i, keypairs[i].secretKey)
            cancelChangingAdminMultisigOrder2.sign(i, keypairs[i].secretKey)
        }

        const time = Math.floor(Date.now() / 1000);
        await multisig.sendOrder(changeAdminMultisigOrder, keypairs[0].secretKey, 0)
        const temp1 = await multisig.getTempConfig()
        expect(temp1.adminMultisigAddress).toBe(newAdmin.address.toString())
        expect(temp1.changingAdminMultisigTime).toBeGreaterThanOrEqual(time)
        const result = await multisig.sendOrder(cancelChangingAdminMultisigOrder1, keypairs[0].secretKey, 0)
        expect(result.transactions.length).toBe(1)
        expect(result.transactions).toHaveTransaction({
            to: multisig.address,
            exitCode: AdminMultisigErrors.noErrors
        })
        const temp2 = await multisig.getTempConfig()
        expect(temp2.adminMultisigAddress).toBe(undefined)

        await multisig.sendOrder(cancelChangingAdminMultisigOrder2, keypairs[0].secretKey, 0)
        const temp3 = await multisig.getTempConfig()
        expect(temp3.adminMultisigAddress).toBe(undefined)
    })

    it('[change transaction admin] should set new transaction admin address but not send to financial', async () => {
        const n = 3
        const multisig = await deployMultisig(n)

        const initialTemp = await multisig.getTempConfig()
        expect(initialTemp.transactionMultisigAddress).toBe(undefined)
        const newAdmin = await blockchain.treasury('newAdmin')
        const changeTransactionMultisigPayload = getChangeTransactionMultisigPayload(newAdmin.address.toString())
        const changeTransactionMultisigOrder1 = getOrderByPayload(changeTransactionMultisigPayload)
        const changeTransactionMultisigOrder2 = getOrderByPayload(changeTransactionMultisigPayload, 0, 7222)
        for (let i = 0; i < n; i++) {
            changeTransactionMultisigOrder1.sign(i, keypairs[i].secretKey)
            changeTransactionMultisigOrder2.sign(i, keypairs[i].secretKey)
        }
        const time = Math.floor(Date.now() / 1000);
        const result1 = await multisig.sendOrder(changeTransactionMultisigOrder1, keypairs[0].secretKey, 0)
        expect(result1.transactions.length).toBe(1)
        expect(result1.transactions).toHaveTransaction({
            to: multisig.address,
            exitCode: AdminMultisigErrors.noErrors
        })
        const temp1 = await multisig.getTempConfig()
        expect(temp1.transactionMultisigAddress).toBe(newAdmin.address.toString())
        expect(temp1.changingTransactionMultisigTime).toBeGreaterThanOrEqual(time)

        try {
            await multisig.sendOrder(changeTransactionMultisigOrder1, keypairs[0].secretKey, 0)
        } catch (e) {}

        const temp2 = await multisig.getTempConfig()
        expect(temp2.transactionMultisigAddress).toBe(newAdmin.address.toString())
        expect(temp2.changingTransactionMultisigTime).toBeGreaterThanOrEqual(time)

        const result3 = await multisig.sendOrder(changeTransactionMultisigOrder2, keypairs[0].secretKey, 0)
        expect(result3.transactions.length).toBe(1)
        expect(result3.transactions).toHaveTransaction({
            to: multisig.address,
            exitCode: AdminMultisigErrors.updateDelayHasNotPassedYet
        })
        const temp3 = await multisig.getTempConfig()
        expect(temp3.transactionMultisigAddress).toBe(newAdmin.address.toString())
        expect(temp3.changingTransactionMultisigTime).toBeGreaterThanOrEqual(time)
    })

    it('[change transaction admin] should send specified transaction admin address to financial', async () => {
        const n = 3
        const newAdmin = await blockchain.treasury('newAdmin')
        const multisig = await deployMultisig(n, {
            transactionMultisigAddress: newAdmin.address.toString(),
            changingTransactionMultisigTime: Math.floor(Date.now() / 1000) - 60 * 60 * 180 // now - 180 hours
        })
        const initialTemp = await multisig.getTempConfig()
        expect(initialTemp.transactionMultisigAddress).toBe(newAdmin.address.toString())
        const changeTransactionMultisigPayload = getChangeTransactionMultisigPayload(newAdmin.address.toString())
        const changeTransactionMultisigOrder = getOrderByPayload(changeTransactionMultisigPayload)
        for (let i = 0; i < n; i++) {
            changeTransactionMultisigOrder.sign(i, keypairs[i].secretKey)
        }
        const result = await multisig.sendOrder(changeTransactionMultisigOrder, keypairs[0].secretKey, 0)
        expect(result.transactions.length).toBe(2)
        expect(result.transactions).toHaveTransaction({
            to: multisig.address,
            exitCode: AdminMultisigErrors.noErrors
        })

        expect(result.transactions).toHaveTransaction({
            from: multisig.address,
            to: financial.address,
            body: beginCell().storeUint(FinancialOpcodes.changeTransactionAdmin, 32).storeAddress(newAdmin.address).endCell(),
            exitCode: AdminMultisigErrors.noErrors
        })

        const temp = await multisig.getTempConfig()
        expect(temp.transactionMultisigAddress).toBe(undefined)
    })

    it('[cancel changing transaction admin] should clear transaction admin address in temp', async () => {
        const n = 3
        const multisig = await deployMultisig(n)
        const newAdmin = await blockchain.treasury('newAdmin')
        const initialTemp = await multisig.getTempConfig()
        expect(initialTemp.transactionMultisigAddress).toBe(undefined)
        const changeTransactionMultisigPayload = getChangeTransactionMultisigPayload(newAdmin.address.toString())
        const changeTransactionMultisigOrder = getOrderByPayload(changeTransactionMultisigPayload)

        const cancelChangingTransactionMultisigPayload = getCancelChangingTransactionMultisigPayload()
        const cancelChangingTransactionMultisigOrder1 = getOrderByPayload(cancelChangingTransactionMultisigPayload, 0, 7222)
        const cancelChangingTransactionMultisigOrder2 = getOrderByPayload(cancelChangingTransactionMultisigPayload, 0, 7233)
        for (let i = 0; i < n; i++) {
            changeTransactionMultisigOrder.sign(i, keypairs[i].secretKey)
            cancelChangingTransactionMultisigOrder1.sign(i, keypairs[i].secretKey)
            cancelChangingTransactionMultisigOrder2.sign(i, keypairs[i].secretKey)
        }
        const time = Math.floor(Date.now() / 1000);
        await multisig.sendOrder(changeTransactionMultisigOrder, keypairs[0].secretKey, 0)
        const temp1 = await multisig.getTempConfig()
        expect(temp1.transactionMultisigAddress).toBe(newAdmin.address.toString())
        expect(temp1.changingTransactionMultisigTime).toBeGreaterThanOrEqual(time)
        const result = await multisig.sendOrder(cancelChangingTransactionMultisigOrder1, keypairs[0].secretKey, 0)
        expect(result.transactions.length).toBe(1)
        expect(result.transactions).toHaveTransaction({
            to: multisig.address,
            exitCode: AdminMultisigErrors.noErrors
        })
        const temp2 = await multisig.getTempConfig()
        expect(temp2.transactionMultisigAddress).toBe(undefined)

        await multisig.sendOrder(cancelChangingTransactionMultisigOrder2, keypairs[0].secretKey, 0)
        const temp3 = await multisig.getTempConfig()
        expect(temp3.transactionMultisigAddress).toBe(undefined)
    })

    it('[change content] should set new content but not send to financial', async () => {
        const n = 3
        const multisig = await deployMultisig(n)
        const initialTemp = await multisig.getTempConfig()
        expect(initialTemp.jettonContent?.name).toBe(undefined)
        expect(initialTemp.jettonContent?.description).toBe(undefined)
        expect(initialTemp.jettonContent?.symbol).toBe(undefined)

        const description = "Fanzee — это платформа для взаимодействия с фанатами, разработанная, чтобы помочь спортивным и развлекательным организациям наладить значимую связь со своими фанатами с помощью иммерсивной геймификации."

        const changeContentPayload = getChangeContentPayload({
            description,
            name: "FNZ",
            symbol: "new",
            decimals: '9',
            image: "https://github.com/ton-community/ton-core/tree/main/src/dict"
        })
        const changeContentOrder1 = getOrderByPayload(changeContentPayload)
        const changeContentOrder2 = getOrderByPayload(changeContentPayload, 0, 7222)

        for (let i = 0; i < n; i++) {
            changeContentOrder1.sign(i, keypairs[i].secretKey)
            changeContentOrder2.sign(i, keypairs[i].secretKey)
        }
        const time = Math.floor(Date.now() / 1000);
        const result1 = await multisig.sendOrder(changeContentOrder1, keypairs[0].secretKey, 0)
        expect(result1.transactions.length).toBe(1)
        expect(result1.transactions).toHaveTransaction({
            to: multisig.address,
            exitCode: AdminMultisigErrors.noErrors
        })
        const temp1 = await multisig.getTempConfig()
        expect(temp1.jettonContent?.name).toBe('FNZ')
        expect(temp1.jettonContent?.description).toBe(description)
        expect(temp1.jettonContent?.symbol).toBe('new')
        expect(temp1.changingContentTime).toBeGreaterThanOrEqual(time)

        try {
            await multisig.sendOrder(changeContentOrder1, keypairs[0].secretKey, 0)
        } catch (e) {}

        const temp2 = await multisig.getTempConfig()
        expect(temp2.jettonContent?.name).toBe('FNZ')
        expect(temp2.jettonContent?.description).toBe(description)
        expect(temp2.jettonContent?.symbol).toBe('new')
        expect(temp2.changingContentTime).toBeGreaterThanOrEqual(time)

        const result3 = await multisig.sendOrder(changeContentOrder2, keypairs[0].secretKey, 0)
        expect(result3.transactions.length).toBe(1)
        expect(result3.transactions).toHaveTransaction({
            to: multisig.address,
            exitCode: AdminMultisigErrors.updateDelayHasNotPassedYet
        })
        const temp3 = await multisig.getTempConfig()
        expect(temp3.jettonContent?.name).toBe('FNZ')
        expect(temp3.jettonContent?.description).toBe(description)
        expect(temp3.jettonContent?.symbol).toBe('new')
        expect(temp3.changingContentTime).toBeGreaterThanOrEqual(time)
    })

    it('[change content] should send specified content to financial', async () => {
        const n = 3
        const description = "Fanzee — это платформа для взаимодействия с фанатами, разработанная, чтобы помочь спортивным и развлекательным организациям наладить значимую связь со своими фанатами с помощью иммерсивной геймификации."
        const content = {
            description,
            name: "FNZ",
            symbol: "new",
            decimals: '9',
            image: "https://github.com/ton-community/ton-core/tree/main/src/dict"
        }
        const multisig = await deployMultisig(n, {
            jettonContent: content,
            changingContentTime: Math.floor(Date.now() / 1000) - 60 * 60 * 180 // now - 180 hours
        })

        const initialTemp = await multisig.getTempConfig()
        expect(initialTemp.jettonContent?.name).toBe('FNZ')
        expect(initialTemp.jettonContent?.description).toBe(description)
        expect(initialTemp.jettonContent?.symbol).toBe('new')

        const changeContentPayload = getChangeContentPayload(content)
        const changeContentOrder = getOrderByPayload(changeContentPayload)

        for (let i = 0; i < n; i++) {
            changeContentOrder.sign(i, keypairs[i].secretKey)
        }

        const result = await multisig.sendOrder(changeContentOrder, keypairs[0].secretKey, 0)
        expect(result.transactions.length).toBe(2)
        expect(result.transactions).toHaveTransaction({
            to: multisig.address,
            exitCode: AdminMultisigErrors.noErrors
        })

        expect(result.transactions).toHaveTransaction({
            from: multisig.address,
            to: financial.address,
            body: beginCell().storeUint(FinancialOpcodes.changeContent, 32).storeRef(buildJettonOnchainMetadata(content)).endCell(),
            exitCode: AdminMultisigErrors.noErrors
        })

        const temp = await multisig.getTempConfig()
        expect(temp.jettonContent?.name).toBe(undefined)
        expect(temp.jettonContent?.description).toBe(undefined)
        expect(temp.jettonContent?.symbol).toBe(undefined)
    })

    it('[cancel changing content] should clear content in temp', async () => {
        const n = 3
        const multisig = await deployMultisig(n)
        const initialTemp = await multisig.getTempConfig()
        expect(initialTemp.jettonContent?.name).toBe(undefined)
        expect(initialTemp.jettonContent?.description).toBe(undefined)
        expect(initialTemp.jettonContent?.symbol).toBe(undefined)

        const description = "Fanzee — это платформа для взаимодействия с фанатами, разработанная, чтобы помочь спортивным и развлекательным организациям наладить значимую связь со своими фанатами с помощью иммерсивной геймификации."
        const content = {
            description,
            name: "FNZ",
            symbol: "new",
            decimals: '9',
            image: "https://github.com/ton-community/ton-core/tree/main/src/dict"
        }

        const changeContentPayload = getChangeContentPayload(content)
        const changeContentOrder = getOrderByPayload(changeContentPayload)

        const cancelChangingContentPayload = getCancelChangingContentPayload()
        const cancelChangingContentOrder = getOrderByPayload(cancelChangingContentPayload, 0, 7222)
        for (let i = 0; i < n; i++) {
            changeContentOrder.sign(i, keypairs[i].secretKey)
            cancelChangingContentOrder.sign(i, keypairs[i].secretKey)
        }

        const time = Math.floor(Date.now() / 1000);
        await multisig.sendOrder(changeContentOrder, keypairs[0].secretKey, 0)
        const temp1 = await multisig.getTempConfig()
        expect(temp1.jettonContent?.name).toBe('FNZ')
        expect(temp1.jettonContent?.description).toBe(description)
        expect(temp1.jettonContent?.symbol).toBe('new')
        expect(temp1.changingContentTime).toBeGreaterThanOrEqual(time)

        const result = await multisig.sendOrder(cancelChangingContentOrder, keypairs[0].secretKey, 0)
        expect(result.transactions.length).toBe(1)
        expect(result.transactions).toHaveTransaction({
            to: multisig.address,
            exitCode: AdminMultisigErrors.noErrors
        })
        const temp2 = await multisig.getTempConfig()
        expect(temp2.jettonContent?.name).toBe(undefined)
        expect(temp2.jettonContent?.description).toBe(undefined)
        expect(temp2.jettonContent?.symbol).toBe(undefined)
    })

    it('[change commission factor] should throw an error when greater than commission base', async () => {
        const n = 3
        const multisig = await deployMultisig(n)
        const initialTemp = await multisig.getTempConfig()
        expect(initialTemp.commissionFactor).toBe(-1)

        const newCommissionFactor = 2000
        const changeCommissionFactorPayload = getChangeCommissionFactorPayload(newCommissionFactor)
        const changeCommissionFactorOrder = getOrderByPayload(changeCommissionFactorPayload)

        for (let i = 0; i < n; i++) {
            changeCommissionFactorOrder.sign(i, keypairs[i].secretKey)
        }

        const result = await multisig.sendOrder(changeCommissionFactorOrder, keypairs[0].secretKey, 0)
        expect(result.transactions.length).toBe(1)
        expect(result.transactions).toHaveTransaction({
            to: multisig.address,
            exitCode: AdminMultisigErrors.invalidCommissionFactor
        })
        const temp = await multisig.getTempConfig()
        expect(temp.commissionFactor).toBe(initialTemp.commissionFactor)
        expect(temp.changingCommissionTime).toBe(initialTemp.changingCommissionTime)
    })

    it('[change commission factor] should set new commission factor but not send to financial', async () => {
        const n = 3
        const multisig = await deployMultisig(n)
        const initialTemp = await multisig.getTempConfig()
        expect(initialTemp.commissionFactor).toBe(-1)

        const newCommissionFactor = 500
        const changeCommissionFactorPayload = getChangeCommissionFactorPayload(newCommissionFactor)
        const changeCommissionFactorOrder1 = getOrderByPayload(changeCommissionFactorPayload)
        const changeCommissionFactorOrder2 = getOrderByPayload(changeCommissionFactorPayload, 0, 7222)

        for (let i = 0; i < n; i++) {
            changeCommissionFactorOrder1.sign(i, keypairs[i].secretKey)
            changeCommissionFactorOrder2.sign(i, keypairs[i].secretKey)
        }


        const result1 = await multisig.sendOrder(changeCommissionFactorOrder1, keypairs[0].secretKey, 0)
        const time = Math.floor(Date.now() / 1000);
        expect(result1.transactions.length).toBe(1)
        expect(result1.transactions).toHaveTransaction({
            to: multisig.address,
            exitCode: AdminMultisigErrors.noErrors
        })
        const temp1 = await multisig.getTempConfig()
        expect(temp1.commissionFactor).toBe(newCommissionFactor)
        expect(temp1.changingCommissionTime).toBe(time)

        try {
            await multisig.sendOrder(changeCommissionFactorOrder1, keypairs[0].secretKey, 0)
        } catch (e) {}

        const temp2 = await multisig.getTempConfig()
        expect(temp2.commissionFactor).toBe(newCommissionFactor)
        expect(temp2.changingCommissionTime).toBeGreaterThanOrEqual(time)

        const result3 = await multisig.sendOrder(changeCommissionFactorOrder2, keypairs[0].secretKey, 0)
        expect(result3.transactions.length).toBe(1)
        expect(result3.transactions).toHaveTransaction({
            to: multisig.address,
            exitCode: AdminMultisigErrors.updateDelayHasNotPassedYet
        })
        const temp3 = await multisig.getTempConfig()
        expect(temp3.commissionFactor).toBe(newCommissionFactor)
        expect(temp3.changingCommissionTime).toBeGreaterThanOrEqual(time)
    })

    it('[change commission factor] should send specified commission factor to financial', async () => {
        const n = 3
        const commissionFactor = 0
        const multisig = await deployMultisig(n, {
            commissionFactor,
            changingCommissionTime: Math.floor(Date.now() / 1000) - 60 * 60 * 180 // now - 180 hours
        })

        const initialTemp = await multisig.getTempConfig()
        expect(initialTemp.commissionFactor).toBe(commissionFactor)

        const changeCommissionFactorPayload = getChangeCommissionFactorPayload(commissionFactor)
        const changeCommissionFactorOrder = getOrderByPayload(changeCommissionFactorPayload)

        for (let i = 0; i < n; i++) {
            changeCommissionFactorOrder.sign(i, keypairs[i].secretKey)
        }

        const result = await multisig.sendOrder(changeCommissionFactorOrder, keypairs[0].secretKey, 0)
        expect(result.transactions.length).toBe(2)
        expect(result.transactions).toHaveTransaction({
            to: multisig.address,
            exitCode: AdminMultisigErrors.noErrors
        })

        expect(result.transactions).toHaveTransaction({
            from: multisig.address,
            to: financial.address,
            body: beginCell().storeUint(FinancialOpcodes.changeCommissionFactor, 32).storeUint(commissionFactor, 16).endCell(),
            exitCode: AdminMultisigErrors.noErrors
        })

        const temp = await multisig.getTempConfig()
        expect(temp.commissionFactor).toBe(-1)
    })

    it('[cancel changing commission factor] should clear commission factor in temp', async () => {
        const n = 3
        const multisig = await deployMultisig(n)
        const initialTemp = await multisig.getTempConfig()
        expect(initialTemp.commissionFactor).toBe(-1)

        const newCommissionFactor = 500
        const changeCommissionFactorPayload = getChangeCommissionFactorPayload(newCommissionFactor)
        const changeCommissionFactorOrder = getOrderByPayload(changeCommissionFactorPayload)
        const cancelChangingCommissionFactorPayload = getCancelChangingCommissionFactorPayload()
        const cancelChangingCommissionFactorOrder = getOrderByPayload(cancelChangingCommissionFactorPayload, 0, 7222)

        for (let i = 0; i < n; i++) {
            changeCommissionFactorOrder.sign(i, keypairs[i].secretKey)
            cancelChangingCommissionFactorOrder.sign(i, keypairs[i].secretKey)
        }


        await multisig.sendOrder(changeCommissionFactorOrder, keypairs[0].secretKey, 0)
        const time = Math.floor(Date.now() / 1000);

        const temp1 = await multisig.getTempConfig()
        expect(temp1.commissionFactor).toBe(newCommissionFactor)
        expect(temp1.changingCommissionTime).toBeGreaterThanOrEqual(time)

        const result = await multisig.sendOrder(cancelChangingCommissionFactorOrder, keypairs[0].secretKey, 0)
        expect(result.transactions.length).toBe(1)
        expect(result.transactions).toHaveTransaction({
            to: multisig.address,
            exitCode: AdminMultisigErrors.noErrors
        })
        const temp2 = await multisig.getTempConfig()
        expect(temp2.commissionFactor).toBe(-1)
    })

    it('[change commission address] should set new commission address but not send to financial', async () => {
        const n = 3
        const multisig = await deployMultisig(n)
        const initialTemp = await multisig.getTempConfig()
        expect(initialTemp.commissionAddress).toBe(undefined)

        const newCommissionWallet = await blockchain.treasury('newCommissionWallet')
        const changeCommissionAddressPayload = getChangeCommissionAddressPayload(newCommissionWallet.address.toString())
        const changeCommissionAddressOrder1 = getOrderByPayload(changeCommissionAddressPayload)
        const changeCommissionAddressOrder2 = getOrderByPayload(changeCommissionAddressPayload, 0, 7222)

        for (let i = 0; i < n; i++) {
            changeCommissionAddressOrder1.sign(i, keypairs[i].secretKey)
            changeCommissionAddressOrder2.sign(i, keypairs[i].secretKey)
        }

        const time = Math.floor(Date.now() / 1000);
        const result1 = await multisig.sendOrder(changeCommissionAddressOrder1, keypairs[0].secretKey, 0)
        expect(result1.transactions.length).toBe(1)
        expect(result1.transactions).toHaveTransaction({
            to: multisig.address,
            exitCode: AdminMultisigErrors.noErrors
        })
        const temp1 = await multisig.getTempConfig()
        expect(temp1.commissionAddress).toBe(newCommissionWallet.address.toString())
        expect(temp1.changingCommissionAddressTime).toBeGreaterThanOrEqual(time)

        try {
            await multisig.sendOrder(changeCommissionAddressOrder1, keypairs[0].secretKey, 0)
        } catch (e) {}

        const temp2 = await multisig.getTempConfig()
        expect(temp2.commissionAddress).toBe(newCommissionWallet.address.toString())
        expect(temp2.changingCommissionAddressTime).toBeGreaterThanOrEqual(time)

        const result3 = await multisig.sendOrder(changeCommissionAddressOrder2, keypairs[0].secretKey, 0)
        expect(result3.transactions.length).toBe(1)
        expect(result3.transactions).toHaveTransaction({
            to: multisig.address,
            exitCode: AdminMultisigErrors.updateDelayHasNotPassedYet
        })
        const temp3 = await multisig.getTempConfig()
        expect(temp3.commissionAddress).toBe(newCommissionWallet.address.toString())
        expect(temp3.changingCommissionAddressTime).toBeGreaterThanOrEqual(time)
    })

    it('[change commission address] should send specified commission address to financial', async () => {
        const n = 3
        const commissionWallet = await blockchain.treasury('newCommissionWallet')
        const multisig = await deployMultisig(n, {
            commissionAddress: commissionWallet.address.toString(),
            changingCommissionAddressTime: Math.floor(Date.now() / 1000) - 60 * 60 * 180 // now - 180 hours
        })

        const initialTemp = await multisig.getTempConfig()
        expect(initialTemp.commissionAddress).toBe(commissionWallet.address.toString())

        const changeCommissionAddressPayload = getChangeCommissionAddressPayload(commissionWallet.address.toString())
        const changeCommissionAddressOrder = getOrderByPayload(changeCommissionAddressPayload)

        for (let i = 0; i < n; i++) {
            changeCommissionAddressOrder.sign(i, keypairs[i].secretKey)
        }

        const result = await multisig.sendOrder(changeCommissionAddressOrder, keypairs[0].secretKey, 0)
        expect(result.transactions.length).toBe(2)
        expect(result.transactions).toHaveTransaction({
            to: multisig.address,
            exitCode: AdminMultisigErrors.noErrors
        })

        expect(result.transactions).toHaveTransaction({
            from: multisig.address,
            to: financial.address,
            body: beginCell().storeUint(FinancialOpcodes.changeCommissionAddress, 32).storeAddress(commissionWallet.address).endCell(),
            exitCode: AdminMultisigErrors.noErrors
        })

        const temp = await multisig.getTempConfig()
        expect(temp.commissionAddress).toBe(undefined)
    })

    it('[cancel changing commission address] should clear commission address in temp', async () => {
        const n = 3
        const multisig = await deployMultisig(n)
        const initialTemp = await multisig.getTempConfig()
        expect(initialTemp.commissionAddress).toBe(undefined)

        const newCommissionWallet = await blockchain.treasury('newCommissionWallet')
        const changeCommissionAddressPayload = getChangeCommissionAddressPayload(newCommissionWallet.address.toString())
        const changeCommissionAddressOrder = getOrderByPayload(changeCommissionAddressPayload)
        const cancelChangingCommissionAddressPayload = getCancelChangingCommissionAddressPayload()
        const cancelChangingCommissionAddressOrder = getOrderByPayload(cancelChangingCommissionAddressPayload, 0, 7222)

        for (let i = 0; i < n; i++) {
            changeCommissionAddressOrder.sign(i, keypairs[i].secretKey)
            cancelChangingCommissionAddressOrder.sign(i, keypairs[i].secretKey)
        }

        const time = Math.floor(Date.now() / 1000);
        await multisig.sendOrder(changeCommissionAddressOrder, keypairs[0].secretKey, 0)
        const temp1 = await multisig.getTempConfig()
        expect(temp1.commissionAddress).toBe(newCommissionWallet.address.toString())
        expect(temp1.changingCommissionAddressTime).toBeGreaterThanOrEqual(time)

        const result = await multisig.sendOrder(cancelChangingCommissionAddressOrder, keypairs[0].secretKey, 0)
        expect(result.transactions.length).toBe(1)
        expect(result.transactions).toHaveTransaction({
            to: multisig.address,
            exitCode: AdminMultisigErrors.noErrors
        })
        const temp2 = await multisig.getTempConfig()
        expect(temp2.commissionAddress).toBe(undefined)
    })

    it('[change financial code] should set new financial code but not send to financial', async () => {
        const n = 3
        const multisig = await deployMultisig(n)
        const initialTemp = await multisig.getTempConfig()
        expect(initialTemp.newFinancialCode!.toString()).toBe(beginCell().endCell().toString())

        const newCode = await compile("NewFinancialForUpdateCodeTest")
        const changeFinancialCodePayload = getChangeFinancialCodePayload(newCode)
        const changeFinancialCodeOrder1 = getOrderByPayload(changeFinancialCodePayload)
        const changeFinancialCodeOrder2 = getOrderByPayload(changeFinancialCodePayload, 0, 7222)

        for (let i = 0; i < n; i++) {
            changeFinancialCodeOrder1.sign(i, keypairs[i].secretKey)
            changeFinancialCodeOrder2.sign(i, keypairs[i].secretKey)
        }

        const time = Math.floor(Date.now() / 1000);
        const result1 = await multisig.sendOrder(changeFinancialCodeOrder1, keypairs[0].secretKey, 0)
        expect(result1.transactions.length).toBe(1)
        expect(result1.transactions).toHaveTransaction({
            to: multisig.address,
            exitCode: AdminMultisigErrors.noErrors
        })
        const temp1 = await multisig.getTempConfig()
        expect(temp1.newFinancialCode!.toString()).toBe(newCode.toString())
        expect(temp1.changingFinancialCodeTime).toBeGreaterThanOrEqual(time)

        try {
            await multisig.sendOrder(changeFinancialCodeOrder1, keypairs[0].secretKey, 0)
        } catch (e) {}

        const temp2 = await multisig.getTempConfig()
        expect(temp2.newFinancialCode!.toString()).toBe(newCode.toString())
        expect(temp2.changingFinancialCodeTime).toBeGreaterThanOrEqual(time)

        const result3 = await multisig.sendOrder(changeFinancialCodeOrder2, keypairs[0].secretKey, 0)
        expect(result3.transactions.length).toBe(1)
        expect(result3.transactions).toHaveTransaction({
            to: multisig.address,
            exitCode: AdminMultisigErrors.updateDelayHasNotPassedYet
        })
        const temp3 = await multisig.getTempConfig()
        expect(temp3.newFinancialCode!.toString()).toBe(newCode.toString())
        expect(temp3.changingFinancialCodeTime).toBeGreaterThanOrEqual(time)
    })

    it('[change financial code] should send specified financial code to financial', async () => {
        const n = 3
        const multisig = await deployMultisig(n, {
            newFinancialCode: await compile("NewFinancialForUpdateCodeTest"),
            changingFinancialCodeTime: Math.floor(Date.now() / 1000) - 60 * 60 * 180 // now - 180 hours
        })

        const initialTemp = await multisig.getTempConfig()
        expect(initialTemp.newFinancialCode!.toString()).toBe((await compile("NewFinancialForUpdateCodeTest")).toString())

        const newCode = await compile("NewFinancialForUpdateCodeTest")
        const changeFinancialCodePayload = getChangeFinancialCodePayload(newCode)
        const changeFinancialCodeOrder = getOrderByPayload(changeFinancialCodePayload)

        for (let i = 0; i < n; i++) {
            changeFinancialCodeOrder.sign(i, keypairs[i].secretKey)
        }

        const result = await multisig.sendOrder(changeFinancialCodeOrder, keypairs[0].secretKey, 0)
        expect(result.transactions.length).toBe(2)
        expect(result.transactions).toHaveTransaction({
            to: multisig.address,
            exitCode: AdminMultisigErrors.noErrors
        })

        expect(result.transactions).toHaveTransaction({
            from: multisig.address,
            to: financial.address,
            body: beginCell().storeUint(FinancialOpcodes.updateCode, 32).storeRef(newCode).endCell(),
            exitCode: AdminMultisigErrors.noErrors
        })

        const temp = await multisig.getTempConfig()
        expect(temp.newFinancialCode!.toString()).toBe(beginCell().endCell().toString())
    })

    it('[cancel changing financial code] should clear financial code in temp', async () => {
        const n = 3
        const multisig = await deployMultisig(n)
        const initialTemp = await multisig.getTempConfig()
        expect(initialTemp.commissionAddress).toBe(undefined)

        const newCommissionWallet = await blockchain.treasury('newCommissionWallet')
        const changeCommissionAddressPayload = getChangeCommissionAddressPayload(newCommissionWallet.address.toString())
        const changeCommissionAddressOrder = getOrderByPayload(changeCommissionAddressPayload)
        const cancelChangingCommissionAddressPayload = getCancelChangingCommissionAddressPayload()
        const cancelChangingCommissionAddressOrder = getOrderByPayload(cancelChangingCommissionAddressPayload, 0, 7222)

        for (let i = 0; i < n; i++) {
            changeCommissionAddressOrder.sign(i, keypairs[i].secretKey)
            cancelChangingCommissionAddressOrder.sign(i, keypairs[i].secretKey)
        }

        const time = Math.floor(Date.now() / 1000);
        await multisig.sendOrder(changeCommissionAddressOrder, keypairs[0].secretKey, 0)
        const temp1 = await multisig.getTempConfig()
        expect(temp1.commissionAddress).toBe(newCommissionWallet.address.toString())
        expect(temp1.changingCommissionAddressTime).toBeGreaterThanOrEqual(time)

        const result = await multisig.sendOrder(cancelChangingCommissionAddressOrder, keypairs[0].secretKey, 0)
        expect(result.transactions.length).toBe(1)
        expect(result.transactions).toHaveTransaction({
            to: multisig.address,
            exitCode: AdminMultisigErrors.noErrors
        })
        const temp2 = await multisig.getTempConfig()
        expect(temp2.commissionAddress).toBe(undefined)
    })

    it('[send commission] send a request to send a commission from the financial', async () => {
        const n = 3
        const multisig = await deployMultisig(n)

        const sendCommissionPayload = getSendCommissionPayload()
        const sendCommissionOrder = getOrderByPayload(sendCommissionPayload)

        for (let i = 0; i < n; i++) {
            sendCommissionOrder.sign(i, keypairs[i].secretKey)
        }

        const result = await multisig.sendOrder(sendCommissionOrder, keypairs[0].secretKey, 0)
        expect(result.transactions.length).toBe(2)
        expect(result.transactions).toHaveTransaction({
            to: multisig.address,
            exitCode: AdminMultisigErrors.noErrors
        })

        expect(result.transactions).toHaveTransaction({
            from: multisig.address,
            to: financial.address,
            body: beginCell().storeUint(FinancialOpcodes.sendCommission, 32).endCell(),
            value: toNano('0.01'),
            exitCode: AdminMultisigErrors.noErrors
        })
    })

    it('[transfer jettons] send a request to transfer jettons from the financial', async () => {
        const n = 3
        const multisig = await deployMultisig(n)

        const anyone = await blockchain.treasury('anyone')

        const transferJettonPayload = getTransferJettonPayload(anyone.address.toString(), anyone.address.toString(), 100)
        const transferJettonOrder = getOrderByPayload(transferJettonPayload)

        for (let i = 0; i < n; i++) {
            transferJettonOrder.sign(i, keypairs[i].secretKey)
        }

        const result = await multisig.sendOrder(transferJettonOrder, keypairs[0].secretKey, 0)
        expect(result.transactions.length).toBe(2)
        expect(result.transactions).toHaveTransaction({
            to: multisig.address,
            exitCode: AdminMultisigErrors.noErrors
        })

        const transferBody = beginCell()
            .storeUint(FinancialOpcodes.transferJetton, 32)
            .storeAddress(anyone.address)
            .storeAddress(anyone.address)
            .storeCoins(toNano('100'))
            .endCell()

        expect(result.transactions).toHaveTransaction({
            from: multisig.address,
            to: financial.address,
            body: transferBody,
            value: toNano('0.06'),
            exitCode: AdminMultisigErrors.noErrors
        })
    })

    it('[return ton] should transfer remaining balance to destination', async () => {
        const n = 3
        const multisig = await deployMultisig(n)

        const anyone = await blockchain.treasury('anyone')

        const returnTonPayload = getReturnTonPayload(anyone.address.toString())
        const returnTonOrder = getOrderByPayload(returnTonPayload)

        for (let i = 0; i < n; i++) {
            returnTonOrder.sign(i, keypairs[i].secretKey)
        }

        const result = await multisig.sendOrder(returnTonOrder, keypairs[0].secretKey, 0)
        expect(result.transactions.length).toBe(2)
        expect(result.transactions).toHaveTransaction({
            to: multisig.address,
            exitCode: AdminMultisigErrors.noErrors
        })

        expect(result.transactions).toHaveTransaction({
            from: multisig.address,
            to: anyone.address,
            value: (x) =>{
                return x! >= toNano("4.7") && x! <= toNano("5")
            },
            exitCode: AdminMultisigErrors.noErrors
        })
    })
});
