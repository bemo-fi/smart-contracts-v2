import {Blockchain, SandboxContract, TreasuryContract} from '@ton-community/sandbox';
import {beginCell, Cell, toNano} from 'ton-core';
import {UnstakeRequest, UnstakeRequestErrors, UnstakeRequestOpCodes} from '../wrappers/UnstakeRequest';
import '@ton-community/test-utils';
import {compile} from '@ton-community/blueprint';
import now = jest.now;
import {FinancialOpcodes} from "../wrappers/Financial";

describe('UnstakeRequest', () => {
    let code: Cell;

    beforeAll(async () => {
        code = await compile('UnstakeRequest');
    });

    let blockchain: Blockchain;
    let unstakeRequest: SandboxContract<UnstakeRequest>;
    let financial: SandboxContract<TreasuryContract>
    let owner: SandboxContract<TreasuryContract>

    async function initUnstakeRequest(withdrawTonAmount: number, withdrawJettonAmount: number, unlockTimestamp: number, initTonValue: number = 0.01) {
        const initResult = await unstakeRequest.sendInit(blockchain.sender(financial.address), toNano(initTonValue.toString()), {
            ownerAddress: owner.address.toString(),
            withdrawTonAmount,
            withdrawJettonAmount,
            unlockTimestamp
        })

        expect(initResult.transactions.length).toBe(1)

        expect(initResult.transactions).toHaveTransaction({
            from: financial.address,
            to: unstakeRequest.address,
            body: beginCell()
                .storeUint(UnstakeRequestOpCodes.deploy, 32)
                .storeAddress(owner.address)
                .storeCoins(toNano(withdrawTonAmount.toString()))
                .storeCoins(toNano(withdrawJettonAmount.toString()))
                .storeInt(unlockTimestamp, 32)
                .endCell(),
            success: true
        })

        const unstakeRequestData = await unstakeRequest.getUnstakeData()

        expect(unstakeRequestData.index).toBe(0)
        expect(unstakeRequestData.financialAddress).toBe(financial.address.toString())
        expect(unstakeRequestData.ownerAddress).toBe(owner.address.toString())
        expect(unstakeRequestData.withdrawTonAmount).toBe(withdrawTonAmount)
        expect(unstakeRequestData.withdrawJettonAmount).toBe(withdrawJettonAmount)
        expect(unstakeRequestData.unlockTimestamp).toBe(unlockTimestamp)
    }

    beforeEach(async () => {
        blockchain = await Blockchain.create()

        financial = await blockchain.treasury('financial')

        unstakeRequest = blockchain.openContract(UnstakeRequest.createFromConfig({
            financialAddress: financial.address.toString(),
            index: 0
        }, code))

        const deployer = await blockchain.treasury('deployer')
        owner = await blockchain.treasury('owner')

        const deployResult = await unstakeRequest.sendDeploy(deployer.getSender(), toNano('0.05'))

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: unstakeRequest.address,
            deploy: true,
        })
    })

    it('should throw an error when receive init msg not from financial', async () => {
        const anyone = await blockchain.treasury('anyone')
        const initResult = await unstakeRequest.sendInit(anyone.getSender(), toNano('0.1'), {
            ownerAddress: owner.address.toString(),
            withdrawTonAmount: 100,
            withdrawJettonAmount: 100,
            unlockTimestamp: 100
        })

        expect(initResult.transactions).toHaveTransaction({
            from: anyone.address,
            to: unstakeRequest.address,
            body: beginCell()
                .storeUint(UnstakeRequestOpCodes.deploy, 32)
                .storeAddress(owner.address)
                .storeCoins(toNano(100))
                .storeCoins(toNano(100))
                .storeInt(100, 32)
                .endCell(),
            success: false,
            exitCode: UnstakeRequestErrors.notAllowed
        })
    });

    it('[internal unstake] should throw an error when there was not enough balance', async () => {
        const unlockTimestamp = Math.trunc(Math.floor(now() / 1000))
        const withdrawTonAmount = 100;
        const withdrawJettonAmount = 100;
        await initUnstakeRequest(withdrawTonAmount, withdrawJettonAmount, unlockTimestamp)

        let unstakeData = await unstakeRequest.getUnstakeData()
        expect(unstakeData.index).toBe(0)
        expect(unstakeData.financialAddress).toBe(financial.address.toString())
        expect(unstakeData.withdrawJettonAmount).toBe(withdrawJettonAmount)
        expect(unstakeData.withdrawTonAmount).toBe(withdrawTonAmount)
        expect(unstakeData.ownerAddress).toBe(owner.address.toString())
        expect(unstakeData.unlockTimestamp).toBe(unlockTimestamp)

        const result = await unstakeRequest.sendInternalUnstake(owner.getSender(), toNano("0.01"))

        expect(result.transactions).toHaveTransaction({
            from: owner.address,
            to: unstakeRequest.address,
            success: false,
            exitCode: UnstakeRequestErrors.insufficientBalance
        })

        unstakeData = await unstakeRequest.getUnstakeData()
        expect(unstakeData.index).toBe(0)
        expect(unstakeData.financialAddress).toBe(financial.address.toString())
        expect(unstakeData.withdrawJettonAmount).toBe(withdrawJettonAmount)
        expect(unstakeData.withdrawTonAmount).toBe(withdrawTonAmount)
        expect(unstakeData.ownerAddress).toBe(owner.address.toString())
        expect(unstakeData.unlockTimestamp).toBe(unlockTimestamp)
    });

    it('[internal unstake] should throw an error when unlock time has not passed', async () => {
        const currentTimestamp = Math.trunc(Math.floor(now() / 1000))
        await initUnstakeRequest(100, 100, currentTimestamp + 60 * 60 * 36)

        const result = await unstakeRequest.sendInternalUnstake(owner.getSender(), toNano("1"))

        expect(result.transactions).toHaveTransaction({
            from: owner.address,
            to: unstakeRequest.address,
            success: false,
            exitCode: UnstakeRequestErrors.unlockTimestampHasNotExpiredYet
        })
    });

    it('[internal unstake] should send msg to financial and throw an error on any interaction after that', async () => {
        const unlockTimestamp = Math.trunc(Math.floor(now() / 1000))
        const withdrawTonAmount = 100;
        const withdrawJettonAmount = 100;
        await initUnstakeRequest(withdrawTonAmount, withdrawJettonAmount, unlockTimestamp)

        let unstakeData = await unstakeRequest.getUnstakeData()
        expect(unstakeData.index).toBe(0)
        expect(unstakeData.financialAddress).toBe(financial.address.toString())
        expect(unstakeData.withdrawJettonAmount).toBe(withdrawJettonAmount)
        expect(unstakeData.withdrawTonAmount).toBe(withdrawTonAmount)
        expect(unstakeData.ownerAddress).toBe(owner.address.toString())
        expect(unstakeData.unlockTimestamp).toBe(unlockTimestamp)

        const msgValue = toNano("1")
        const result = await unstakeRequest.sendInternalUnstake(owner.getSender(), msgValue)

        expect(result.transactions).toHaveTransaction({
            from: owner.address,
            to: unstakeRequest.address,
            success: true,
            exitCode: UnstakeRequestErrors.noErrors
        })

        expect(result.transactions).toHaveTransaction({
            from: unstakeRequest.address,
            to: financial.address,
            body: beginCell()
                .storeUint(FinancialOpcodes.unstake, 32)
                .storeInt(0, 64)
                .storeAddress(owner.address)
                .storeCoins(toNano(withdrawTonAmount.toString()))
                .storeCoins(toNano(withdrawJettonAmount.toString()))
                .endCell(),
            success: true,
            exitCode: UnstakeRequestErrors.noErrors
        })

        unstakeData = await unstakeRequest.getUnstakeData()
        expect(unstakeData.index).toBe(0)
        expect(unstakeData.financialAddress).toBe(financial.address.toString())
        expect(unstakeData.withdrawJettonAmount).toBe(withdrawJettonAmount)
        expect(unstakeData.withdrawTonAmount).toBe(withdrawTonAmount)
        expect(unstakeData.ownerAddress).toBe(owner.address.toString())
        expect(unstakeData.unlockTimestamp).toBe(0)

        const result2 = await unstakeRequest.sendInternalUnstake(owner.getSender(), msgValue)

        expect(result2.transactions).toHaveTransaction({
            from: owner.address,
            to: unstakeRequest.address,
            success: false,
            exitCode: UnstakeRequestErrors.notAllowed
        })
    });

    it('[internal] [op return unstake request] should throw an error when receive msg not from financial', async () => {
        const unlockTimestamp = Math.trunc(Math.floor(now() / 1000))
        const withdrawTonAmount = 100;
        const withdrawJettonAmount = 100;
        await initUnstakeRequest(withdrawTonAmount, withdrawJettonAmount, unlockTimestamp)

        const msgValue = toNano("1")
        await unstakeRequest.sendInternalUnstake(owner.getSender(), msgValue)

        let unstakeData = await unstakeRequest.getUnstakeData()
        expect(unstakeData.index).toBe(0)
        expect(unstakeData.financialAddress).toBe(financial.address.toString())
        expect(unstakeData.withdrawJettonAmount).toBe(withdrawJettonAmount)
        expect(unstakeData.withdrawTonAmount).toBe(withdrawTonAmount)
        expect(unstakeData.ownerAddress).toBe(owner.address.toString())
        expect(unstakeData.unlockTimestamp).toBe(0)

        const result = await unstakeRequest.sendReturn(owner.getSender(), toNano("0.1"), {
            unlockTimestamp
        })

        expect(result.transactions).toHaveTransaction({
            from: owner.address,
            to: unstakeRequest.address,
            body: beginCell()
                .storeUint(UnstakeRequestOpCodes.return, 32)
                .storeInt(unlockTimestamp, 32)
                .endCell(),
            success: false,
            exitCode: UnstakeRequestErrors.notAllowed
        })

        unstakeData = await unstakeRequest.getUnstakeData()
        expect(unstakeData.index).toBe(0)
        expect(unstakeData.financialAddress).toBe(financial.address.toString())
        expect(unstakeData.withdrawJettonAmount).toBe(withdrawJettonAmount)
        expect(unstakeData.withdrawTonAmount).toBe(withdrawTonAmount)
        expect(unstakeData.ownerAddress).toBe(owner.address.toString())
        expect(unstakeData.unlockTimestamp).toBe(0)
    });

    it('[internal] [op return unstake request] should set a new unlock timestamp and allow interaction', async () => {
        const unlockTimestamp = Math.trunc(Math.floor(now() / 1000))
        const withdrawTonAmount = 100;
        const withdrawJettonAmount = 100;
        await initUnstakeRequest(withdrawTonAmount, withdrawJettonAmount, unlockTimestamp)

        const msgValue = toNano("1")
        await unstakeRequest.sendInternalUnstake(owner.getSender(), msgValue)

        let unstakeData = await unstakeRequest.getUnstakeData()
        expect(unstakeData.index).toBe(0)
        expect(unstakeData.financialAddress).toBe(financial.address.toString())
        expect(unstakeData.withdrawJettonAmount).toBe(withdrawJettonAmount)
        expect(unstakeData.withdrawTonAmount).toBe(withdrawTonAmount)
        expect(unstakeData.ownerAddress).toBe(owner.address.toString())
        expect(unstakeData.unlockTimestamp).toBe(0)

        const result = await unstakeRequest.sendReturn(financial.getSender(), toNano("0.1"), {
            unlockTimestamp
        })

        expect(result.transactions).toHaveTransaction({
            from: financial.address,
            to: unstakeRequest.address,
            body: beginCell()
                .storeUint(UnstakeRequestOpCodes.return, 32)
                .storeInt(unlockTimestamp, 32)
                .endCell(),
            success: true
        })

        unstakeData = await unstakeRequest.getUnstakeData()
        expect(unstakeData.index).toBe(0)
        expect(unstakeData.financialAddress).toBe(financial.address.toString())
        expect(unstakeData.withdrawJettonAmount).toBe(withdrawJettonAmount)
        expect(unstakeData.withdrawTonAmount).toBe(withdrawTonAmount)
        expect(unstakeData.ownerAddress).toBe(owner.address.toString())
        expect(unstakeData.unlockTimestamp).toBe(unlockTimestamp)

        const result2 = await unstakeRequest.sendInternalUnstake(owner.getSender(), msgValue)

        expect(result2.transactions).toHaveTransaction({
            from: owner.address,
            to: unstakeRequest.address,
            success: true,
            exitCode: UnstakeRequestErrors.noErrors
        })

        expect(result2.transactions).toHaveTransaction({
            from: unstakeRequest.address,
            to: financial.address,
            body: beginCell()
                .storeUint(FinancialOpcodes.unstake, 32)
                .storeInt(0, 64)
                .storeAddress(owner.address)
                .storeCoins(toNano(withdrawTonAmount.toString()))
                .storeCoins(toNano(withdrawJettonAmount.toString()))
                .endCell(),
            success: true,
            exitCode: UnstakeRequestErrors.noErrors
        })

        unstakeData = await unstakeRequest.getUnstakeData()
        expect(unstakeData.index).toBe(0)
        expect(unstakeData.financialAddress).toBe(financial.address.toString())
        expect(unstakeData.withdrawJettonAmount).toBe(withdrawJettonAmount)
        expect(unstakeData.withdrawTonAmount).toBe(withdrawTonAmount)
        expect(unstakeData.ownerAddress).toBe(owner.address.toString())
        expect(unstakeData.unlockTimestamp).toBe(0)

        const result3 = await unstakeRequest.sendInternalUnstake(owner.getSender(), msgValue)

        expect(result3.transactions).toHaveTransaction({
            from: owner.address,
            to: unstakeRequest.address,
            success: false,
            exitCode: UnstakeRequestErrors.notAllowed
        })
    });

    it('[external unstake] should throw an error when there was not enough balance', async () => {
        const unlockTimestamp = Math.trunc(Math.floor(now() / 1000))
        const withdrawTonAmount = 100;
        const withdrawJettonAmount = 100;
        await initUnstakeRequest(withdrawTonAmount, withdrawJettonAmount, unlockTimestamp)

        let unstakeData = await unstakeRequest.getUnstakeData()
        expect(unstakeData.index).toBe(0)
        expect(unstakeData.financialAddress).toBe(financial.address.toString())
        expect(unstakeData.withdrawJettonAmount).toBe(withdrawJettonAmount)
        expect(unstakeData.withdrawTonAmount).toBe(withdrawTonAmount)
        expect(unstakeData.ownerAddress).toBe(owner.address.toString())
        expect(unstakeData.unlockTimestamp).toBe(unlockTimestamp)

        try {
            await unstakeRequest.sendExternalUnstake()
        } catch (e: any){
            //Check error manually (103)
        }

        unstakeData = await unstakeRequest.getUnstakeData()
        expect(unstakeData.index).toBe(0)
        expect(unstakeData.financialAddress).toBe(financial.address.toString())
        expect(unstakeData.withdrawJettonAmount).toBe(withdrawJettonAmount)
        expect(unstakeData.withdrawTonAmount).toBe(withdrawTonAmount)
        expect(unstakeData.ownerAddress).toBe(owner.address.toString())
        expect(unstakeData.unlockTimestamp).toBe(unlockTimestamp)
    });

    it('[external unstake] should throw an error when unlock time has not passed', async () => {
        const unlockTimestamp = Math.trunc(Math.floor(now() / 1000)) + 1000
        const withdrawTonAmount = 100;
        const withdrawJettonAmount = 100;
        await initUnstakeRequest(withdrawTonAmount, withdrawJettonAmount, unlockTimestamp, 0.3)

        let unstakeData = await unstakeRequest.getUnstakeData()
        expect(unstakeData.index).toBe(0)
        expect(unstakeData.financialAddress).toBe(financial.address.toString())
        expect(unstakeData.withdrawJettonAmount).toBe(withdrawJettonAmount)
        expect(unstakeData.withdrawTonAmount).toBe(withdrawTonAmount)
        expect(unstakeData.ownerAddress).toBe(owner.address.toString())
        expect(unstakeData.unlockTimestamp).toBe(unlockTimestamp)

        try {
            await unstakeRequest.sendExternalUnstake()
        } catch (e: any){
            //Check error manually (51)
        }

        unstakeData = await unstakeRequest.getUnstakeData()
        expect(unstakeData.index).toBe(0)
        expect(unstakeData.financialAddress).toBe(financial.address.toString())
        expect(unstakeData.withdrawJettonAmount).toBe(withdrawJettonAmount)
        expect(unstakeData.withdrawTonAmount).toBe(withdrawTonAmount)
        expect(unstakeData.ownerAddress).toBe(owner.address.toString())
        expect(unstakeData.unlockTimestamp).toBe(unlockTimestamp)
    });

    it('[external unstake] should send msg to financial and throw an error on any interaction after that', async () => {
        const unlockTimestamp = Math.trunc(Math.floor(now() / 1000))
        const withdrawTonAmount = 100;
        const withdrawJettonAmount = 100;
        await initUnstakeRequest(withdrawTonAmount, withdrawJettonAmount, unlockTimestamp, 0.5)

        let unstakeData = await unstakeRequest.getUnstakeData()
        expect(unstakeData.index).toBe(0)
        expect(unstakeData.financialAddress).toBe(financial.address.toString())
        expect(unstakeData.withdrawJettonAmount).toBe(withdrawJettonAmount)
        expect(unstakeData.withdrawTonAmount).toBe(withdrawTonAmount)
        expect(unstakeData.ownerAddress).toBe(owner.address.toString())
        expect(unstakeData.unlockTimestamp).toBe(unlockTimestamp)

        const result = await unstakeRequest.sendExternalUnstake()

        expect(result.transactions).toHaveTransaction({
            to: unstakeRequest.address,
            success: true,
            exitCode: UnstakeRequestErrors.noErrors
        })

        expect(result.transactions).toHaveTransaction({
            from: unstakeRequest.address,
            to: financial.address,
            body: beginCell()
                .storeUint(FinancialOpcodes.unstake, 32)
                .storeInt(0, 64)
                .storeAddress(owner.address)
                .storeCoins(toNano(withdrawTonAmount.toString()))
                .storeCoins(toNano(withdrawJettonAmount.toString()))
                .endCell(),
            success: true,
            exitCode: UnstakeRequestErrors.noErrors
        })

        unstakeData = await unstakeRequest.getUnstakeData()
        expect(unstakeData.index).toBe(0)
        expect(unstakeData.financialAddress).toBe(financial.address.toString())
        expect(unstakeData.withdrawJettonAmount).toBe(withdrawJettonAmount)
        expect(unstakeData.withdrawTonAmount).toBe(withdrawTonAmount)
        expect(unstakeData.ownerAddress).toBe(owner.address.toString())
        expect(unstakeData.unlockTimestamp).toBe(0)

        try {
            await unstakeRequest.sendExternalUnstake()
        } catch (e: any){
            //Check error manually (50)
        }

        unstakeData = await unstakeRequest.getUnstakeData()
        expect(unstakeData.index).toBe(0)
        expect(unstakeData.financialAddress).toBe(financial.address.toString())
        expect(unstakeData.withdrawJettonAmount).toBe(withdrawJettonAmount)
        expect(unstakeData.withdrawTonAmount).toBe(withdrawTonAmount)
        expect(unstakeData.ownerAddress).toBe(owner.address.toString())
        expect(unstakeData.unlockTimestamp).toBe(0)
    });

});
