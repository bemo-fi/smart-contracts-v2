import {Blockchain, SandboxContract, TreasuryContract} from '@ton-community/sandbox'
import {beginCell, Cell, toNano} from 'ton-core'
import {JettonWallet, JettonWalletErrors} from '../wrappers/JettonWallet'
import '@ton-community/test-utils'
import {compile} from '@ton-community/blueprint'

describe('JettonWallet', () => {
    let code: Cell
    let jettonMaster: SandboxContract<TreasuryContract>
    let jettonWallet: SandboxContract<JettonWallet>
    let owner: SandboxContract<TreasuryContract>
    let blockchain: Blockchain

    beforeAll(async () => {
        code = await compile('JettonWallet')
    })

    async function deployJettonWallet() {
        blockchain = await Blockchain.create()
        jettonMaster = await blockchain.treasury('jettonMaster')
        owner = await blockchain.treasury('owner')
        jettonWallet = blockchain.openContract(await JettonWallet.createFromConfig({
            balance: 0,
            jettonMasterAddress: jettonMaster.address.toString(),
            jettonWalletCode: code,
            ownerAddress: owner.address.toString()
        }, code))

        const deployer = await blockchain.treasury('deployer')

        const deployResult = await jettonWallet.sendDeploy(deployer.getSender(), toNano('0.05'))

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: jettonWallet.address,
            deploy: true,
        })

        return jettonWallet
    }

    it('[return ton] should return ton', async () => {
        await deployJettonWallet()
        const anyone = await blockchain.treasury('anyone')
        const tonAmount = toNano('0.05')
        const result = await jettonWallet.sendReturnTon(anyone.getSender(), tonAmount)

        expect(result.transactions.length).toBe(3)

        expect(result.transactions).toHaveTransaction({
            from: anyone.address,
            to: jettonWallet.address,
            value: (x) => {
                return x! <= tonAmount
            },
            success: true
        })

        expect(result.transactions).toHaveTransaction({
            from: jettonWallet.address,
            to: owner.address,
            success: true
        })
    })

    it('[burn] should throw error when not enough ton', async () => {
        await deployJettonWallet()

        await jettonWallet.sendReceive(jettonMaster.getSender(), toNano('0.05'), {jettonAmount: 100})
        const initialJettonWalletData = await jettonWallet.getWalletData()
        expect(initialJettonWalletData.balance).toBe(100)

        const tonAmount = toNano('0.05')
        const result = await jettonWallet.sendBurn(owner.getSender(), tonAmount, {jettonAmount: 100})

        expect(result.transactions.length).toBe(3)

        expect(result.transactions).toHaveTransaction({
            from: owner.address,
            to: jettonWallet.address,
            value: tonAmount,
            success: false,
            exitCode: JettonWalletErrors.insufficientMsgValue
        })

        expect(result.transactions).toHaveTransaction({
            from: jettonWallet.address,
            to: owner.address,
            value: (x) => {
                return x! <= tonAmount
            },
            success: true
        })

        const jettonWalletData = await jettonWallet.getWalletData()
        expect(jettonWalletData.balance).toBe(initialJettonWalletData.balance)
    })

    it('[burn] should throw error when not enough jettons', async () => {
        await deployJettonWallet()
        const initialJettonWalletData = await jettonWallet.getWalletData()
        expect(initialJettonWalletData.balance).toBe(0)

        await jettonWallet.sendReceive(jettonMaster.getSender(), toNano('0.05'), {jettonAmount: 100})

        const initialJettonWalletData1 = await jettonWallet.getWalletData()
        expect(initialJettonWalletData1.balance).toBe(100)

        const tonAmount = toNano('1')
        const result = await jettonWallet.sendBurn(owner.getSender(), tonAmount, {jettonAmount: 200})

        expect(result.transactions.length).toBe(3)

        expect(result.transactions).toHaveTransaction({
            from: owner.address,
            to: jettonWallet.address,
            value: tonAmount,
            success: false,
            exitCode: JettonWalletErrors.insufficientJettonBalance
        })

        expect(result.transactions).toHaveTransaction({
            from: jettonWallet.address,
            to: owner.address,
            value: (x) => {
                return x! <= tonAmount
            },
            success: true
        })

        const jettonWalletData = await jettonWallet.getWalletData()
        expect(jettonWalletData.balance).toBe(initialJettonWalletData1.balance)
    })

    it('[burn] should decrease balance', async () => {
        await deployJettonWallet()
        await jettonWallet.sendReceive(jettonMaster.getSender(), toNano('0.05'), {jettonAmount: 100})
        const initialJettonWalletData = await jettonWallet.getWalletData()
        const jettonAmount = 100
        expect(initialJettonWalletData.balance).toBe(jettonAmount)

        const tonAmount = toNano('1')
        const result = await jettonWallet.sendBurn(owner.getSender(), tonAmount, {jettonAmount})

        expect(result.transactions.length).toBe(3)

        expect(result.transactions).toHaveTransaction({
            from: owner.address,
            to: jettonWallet.address,
            value: tonAmount,
            success: true
        })

        const burnBody = beginCell()
            .storeUint(0x7bdd97de, 32)
            .storeUint(0, 64)
            .storeCoins(toNano(jettonAmount))
            .storeAddress(owner.address)
            .endCell()

        expect(result.transactions).toHaveTransaction({
            from: jettonWallet.address,
            to: jettonMaster.address,
            value: (x) => {
                return x! <= tonAmount
            },
            success: true,
            body: burnBody
        })

        const jettonWalletData = await jettonWallet.getWalletData()
        expect(jettonWalletData.balance).toBe(initialJettonWalletData.balance - jettonAmount)
    })

    it('[transfer] should throw an error because there is not enough balance for internal transfer in another jetton wallet', async () => {
        await deployJettonWallet()
        await jettonWallet.sendReceive(jettonMaster.getSender(), toNano('0.01'), {jettonAmount: 100})
        const initialJettonWalletData = await jettonWallet.getWalletData()
        const jettonAmount = 100
        expect(initialJettonWalletData.balance).toBe(jettonAmount)

        const tonAmount = toNano('0.03')
        const destination = await blockchain.treasury('destination')
        const result = await jettonWallet.sendTransfer(
            owner.getSender(),
            tonAmount,
            {
                jettonAmount,
                toOwnerAddress: destination.address.toString()
            }
        )

        expect(result.transactions.length).toBe(3)

        expect(result.transactions).toHaveTransaction({
            from: owner.address,
            to: jettonWallet.address,
            value: tonAmount,
            success: false,
            exitCode: JettonWalletErrors.insufficientMsgValue
        })

        const jettonWalletData = await jettonWallet.getWalletData()
        expect(jettonWalletData.balance).toBe(initialJettonWalletData.balance)
    })

})
