import {Blockchain, SandboxContract, TreasuryContract} from '@ton/sandbox';
import {beginCell, Cell, Dictionary, storeStateInit, toNano} from '@ton/core';
import {UnstakeRequest, UnstakeRequestErrors, UnstakeRequestOpCodes} from '../wrappers/UnstakeRequest';
import '@ton/test-utils';
import {compile} from '@ton/blueprint';
import {FinancialOpcodes} from "../wrappers/Financial";
import {findTransactionRequired} from "@ton/test-utils";
import {collectCellStats, printTxGasStats} from "./GasUtils";

describe('UnstakeRequest', () => {
    let code: Cell;

    let blockchain: Blockchain;
    let unstakeRequest: SandboxContract<UnstakeRequest>;
    let financial: SandboxContract<TreasuryContract>
    let owner: SandboxContract<TreasuryContract>

    async function initUnstakeRequest(withdrawTonAmount: number, withdrawJettonAmount: number, unlockTimestamp: number, initTonValue: number = 0.01, forwardPayload?: Cell) {
        const initResult = await unstakeRequest.sendInit(blockchain.sender(financial.address), toNano(initTonValue.toString()), {
            ownerAddress: owner.address.toString(),
            withdrawTonAmount,
            withdrawJettonAmount,
            unlockTimestamp,
            forwardPayload
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
                .storeMaybeRef(forwardPayload)
                .storeUint(unlockTimestamp, 32)
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
        expect(unstakeRequestData.forwardPayload?.hash.toString()).toBe(forwardPayload?.hash.toString())
    }

    beforeEach(async () => {
        blockchain = await Blockchain.create()

        financial = await blockchain.treasury('financial')

        const unstakeRequestCodeRaw = await compile('UnstakeRequest')

        const _libs = Dictionary.empty(Dictionary.Keys.BigUint(256), Dictionary.Values.Cell());
        _libs.set(BigInt(`0x${unstakeRequestCodeRaw.hash().toString('hex')}`), unstakeRequestCodeRaw);
        blockchain.libs = beginCell().storeDictDirect(_libs).endCell();
        let lib_unstake_prep = beginCell().storeUint(2, 8).storeBuffer(unstakeRequestCodeRaw.hash()).endCell();
        code = new Cell({exotic: true, bits: lib_unstake_prep.bits, refs: lib_unstake_prep.refs});

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

    it('should deploy', async () => {
        let smc = await blockchain.getContract(unstakeRequest.address);
        if (smc.accountState === undefined)
            throw new Error("Can't access cоntract state");
        if (smc.accountState.type !== "active")
            throw new Error("Contract is not active");
        if (smc.account.account === undefined || smc.account.account === null)
            throw new Error("Can't access wallet account!");
        console.log("Unstake storage stats:", smc.account.account.storageStats.used);
        let state = smc.accountState.state;
        let stateCell = beginCell().store(storeStateInit(state)).endCell();
        console.log("State init stats:", collectCellStats(stateCell, []));

        const unlockTimestamp = Math.trunc(Math.floor(Date.now() / 1000))
        const withdrawTonAmount = 100;
        const withdrawJettonAmount = 100;
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
        console.log("forwardPayload stats:", collectCellStats(forwardPayload, []));
        await initUnstakeRequest(withdrawTonAmount, withdrawJettonAmount, unlockTimestamp, 0.5, forwardPayload)

        smc = await blockchain.getContract(unstakeRequest.address)
        if (smc.accountState === undefined)
            throw new Error("Can't access cоntract state");
        if (smc.accountState.type !== "active")
            throw new Error("Contract is not active");
        if (smc.account.account === undefined || smc.account.account === null)
            throw new Error("Can't access wallet account!");
        console.log("Unstake storage stats after init:", smc.account.account.storageStats.used);
        state = smc.accountState.state;
        stateCell = beginCell().store(storeStateInit(state)).endCell();
        console.log("State init stats: after init", collectCellStats(stateCell, []));

        console.log("code stats:", collectCellStats(code, []));
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
                .storeMaybeRef(null)
                .storeUint(100, 32)
                .endCell(),
            success: false,
            exitCode: UnstakeRequestErrors.notAllowed
        })
    });

    it('[internal unstake] should throw an error when there was not enough balance', async () => {
        const unlockTimestamp = Math.trunc(Math.floor(Date.now() / 1000))
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
        expect(unstakeData.forwardPayload).toBe(null)

        const result = await unstakeRequest.sendInternalUnstake(owner.getSender(), toNano("0.01"))

        expect(result.transactions).toHaveTransaction({
            from: owner.address,
            to: unstakeRequest.address,
            success: false,
            exitCode: UnstakeRequestErrors.notEnoughGas
        })

        unstakeData = await unstakeRequest.getUnstakeData()
        expect(unstakeData.index).toBe(0)
        expect(unstakeData.financialAddress).toBe(financial.address.toString())
        expect(unstakeData.withdrawJettonAmount).toBe(withdrawJettonAmount)
        expect(unstakeData.withdrawTonAmount).toBe(withdrawTonAmount)
        expect(unstakeData.ownerAddress).toBe(owner.address.toString())
        expect(unstakeData.unlockTimestamp).toBe(unlockTimestamp)
        expect(unstakeData.forwardPayload).toBe(null)
    });

    it('[internal unstake] should throw an error when unlock time has not passed', async () => {
        const currentTimestamp = Math.trunc(Math.floor(Date.now() / 1000))
        await initUnstakeRequest(100, 100, currentTimestamp + 60 * 60 * 36)

        const result = await unstakeRequest.sendInternalUnstake(owner.getSender(), toNano("1"))

        expect(result.transactions).toHaveTransaction({
            from: owner.address,
            to: unstakeRequest.address,
            success: false,
            exitCode: UnstakeRequestErrors.unlockTimestampHasNotExpiredYet
        })
    });

    it('[internal unstake] should send msg to financial and throw an error on any interaction after that (null forward payload)', async () => {
        const unlockTimestamp = Math.trunc(Math.floor(Date.now() / 1000))
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
        expect(unstakeData.forwardPayload).toBe(null)

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
                .storeUint(0, 64)
                .storeAddress(owner.address)
                .storeCoins(toNano(withdrawTonAmount.toString()))
                .storeCoins(toNano(withdrawJettonAmount.toString()))
                .storeMaybeRef(null)
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
        expect(unstakeData.forwardPayload).toBe(null)

        const result2 = await unstakeRequest.sendInternalUnstake(owner.getSender(), msgValue)

        expect(result2.transactions).toHaveTransaction({
            from: owner.address,
            to: unstakeRequest.address,
            success: false,
            exitCode: UnstakeRequestErrors.notAllowed
        })

        const unstakeTx = findTransactionRequired(result.transactions, {
            from: owner.address,
            to: unstakeRequest.address,
            success: true,
            exitCode: UnstakeRequestErrors.noErrors
        });

        printTxGasStats("Internal Unstake request without payload", unstakeTx)
    });

    it('[internal unstake] should send msg with forward payload to financial and throw an error on any interaction after that', async () => {
        const unlockTimestamp = Math.trunc(Math.floor(Date.now() / 1000))
        const withdrawTonAmount = 100;
        const withdrawJettonAmount = 100;

        const forwardPayload = beginCell()
            .storeUint(2, 32)
            .storeUint(0, 64)
            .storeRef(
                beginCell()
                    .storeUint(2, 32)
                    .storeUint(0, 64)
                    .endCell()
            )
            .endCell()
        await initUnstakeRequest(withdrawTonAmount, withdrawJettonAmount, unlockTimestamp, 0.01, forwardPayload)

        let unstakeData = await unstakeRequest.getUnstakeData()
        expect(unstakeData.index).toBe(0)
        expect(unstakeData.financialAddress).toBe(financial.address.toString())
        expect(unstakeData.withdrawJettonAmount).toBe(withdrawJettonAmount)
        expect(unstakeData.withdrawTonAmount).toBe(withdrawTonAmount)
        expect(unstakeData.ownerAddress).toBe(owner.address.toString())
        expect(unstakeData.unlockTimestamp).toBe(unlockTimestamp)
        expect(unstakeData.forwardPayload?.hash().toString()).toBe(forwardPayload.hash().toString())

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
                .storeUint(0, 64)
                .storeAddress(owner.address)
                .storeCoins(toNano(withdrawTonAmount.toString()))
                .storeCoins(toNano(withdrawJettonAmount.toString()))
                .storeMaybeRef(forwardPayload)
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
        expect(unstakeData.forwardPayload?.hash().toString()).toBe(forwardPayload.hash().toString())

        const result2 = await unstakeRequest.sendInternalUnstake(owner.getSender(), msgValue)

        expect(result2.transactions).toHaveTransaction({
            from: owner.address,
            to: unstakeRequest.address,
            success: false,
            exitCode: UnstakeRequestErrors.notAllowed
        })

        const unstakeTx = findTransactionRequired(result.transactions, {
            from: owner.address,
            to: unstakeRequest.address,
            success: true,
            exitCode: UnstakeRequestErrors.noErrors
        });

        printTxGasStats("Internal Unstake request with payload", unstakeTx)
    });

    it('[internal] [op return unstake request] should throw an error when receive msg not from financial', async () => {
        const unlockTimestamp = Math.trunc(Math.floor(Date.now() / 1000))
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
        expect(unstakeData.forwardPayload).toBe(null)

        const result = await unstakeRequest.sendReturn(owner.getSender(), toNano("0.1"), {
            unlockTimestamp
        })

        expect(result.transactions).toHaveTransaction({
            from: owner.address,
            to: unstakeRequest.address,
            body: beginCell()
                .storeUint(UnstakeRequestOpCodes.return, 32)
                .storeUint(unlockTimestamp, 32)
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
        expect(unstakeData.forwardPayload).toBe(null)
    });

    it('[internal] [op return unstake request] should set a new unlock timestamp and allow interaction', async () => {
        const unlockTimestamp = Math.trunc(Math.floor(Date.now() / 1000))
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
        expect(unstakeData.forwardPayload).toBe(null)

        const result = await unstakeRequest.sendReturn(financial.getSender(), toNano("0.1"), {
            unlockTimestamp
        })

        expect(result.transactions).toHaveTransaction({
            from: financial.address,
            to: unstakeRequest.address,
            body: beginCell()
                .storeUint(UnstakeRequestOpCodes.return, 32)
                .storeUint(unlockTimestamp, 32)
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
        expect(unstakeData.forwardPayload).toBe(null)

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
                .storeUint(0, 64)
                .storeAddress(owner.address)
                .storeCoins(toNano(withdrawTonAmount.toString()))
                .storeCoins(toNano(withdrawJettonAmount.toString()))
                .storeMaybeRef(null)
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
        expect(unstakeData.forwardPayload).toBe(null)

        const result3 = await unstakeRequest.sendInternalUnstake(owner.getSender(), msgValue)

        expect(result3.transactions).toHaveTransaction({
            from: owner.address,
            to: unstakeRequest.address,
            success: false,
            exitCode: UnstakeRequestErrors.notAllowed
        })
    });

    it('[external unstake] should throw an error when there was not enough balance', async () => {
        const unlockTimestamp = Math.trunc(Math.floor(Date.now() / 1000))
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
        expect(unstakeData.forwardPayload).toBe(null)

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
        expect(unstakeData.forwardPayload).toBe(null)
    });

    it('[external unstake] should throw an error when unlock time has not passed', async () => {
        const unlockTimestamp = Math.trunc(Math.floor(Date.now() / 1000)) + 1000
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
        expect(unstakeData.forwardPayload).toBe(null)

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
        expect(unstakeData.forwardPayload).toBe(null)
    });

    it('[external unstake] should send msg to financial and throw an error on any interaction after that (null payload)', async () => {
        const unlockTimestamp = Math.trunc(Math.floor(Date.now() / 1000))
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
        expect(unstakeData.forwardPayload).toBe(null)

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
                .storeUint(0, 64)
                .storeAddress(owner.address)
                .storeCoins(toNano(withdrawTonAmount.toString()))
                .storeCoins(toNano(withdrawJettonAmount.toString()))
                .storeMaybeRef(null)
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
        expect(unstakeData.forwardPayload).toBe(null)

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
        expect(unstakeData.forwardPayload).toBe(null)

        printTxGasStats("External Unstake request without payload", result.transactions[0])
    });

    it('[external unstake] should send msg with forward payload to financial and throw an error on any interaction after that', async () => {
        const unlockTimestamp = Math.trunc(Math.floor(Date.now() / 1000))
        const withdrawTonAmount = 100;
        const withdrawJettonAmount = 100;
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
        await initUnstakeRequest(withdrawTonAmount, withdrawJettonAmount, unlockTimestamp, 0.5, forwardPayload)

        let unstakeData = await unstakeRequest.getUnstakeData()
        expect(unstakeData.index).toBe(0)
        expect(unstakeData.financialAddress).toBe(financial.address.toString())
        expect(unstakeData.withdrawJettonAmount).toBe(withdrawJettonAmount)
        expect(unstakeData.withdrawTonAmount).toBe(withdrawTonAmount)
        expect(unstakeData.ownerAddress).toBe(owner.address.toString())
        expect(unstakeData.unlockTimestamp).toBe(unlockTimestamp)
        expect(unstakeData.forwardPayload?.hash().toString()).toBe(forwardPayload.hash().toString())

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
                .storeUint(0, 64)
                .storeAddress(owner.address)
                .storeCoins(toNano(withdrawTonAmount.toString()))
                .storeCoins(toNano(withdrawJettonAmount.toString()))
                .storeMaybeRef(forwardPayload)
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
        expect(unstakeData.forwardPayload?.hash().toString()).toBe(forwardPayload.hash().toString())

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
        expect(unstakeData.forwardPayload?.hash().toString()).toBe(forwardPayload.hash().toString())

        printTxGasStats("External Unstake request with payload", result.transactions[0])
    });

});
