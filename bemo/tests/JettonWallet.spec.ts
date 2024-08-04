import {Blockchain, SandboxContract, TreasuryContract} from '@ton/sandbox'
import {Address, beginCell, Cell, toNano} from '@ton/core'
import {JettonWallet, JettonWalletErrors, JettonWalletOpCodes} from '../wrappers/JettonWallet'
import '@ton/test-utils'
import {compile} from '@ton/blueprint'
import {calcStorageFee, getStoragePrices, printTxGasStats} from "./GasUtils";
import {findTransactionRequired} from "@ton/test-utils";

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
        const storagePrices = getStoragePrices(blockchain.config);
        const storageDuration = 5 * 365 * 24 * 3600;
        const min_tons_for_jetton_wallet_storage = calcStorageFee(storagePrices, JettonWallet.storageStats, BigInt(storageDuration));

        expect((await blockchain.getContract(jettonWallet.address)).balance).toBe(min_tons_for_jetton_wallet_storage)
    })

    it('[burn] should throw error when not enough ton', async () => {
        await deployJettonWallet()

        await jettonWallet.sendReceive(jettonMaster.getSender(), toNano('0.05'), {jettonAmount: 100})
        const initialJettonWalletData = await jettonWallet.getWalletData()
        expect(initialJettonWalletData.balance).toBe(100)

        const tonAmount = toNano('0.005')
        const result = await jettonWallet.sendBurn(owner.getSender(), tonAmount, {jettonAmount: 100})

        expect(result.transactions.length).toBe(3)

        expect(result.transactions).toHaveTransaction({
            from: owner.address,
            to: jettonWallet.address,
            value: tonAmount,
            success: false,
            exitCode: JettonWalletErrors.notEnoughGas
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

    it('[burn] should throw error when sender is not owner', async () => {
        await deployJettonWallet()
        const initialJettonWalletData = await jettonWallet.getWalletData()
        expect(initialJettonWalletData.balance).toBe(0)

        await jettonWallet.sendReceive(jettonMaster.getSender(), toNano('0.05'), {jettonAmount: 100})

        const initialJettonWalletData1 = await jettonWallet.getWalletData()
        expect(initialJettonWalletData1.balance).toBe(100)

        const anyone = await blockchain.treasury('anyone')
        const tonAmount = toNano('1')
        const result = await jettonWallet.sendBurn(anyone.getSender(), tonAmount, {jettonAmount: 200})

        expect(result.transactions.length).toBe(3)

        expect(result.transactions).toHaveTransaction({
            from: anyone.address,
            to: jettonWallet.address,
            value: tonAmount,
            success: false,
            exitCode: JettonWalletErrors.notFromOwner
        })

        expect(result.transactions).toHaveTransaction({
            from: jettonWallet.address,
            to: anyone.address,
            value: (x) => {
                return x! <= tonAmount
            },
            success: true
        })

        const jettonWalletData = await jettonWallet.getWalletData()
        expect(jettonWalletData.balance).toBe(initialJettonWalletData1.balance)
    })

    it('[burn] should decrease balance', async () => {
        const assertBurn = async (jettonAmount: number, receiverAddress?: Address, forwardPayload?: Cell) => {
            await deployJettonWallet()
            await jettonWallet.sendReceive(jettonMaster.getSender(), toNano('0.05'), {jettonAmount: jettonAmount})
            const initialJettonWalletData = await jettonWallet.getWalletData()
            expect(initialJettonWalletData.balance).toBe(jettonAmount)

            const tonAmount = toNano('0.06')
            const result = await jettonWallet.sendBurn(owner.getSender(), tonAmount, {
                jettonAmount,
                receiverAddress: receiverAddress?.toString(),
                forwardPayload
            })

            expect(result.transactions.length).toBe(3)

            expect(result.transactions).toHaveTransaction({
                from: owner.address,
                to: jettonWallet.address,
                value: tonAmount,
                success: true
            })

            const burnNotificationBody = beginCell()
                .storeUint(JettonWalletOpCodes.burnNotification, 32)
                .storeUint(0, 64)
                .storeCoins(toNano(jettonAmount))
                .storeAddress(owner.address)
                .storeAddress(receiverAddress ?? owner.address)
                .storeMaybeRef(forwardPayload)
                .endCell()

            expect(result.transactions).toHaveTransaction({
                from: jettonWallet.address,
                to: jettonMaster.address,
                value: (x) => {
                    return x! <= tonAmount
                },
                success: true,
                body: burnNotificationBody
            })

            const jettonWalletData = await jettonWallet.getWalletData()
            expect(jettonWalletData.balance).toBe(initialJettonWalletData.balance - jettonAmount)

            return result
        }

        await assertBurn(100)
        const anyone = await blockchain.treasury('anyone')
        await assertBurn(100, anyone.address)
        const forwardPayload = beginCell()
            .storeUint(2, 32)
            .storeUint(0, 64)
            .storeRef(
                beginCell()
                    .storeUint(2, 32)
                    .storeUint(0, 64)
                    .storeUint(0, 64)
                    .storeUint(0, 64)
                    .endCell()
            )
            .endCell()
        const result = await assertBurn(100, anyone.address, forwardPayload)

        const burnTx = findTransactionRequired(result.transactions, {
            from: owner.address,
            to: jettonWallet.address,
            success: true
        });
        printTxGasStats("Burn", burnTx)
    })

    it('[transfer] should throw an error because there is not enough balance for internal transfer in another jetton wallet', async () => {
        await deployJettonWallet()
        await jettonWallet.sendReceive(jettonMaster.getSender(), toNano('0.01'), {jettonAmount: 100})
        const initialJettonWalletData = await jettonWallet.getWalletData()
        const jettonAmount = 100
        expect(initialJettonWalletData.balance).toBe(jettonAmount)

        const tonAmount = toNano('0.008')
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
            exitCode: JettonWalletErrors.notEnoughGas
        })

        const jettonWalletData = await jettonWallet.getWalletData()
        expect(jettonWalletData.balance).toBe(initialJettonWalletData.balance)
    })

    it('[transfer] should throw an error when sender is not a owner', async () => {
        await deployJettonWallet()
        await jettonWallet.sendReceive(jettonMaster.getSender(), toNano('0.01'), {jettonAmount: 100})
        const initialJettonWalletData = await jettonWallet.getWalletData()
        const jettonAmount = 100
        expect(initialJettonWalletData.balance).toBe(jettonAmount)

        const tonAmount = toNano('0.008')
        const destination = await blockchain.treasury('destination')
        const anyone = await blockchain.treasury('anyone')
        const result = await jettonWallet.sendTransfer(
            anyone.getSender(),
            tonAmount,
            {
                jettonAmount,
                toOwnerAddress: destination.address.toString()
            }
        )

        expect(result.transactions.length).toBe(3)

        expect(result.transactions).toHaveTransaction({
            from: anyone.address,
            to: jettonWallet.address,
            value: tonAmount,
            success: false,
            exitCode: JettonWalletErrors.notFromOwner
        })

        const jettonWalletData = await jettonWallet.getWalletData()
        expect(jettonWalletData.balance).toBe(initialJettonWalletData.balance)
    })

    it('[transfer] should send tokens', async () => {
        await deployJettonWallet()
        await jettonWallet.sendReceive(jettonMaster.getSender(), toNano('0.01'), {jettonAmount: 100})
        const initialJettonWalletData = await jettonWallet.getWalletData()
        const jettonAmount = 100
        expect(initialJettonWalletData.balance).toBe(jettonAmount)


        const destination = await blockchain.treasury('destination')
        const destinationJettonWallet = blockchain.openContract(await JettonWallet.createFromConfig({
            balance: 0,
            jettonMasterAddress: jettonMaster.address.toString(),
            ownerAddress: destination.address.toString()
        }, code))

        const deployer = await blockchain.treasury('deployer')

        const deployResult = await destinationJettonWallet.sendDeploy(deployer.getSender(), toNano('0.05'))

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: destinationJettonWallet.address,
            deploy: true,
        })

        const initialDestinationJettonWalletData = await destinationJettonWallet.getWalletData()
        expect(initialDestinationJettonWalletData.balance).toBe(0)

        const tonAmount = toNano('0.2')
        const forwardTonAmount = 0.1
        const forwardPayload = beginCell()
            .storeUint(2, 32)
            .storeUint(0, 64)
            .storeRef(
                beginCell()
                    .storeUint(2, 32)
                    .storeUint(0, 64)
                    .storeUint(0, 64)
                    .storeUint(0, 64)
                    .endCell()
            )
            .endCell()
        const customPayload = beginCell()
            .storeUint(5, 32)
            .storeUint(5, 64)
            .storeRef(
                beginCell()
                    .storeUint(5, 32)
                    .storeUint(5, 64)
                    .endCell()
            )
            .endCell()
        const result = await jettonWallet.sendTransfer(owner.getSender(), tonAmount, {
                jettonAmount,
                toOwnerAddress: destination.address.toString(),
                responseAddress: owner.address.toString(),
                customPayload: customPayload,
                forwardTonAmount,
                forwardPayload
            }
        )

        expect(result.transactions.length).toBe(5)

        const transferBody = beginCell()
            .storeUint(JettonWalletOpCodes.transfer, 32)
            .storeUint(0, 64)
            .storeCoins(toNano(jettonAmount.toFixed(9)))
            .storeAddress(destination.address)
            .storeAddress(owner.address)
            .storeMaybeRef(customPayload)
            .storeCoins(toNano(forwardTonAmount.toFixed(9)))
            .storeMaybeRef(forwardPayload)
            .endCell()

        expect(result.transactions).toHaveTransaction({
            from: owner.address,
            to: jettonWallet.address,
            value: tonAmount,
            success: true,
            body: transferBody,
            exitCode: JettonWalletErrors.noErrors
        })

        const receiveBody = beginCell()
            .storeUint(JettonWalletOpCodes.internalTransfer, 32)
            .storeUint(0, 64)
            .storeCoins(toNano(jettonAmount.toFixed(9)))
            .storeAddress(owner.address)
            .storeAddress(owner.address)
            .storeCoins(toNano(forwardTonAmount.toFixed(9)))
            .storeMaybeRef(forwardPayload)
            .endCell()

        expect(result.transactions).toHaveTransaction({
            from: jettonWallet.address,
            to: destinationJettonWallet.address,
            success: true,
            body: receiveBody,
            exitCode: JettonWalletErrors.noErrors
        })

        const transferNotificationBody = beginCell()
            .storeUint(JettonWalletOpCodes.transferNotification ,32)
            .storeUint(0,64)
            .storeCoins(toNano(jettonAmount.toFixed(9)))
            .storeAddress(owner.address)
            .storeMaybeRef(forwardPayload)
            .endCell()

        expect(result.transactions).toHaveTransaction({
            from: destinationJettonWallet.address,
            to: destination.address,
            success: true,
            body: transferNotificationBody,
            exitCode: JettonWalletErrors.noErrors
        })

        expect(result.transactions).toHaveTransaction({
            from: destinationJettonWallet.address,
            to: owner.address,
            success: true,
            body: beginCell()
                .storeUint(JettonWalletOpCodes.excesses, 32)
                .storeUint(0, 64)
                .endCell(),
            exitCode: JettonWalletErrors.noErrors
        })

        const jettonWalletData = await jettonWallet.getWalletData()
        expect(jettonWalletData.balance).toBe(initialJettonWalletData.balance - jettonAmount)

        const destinationJettonWalletData = await destinationJettonWallet.getWalletData()
        expect(destinationJettonWalletData.balance).toBe(initialDestinationJettonWalletData.balance + jettonAmount)

        const transferTx = findTransactionRequired(result.transactions, {
            from: owner.address,
            to: jettonWallet.address,
            value: tonAmount,
            success: true,
            body: transferBody,
            exitCode: JettonWalletErrors.noErrors
        });
        printTxGasStats("Transfer", transferTx)

        const receiveTx = findTransactionRequired(result.transactions, {
            from: jettonWallet.address,
            to: destinationJettonWallet.address,
            success: true,
            body: receiveBody,
            exitCode: JettonWalletErrors.noErrors
        });
        printTxGasStats("Receive", receiveTx)
    })

})
