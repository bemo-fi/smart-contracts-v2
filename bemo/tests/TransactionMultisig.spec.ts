import {Blockchain, SandboxContract, TreasuryContract} from '@ton-community/sandbox';
import {beginCell, Cell, toNano} from 'ton-core';
import {TransactionMultisig, TransactionMultisigErrors} from '../wrappers/TransactionMultisig';
import '@ton-community/test-utils';
import {compile} from '@ton-community/blueprint';
import {getOrderByPayloads} from "../wrappers/utils/MultisigOrder";
import {getSendTonFromFinancialPayload} from "../wrappers/utils/TransactionMultisigUtils";
import {NominatorPoolCodeBase64} from "../wrappers/NominatorPool";
import {NominatorProxy} from "../wrappers/NominatorProxy";

describe('TransactionMultisig', () => {

    let blockchain: Blockchain
    let code: Cell
    let proxyCode: Cell
    let poolCode: Cell
    let financial: SandboxContract<TreasuryContract>

    async function deployMultisig(n: number, walletId: number = 0): Promise<SandboxContract<TransactionMultisig>> {
        let publicKeys = []
        for (let i = 0; i < n; i++) {
            const wallet = await blockchain.treasury('owner' + i.toString())
            publicKeys.push(wallet.keypair.publicKey)
        }

        financial = await blockchain.treasury('financial')
        const multisig = blockchain.openContract(await TransactionMultisig.createFromConfig({
            poolCode,
            proxyCode,
            financialAddress: financial.address.toString(),
            k: n,
            publicKeys,
            walletId
        }, code))
        const deployer = await blockchain.treasury('deployer')
        const deployResult = await multisig.sendDeploy(deployer.getSender(), toNano('5'))

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: multisig.address,
            deploy: true,
        })
        return multisig
    }

    beforeAll(async () => {
        code = await compile('TransactionMultisig')
        proxyCode = await compile('NominatorProxy')
        // poolCode = await compile('NominatorPool')
        poolCode = Cell.fromBase64(NominatorPoolCodeBase64)
    })

    beforeEach(async () => {
        blockchain = await Blockchain.create()
    })


    //you need to manually check the error code, 32
    it('should throw an error if signed by a non-owner', async () => {
        const n = 3
        const multisig = await deployMultisig(n)
        const destination = await blockchain.treasury('destination')
        const sendTonPayload = getSendTonFromFinancialPayload(destination.address.toString(), 1, 1, 1, 1, 1)
        const sendTonOrder = getOrderByPayloads([sendTonPayload])
        for (let i = 1; i < n; i++) {
            const wallet = await blockchain.treasury('owner' + i.toString())
            sendTonOrder.sign(i, wallet.keypair.secretKey)
        }
        const nonOwner = await blockchain.treasury('nonOwner')
        try {
            await multisig.sendOrder(sendTonOrder, nonOwner.keypair.secretKey, 0)
        } catch (e) {
        }
    })

    it('should throw an error if there is a non-owner signature in the signatures', async () => {
        const n = 3
        const multisig = await deployMultisig(n)
        const destination = await blockchain.treasury('destination')
        const sendTonPayload = getSendTonFromFinancialPayload(destination.address.toString(), 1, 1, 1, 1, 1)
        const sendTonOrder = getOrderByPayloads([sendTonPayload])
        for (let i = 1; i < n; i++) {
            const wallet = await blockchain.treasury('owner' + i.toString())
            sendTonOrder.sign(i, wallet.keypair.secretKey)
        }
        const nonOwner = await blockchain.treasury('nonOwner')
        sendTonOrder.sign(2, nonOwner.keypair.secretKey)
        const owner0 = await blockchain.treasury('owner0')
        const result = await multisig.sendOrder(sendTonOrder, owner0.keypair.secretKey, 0)
        expect(result.transactions.length).toBe(1)
        expect(result.transactions).toHaveTransaction({
            to: multisig.address,
            exitCode: TransactionMultisigErrors.invalidSignature
        })
    })

    it('should throw an error if not all owners signed the order', async () => {
        const n = 3
        const multisig = await deployMultisig(n)
        const destination = await blockchain.treasury('destination')
        const sendTonPayload = getSendTonFromFinancialPayload(destination.address.toString(), 1, 1, 1, 1, 1)
        const sendTonOrder = getOrderByPayloads([sendTonPayload])
        for (let i = 1; i < n; i++) {
            const wallet = await blockchain.treasury('owner' + i.toString())
            sendTonOrder.sign(i, wallet.keypair.secretKey)
        }
        const owner0 = await blockchain.treasury('owner0')
        const result = await multisig.sendOrder(sendTonOrder, owner0.keypair.secretKey, 0)
        expect(result.transactions.length).toBe(1)
        expect(result.transactions).toHaveTransaction({
            to: multisig.address,
            exitCode: TransactionMultisigErrors.notAllOwnersConfirmed
        })
    })

    it('should throw an error if one owner signed k times', async () => {
        const n = 3
        const multisig = await deployMultisig(n)
        const destination = await blockchain.treasury('destination')
        const sendTonPayload = getSendTonFromFinancialPayload(destination.address.toString(), 1, 1, 1, 1, 1)
        const sendTonOrder = getOrderByPayloads([sendTonPayload])
        for (let i = 0; i < n; i++) {
            const wallet = await blockchain.treasury('owner' + i.toString())
            sendTonOrder.sign(i, wallet.keypair.secretKey)
        }
        const owner0 = await blockchain.treasury('owner0')
        const result = await multisig.sendWrongOrder(sendTonOrder, owner0.keypair.secretKey, 0)
        expect(result.transactions.length).toBe(1)
        expect(result.transactions).toHaveTransaction({
            to: multisig.address,
            exitCode: TransactionMultisigErrors.alreadySigned
        })
    })

    //you need to manually check the error code, 35
    it('should throw an error if backdated', async () => {
        const n = 3
        const multisig = await deployMultisig(n)
        const destination = await blockchain.treasury('destination')
        const sendTonPayload = getSendTonFromFinancialPayload(destination.address.toString(), 1, 1, 1, 1, 1)
        const sendTonOrder = getOrderByPayloads([sendTonPayload], 0, -7200)
        for (let i = 0; i < n; i++) {
            const wallet = await blockchain.treasury('owner' + i.toString())
            sendTonOrder.sign(i, wallet.keypair.secretKey)
        }
        const owner0 = await blockchain.treasury('owner0')
        try {
            await multisig.sendOrder(sendTonOrder, owner0.keypair.secretKey, 0)
        } catch (e) {
        }
    })

    it('should throw an error if validator not in masterchain', async () => {
        const n = 3
        const multisig = await deployMultisig(n)
        const destination = await blockchain.treasury('destination', {workchain: 0})
        const sendTonPayload = getSendTonFromFinancialPayload(destination.address.toString(), 1, 1, 1, 1, 1)
        const sendTonOrder = getOrderByPayloads([sendTonPayload])
        for (let i = 0; i < n; i++) {
            const wallet = await blockchain.treasury('owner' + i.toString())
            sendTonOrder.sign(i, wallet.keypair.secretKey)
        }
        const owner0 = await blockchain.treasury('owner0')
        const result = await multisig.sendOrder(sendTonOrder, owner0.keypair.secretKey, 0)
        expect(result.transactions.length).toBe(1)
        expect(result.transactions).toHaveTransaction({
            to: multisig.address,
            exitCode: TransactionMultisigErrors.notMasterchain
        })
    })

    //you need to manually check the error code, 34
    it('should throw an error if query has already been completed', async () => {
        const n = 3
        const multisig = await deployMultisig(n)
        const destination = await blockchain.treasury('destination')
        const sendTonPayload = getSendTonFromFinancialPayload(destination.address.toString(), 1, 1, 1, 1, 1)
        const sendTonOrder = getOrderByPayloads([sendTonPayload])
        for (let i = 0; i < n; i++) {
            const wallet = await blockchain.treasury('owner' + i.toString())
            sendTonOrder.sign(i, wallet.keypair.secretKey)
        }
        const owner0 = await blockchain.treasury('owner0')
        await multisig.sendOrder(sendTonOrder, owner0.keypair.secretKey, 0)
        try {
            await multisig.sendOrder(sendTonOrder, owner0.keypair.secretKey, 0)
        } catch (e) {
        }
    })

    it('should send messages to financial', async () => {
        const n = 3
        const multisig = await deployMultisig(n)
        const admin = await blockchain.treasury('admin')
        await admin.send({
            to: multisig.address,
            value: toNano('100')
        })

        // Addresses are hardcoded to check if pool addresses are the same in real mainnet
        const destination1 = "Ef_FlwHMR4nT2HcmyapBd3gngSAlPWf4AFlsfY6TlDD1dkiO" // DG Pool #1

        const sendTonPayload1 = getSendTonFromFinancialPayload(
            destination1,
            40,
            40,
            10000,
            10000,
            10000)
        const poolAndProxyAddresses1 = await multisig.getPoolAndProxyAddresses(
            destination1,
            40,
            40,
            10000,
            10000
        )

        const poolAddress1 = "Ef81FHdh5LtBrx9x20Iit7B_L-glFfnzOWN41bHDJLNA4y3C"
        const proxy1 = blockchain.openContract(await NominatorProxy.createFromConfig({
            financialAddress: financial.address.toString(),
            nominatorPoolAddress: poolAddress1
        }, proxyCode))

        expect(poolAndProxyAddresses1.poolAddress).toBe(poolAddress1)
        expect(poolAndProxyAddresses1.proxyAddress).toBe(proxy1.address.toString())

        const destination2 = "Ef90-AiaqxzBGHHfNNnq5Bcc3B3ChEF_B38w-fUg4Q1Tma1Q" // Very First Pool #1
        const sendTonPayload2 = getSendTonFromFinancialPayload(
            destination2,
            40,
            40,
            10000,
            10000,
            10000)
        const poolAndProxyAddresses2 = await multisig.getPoolAndProxyAddresses(
            destination2,
            40,
            40,
            10000,
            10000
        )

        console.log(await multisig.getPoolAndProxyAddresses(
            "Ef94lMwm_suH-MsSqMt95KVzDq1t5IJZvwHdB9bYEQGaoByQ",
            40,
            40,
            10000,
            10000
        ))

        const poolAddress2 = "Ef8gQpp7pKD9GzBrcr3ju9faPjEWHPerhZ4tFpSiDoDUINxn"
        const proxy2 = blockchain.openContract(await NominatorProxy.createFromConfig({
            financialAddress: financial.address.toString(),
            nominatorPoolAddress: poolAddress2
        }, proxyCode))

        expect(poolAndProxyAddresses2.poolAddress).toBe(poolAddress2)
        expect(poolAndProxyAddresses2.proxyAddress).toBe(proxy2.address.toString())

        const destination3 = "Ef-VAFf1Wd3fXd-mQhDw5lNsVdIZv2_H1yhbdzXCFfIe9p95" // CAT #1
        const sendTonPayload3 = getSendTonFromFinancialPayload(
            destination3,
            40,
            40,
            10001,
            10000,
            10000)
        const poolAndProxyAddresses3 = await multisig.getPoolAndProxyAddresses(
            destination3,
            40,
            40,
            10001,
            10000
        )

        const poolAddress3 = "Ef9wm_whwjPFe7H4jvP-ODhluiZFm0Tb2Gj-67zqS31hCaWC"
        const proxy3 = blockchain.openContract(await NominatorProxy.createFromConfig({
            financialAddress: financial.address.toString(),
            nominatorPoolAddress: poolAddress3
        }, proxyCode))

        expect(poolAndProxyAddresses3.poolAddress).toBe(poolAddress3)
        expect(poolAndProxyAddresses3.proxyAddress).toBe(proxy3.address.toString())

        const sendTonOrder = getOrderByPayloads([sendTonPayload1, sendTonPayload2, sendTonPayload3])
        for (let i = 0; i < n; i++) {
            const wallet = await blockchain.treasury('owner' + i.toString())
            sendTonOrder.sign(i, wallet.keypair.secretKey)
        }
        const owner0 = await blockchain.treasury('owner0')
        const result1 = await multisig.sendOrder(sendTonOrder, owner0.keypair.secretKey, 0)

        const body1 = beginCell().storeUint(70, 32).storeAddress(proxy1.address).storeCoins(toNano(10000)).endCell()
        const body2 = beginCell().storeUint(70, 32).storeAddress(proxy2.address).storeCoins(toNano(10000)).endCell()
        const body3 = beginCell().storeUint(70, 32).storeAddress(proxy3.address).storeCoins(toNano(10000)).endCell()

        expect(result1.transactions.length).toBe(4)
        expect(result1.transactions).toHaveTransaction({
            from: multisig.address,
            to: financial.address,
            exitCode: TransactionMultisigErrors.noErrors,
            success: true,
            body: body1
        })

        expect(result1.transactions).toHaveTransaction({
            from: multisig.address,
            to: financial.address,
            exitCode: TransactionMultisigErrors.noErrors,
            success: true,
            body: body2
        })

        expect(result1.transactions).toHaveTransaction({
            from: multisig.address,
            to: financial.address,
            exitCode: TransactionMultisigErrors.noErrors,
            success: true,
            body: body3
        })

        //you need to manually check the error code, 34
        try {
            await multisig.sendOrder(sendTonOrder, owner0.keypair.secretKey, 0)
        } catch (e) {}
    })
});
