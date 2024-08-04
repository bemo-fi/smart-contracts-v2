import {Blockchain, internal, SandboxContract, TreasuryContract} from '@ton/sandbox'
import {Address, beginCell, Cell, Dictionary, fromNano, toNano} from '@ton/core'
import {Financial, FinancialErrors, FinancialOpcodes} from '../wrappers/Financial'
import '@ton/test-utils'
import {compile} from '@ton/blueprint'
import {JettonWallet, JettonWalletOpCodes} from "../wrappers/JettonWallet";
import {UnstakeRequest} from "../wrappers/UnstakeRequest";
import {
    calcStorageFee,
    computeFwdFees,
    computeGasFee, computeMessageForwardFees,
    getGasPrices,
    getMsgPrices, getStoragePrices,
    MsgPrices, printTxGasStats, StorageStats,
} from "./GasUtils";
import {findTransactionRequired, randomAddress} from "@ton/test-utils";

describe('Financial', () => {
    let code: Cell
    let blockchain: Blockchain
    let jettonWalletCode: Cell
    let unstakeRequestCode: Cell
    let admin: SandboxContract<TreasuryContract>
    let transactionAdmin: SandboxContract<TreasuryContract>
    let commissionWallet: SandboxContract<TreasuryContract>
    let financial: SandboxContract<Financial>

    const stakeNotificationAmount = toNano('0.01')

    function getMintFee(fwdAmount: bigint, fwdPayload: Cell | null, customPayload: Cell | null, withFwdFee: boolean): bigint {
        const msgPrices = getMsgPrices(blockchain.config, 0)
        const gasPrices = getGasPrices(blockchain.config, 0)

        const calcSendFees = (
            stake_fee: bigint,
            recv_fee: bigint,
            fwd_fee: bigint,
            fwd_amount: bigint,
            storage_fee: bigint,
            state_init?: bigint
        ) => {
            const fwd_count = fwd_amount > 0n ? 2n : 1n;
            const overhead = state_init || defaultOverhead;
            return fwd_amount + fwd_count * fwd_fee + overhead + stake_fee + recv_fee + storage_fee;
        }

        const estimateTransferFwd = (
            fwd_amount: bigint,
            fwd_payload: Cell | null,
            custom_payload: Cell | null,
            prices?: MsgPrices
        ) => {
            // Purpose is to account for the first biggest one fwd fee.
            // So, we use fwd_amount here only for body calculation

            const mockFrom = randomAddress(0);
            const mockTo = randomAddress(0);
            const mockJettonAmount = toNano(100);

            const body = JettonWallet.transferMessage(mockJettonAmount, mockTo,
                mockFrom, customPayload,
                fwdAmount, fwdPayload);

            const curPrices = prices || msgPrices;
            const mockAddr = new Address(0, Buffer.alloc(32, 'A'));
            const testMsg = internal({
                from: mockAddr,
                to: mockAddr,
                value: toNano('1'),
                body
            });
            const feesRes = computeMessageForwardFees(curPrices, testMsg);
            // @ts-ignore
            return feesRes.fees.total;
        }

        const forwardOverhead = (prices: MsgPrices, stats: StorageStats) => {
            // Meh, kinda lazy way of doing that, but tests are bloated enough already
            return computeFwdFees(prices, stats.cells, stats.bits) - prices.lumpPrice;
        }

        const defaultOverhead = forwardOverhead(msgPrices, JettonWallet.stateInitStats);
        const storagePrices = getStoragePrices(blockchain.config);
        const storageDuration = 5 * 365 * 24 * 3600;

        const fwdFee = estimateTransferFwd(fwdAmount, fwdPayload, customPayload)
        const stake_gas_fee = computeGasFee(gasPrices, Financial.stakeGas)
        const receive_gas_fee = computeGasFee(gasPrices, JettonWallet.receiveGas)
        const min_tons_for_jetton_wallet_storage = calcStorageFee(storagePrices, JettonWallet.storageStats, BigInt(storageDuration));

        return calcSendFees(
            stake_gas_fee,
            receive_gas_fee,
            withFwdFee ? fwdFee : 0n,
            fwdAmount,
            min_tons_for_jetton_wallet_storage
        );
    }

    beforeAll(async () => {
        code = await compile('Financial')
    })

    beforeEach(async () => {
        blockchain = await Blockchain.create()

        admin = await blockchain.treasury('admin')
        transactionAdmin = await blockchain.treasury('transactionAdmin')
        commissionWallet = await blockchain.treasury('commissionAddress')

        const jettonWalletCodeRaw = await compile('JettonWallet')
        const unstakeRequestCodeRaw = await compile('UnstakeRequest')

        //jwallet_code is library
        const _libs = Dictionary.empty(Dictionary.Keys.BigUint(256), Dictionary.Values.Cell());
        _libs.set(BigInt(`0x${jettonWalletCodeRaw.hash().toString('hex')}`), jettonWalletCodeRaw);
        _libs.set(BigInt(`0x${unstakeRequestCodeRaw.hash().toString('hex')}`), unstakeRequestCodeRaw);
        blockchain.libs = beginCell().storeDictDirect(_libs).endCell();

        let lib_jetton_prep = beginCell().storeUint(2, 8).storeBuffer(jettonWalletCodeRaw.hash()).endCell();
        jettonWalletCode = new Cell({exotic: true, bits: lib_jetton_prep.bits, refs: lib_jetton_prep.refs});

        let lib_unstake_prep = beginCell().storeUint(2, 8).storeBuffer(unstakeRequestCodeRaw.hash()).endCell();
        unstakeRequestCode = new Cell({exotic: true, bits: lib_unstake_prep.bits, refs: lib_unstake_prep.refs});

        financial = blockchain.openContract(await Financial.createFromConfig({
            commissionAddress: commissionWallet.address.toString(),
            adminAddress: admin.address.toString(),
            transactionAdminAddress: transactionAdmin.address.toString(),
            commissionFactor: 50,
            commissionTotalSupply: 0,
            content: {
                name: "test",
                description: "test ton staking jetton",
                symbol: "TEST"
            },
            jettonTotalSupply: 1,
            tonTotalSupply: 1,
            jettonWalletCode: jettonWalletCode,
            unstakeRequestCode: unstakeRequestCode
        }, code))

        const deployer = await blockchain.treasury('deployer')

        const deployResult = await financial.sendDeploy(deployer.getSender(), toNano('0.05'))

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: financial.address,
            deploy: true,
        })
    })

    it('[receive ton] should throw error when sender is not in workchain', async () => {
        const anyone = await blockchain.treasury('anyone', {workchain: -1})

        const initialFinancialData = await financial.getFinancialData()
        expect(initialFinancialData.tonTotalSupply).toBe(1)
        expect(initialFinancialData.jettonTotalSupply).toBe(1)
        expect(initialFinancialData.commissionTotalSupply).toBe(0)

        const tonAmount = toNano(100)
        const result = await financial.sendTonToFinancial(anyone.getSender(), tonAmount)

        expect(result.transactions.length).toBe(3)

        expect(result.transactions).toHaveTransaction({
            from: anyone.address,
            to: financial.address,
            value: tonAmount,
            success: false,
            exitCode: FinancialErrors.notWorkchain
        })

        expect(result.transactions).toHaveTransaction({
            from: financial.address,
            to: anyone.address,
            value: (x) => {
                return x! <= tonAmount
            },
            success: true
        })

        const financialData = await financial.getFinancialData()
        expect(financialData.tonTotalSupply).toBe(initialFinancialData.tonTotalSupply)
        expect(financialData.jettonTotalSupply).toBe(initialFinancialData.jettonTotalSupply)
        expect(financialData.commissionTotalSupply).toBe(initialFinancialData.commissionTotalSupply)
    })

    it('[receive ton] should throw error when sender sent not enough ton', async () => {
        const anyone = await blockchain.treasury('anyone')
        const tonAmount = toNano('0.01')

        const initialFinancialData = await financial.getFinancialData()
        expect(initialFinancialData.tonTotalSupply).toBe(1)
        expect(initialFinancialData.jettonTotalSupply).toBe(1)
        expect(initialFinancialData.commissionTotalSupply).toBe(0)

        const result = await financial.sendTonToFinancial(anyone.getSender(), tonAmount)

        expect(result.transactions.length).toBe(3)

        expect(result.transactions).toHaveTransaction({
            from: anyone.address,
            to: financial.address,
            value: tonAmount,
            success: false,
            exitCode: FinancialErrors.insufficientMsgValue
        })

        expect(result.transactions).toHaveTransaction({
            from: financial.address,
            to: anyone.address,
            value: (x) => {
                return x! <= tonAmount
            },
            success: true
        })

        const financialData = await financial.getFinancialData()
        expect(financialData.tonTotalSupply).toBe(initialFinancialData.tonTotalSupply)
        expect(financialData.jettonTotalSupply).toBe(initialFinancialData.jettonTotalSupply)
        expect(financialData.commissionTotalSupply).toBe(initialFinancialData.commissionTotalSupply)
    })

    it('[receive ton] should mint jettons to anyone and pools increase', async () => {
        const anyone = await blockchain.treasury('anyone')

        const reward = 1000
        await financial.sendTonWithReward(anyone.getSender(), toNano(1000), {reward})

        const anyoneJettonWalletAddress = await financial.getWalletAddress(anyone.address.toString())

        const initialFinancialData = await financial.getFinancialData()
        const commission = reward * initialFinancialData.commissionFactor / 1000
        expect(initialFinancialData.tonTotalSupply).toBe(1 + reward - commission)
        expect(initialFinancialData.jettonTotalSupply).toBe(1)
        expect(initialFinancialData.commissionTotalSupply).toBe(commission)
        const stakeAmount = 10000

        const tonAmount = toNano((stakeAmount).toString()) + getMintFee(stakeNotificationAmount, null, null, true)
        const result = await financial.sendTonToFinancial(anyone.getSender(), tonAmount)

        expect(result.transactions.length).toBe(5)

        const stakeBody = beginCell()
            .storeUint(FinancialOpcodes.mint, 32)
            .endCell()

        expect(result.transactions.length).toBe(5)

        expect(result.transactions).toHaveTransaction({
            from: anyone.address,
            to: financial.address,
            value: tonAmount,
            body: stakeBody,
            success: true
        })

        const stakeJettonAmount = Number((initialFinancialData.jettonTotalSupply * stakeAmount / initialFinancialData.tonTotalSupply).toFixed(9))

        const mintBody = beginCell()
            .storeUint(JettonWalletOpCodes.internalTransfer, 32)
            .storeUint(0, 64)
            .storeCoins(toNano(stakeJettonAmount.toString()))
            .storeAddress(financial.address)
            .storeAddress(anyone.address)
            .storeCoins(stakeNotificationAmount)
            .storeMaybeRef(null)
            .endCell()

        expect(result.transactions).toHaveTransaction({
            from: financial.address,
            to: anyoneJettonWalletAddress,
            body: mintBody,
            success: true
        })

        const transferNotificationBody = beginCell()
            .storeUint(JettonWalletOpCodes.transferNotification ,32)
            .storeUint(0,64)
            .storeCoins(toNano(stakeJettonAmount.toFixed(9)))
            .storeAddress(financial.address)
            .storeMaybeRef(null)
            .endCell()

        expect(result.transactions).toHaveTransaction({
            from: anyoneJettonWalletAddress,
            to: anyone.address,
            body: transferNotificationBody,
            value: stakeNotificationAmount,
            success: true
        })

        expect(result.transactions).toHaveTransaction({
            from: anyoneJettonWalletAddress,
            to: anyone.address,
            body: beginCell()
                .storeUint(JettonWalletOpCodes.excesses, 32)
                .storeUint(0, 64)
                .endCell(),
            success: true
        })

        const financialData = await financial.getFinancialData()
        expect(financialData.tonTotalSupply).toBe(initialFinancialData.tonTotalSupply + stakeAmount)
        expect(financialData.jettonTotalSupply).toBe(initialFinancialData.jettonTotalSupply + stakeJettonAmount)
        expect(financialData.commissionTotalSupply).toBe(initialFinancialData.commissionTotalSupply)

        const anyoneJettonWallet = blockchain.openContract(await JettonWallet.createFromAddress(anyoneJettonWalletAddress))
        const jettonWalletData1 = await anyoneJettonWallet.getWalletData()
        expect(jettonWalletData1.balance).toBe(stakeJettonAmount)

        await financial.sendTonToFinancial(anyone.getSender(), tonAmount)
        const jettonWalletData2 = await anyoneJettonWallet.getWalletData()
        expect(jettonWalletData2.balance).toBe(jettonWalletData1.balance + stakeJettonAmount)

        const stakeTx = findTransactionRequired(result.transactions, {
            from: anyone.address,
            to: financial.address,
            value: tonAmount,
            success: true,
            body: stakeBody,
            exitCode: FinancialErrors.noErrors
        });

        printTxGasStats("Stake", stakeTx)
    })

    it('[stake] should throw error when sender is not in workchain', async () => {
        const anyone = await blockchain.treasury('anyone', {workchain: -1})

        const initialFinancialData = await financial.getFinancialData()
        expect(initialFinancialData.tonTotalSupply).toBe(1)
        expect(initialFinancialData.jettonTotalSupply).toBe(1)
        expect(initialFinancialData.commissionTotalSupply).toBe(0)

        const tonAmount = toNano(100)
        const forwardAmount = 10
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

        const result = await financial.sendStake(anyone.getSender(), tonAmount, {
            forwardAmount,
            forwardPayload
        })

        expect(result.transactions.length).toBe(3)

        expect(result.transactions).toHaveTransaction({
            from: anyone.address,
            to: financial.address,
            value: tonAmount,
            success: false,
            exitCode: FinancialErrors.notWorkchain
        })

        expect(result.transactions).toHaveTransaction({
            from: financial.address,
            to: anyone.address,
            value: (x) => {
                return x! <= tonAmount
            },
            success: true
        })

        const financialData = await financial.getFinancialData()
        expect(financialData.tonTotalSupply).toBe(initialFinancialData.tonTotalSupply)
        expect(financialData.jettonTotalSupply).toBe(initialFinancialData.jettonTotalSupply)
        expect(financialData.commissionTotalSupply).toBe(initialFinancialData.commissionTotalSupply)
    })

    it('[stake] should throw error when sender sent not enough ton', async () => {
        const anyone = await blockchain.treasury('anyone')
        const tonAmount = toNano('0.01')

        const initialFinancialData = await financial.getFinancialData()
        expect(initialFinancialData.tonTotalSupply).toBe(1)
        expect(initialFinancialData.jettonTotalSupply).toBe(1)
        expect(initialFinancialData.commissionTotalSupply).toBe(0)

        const forwardAmount = 10
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

        const result = await financial.sendStake(anyone.getSender(), tonAmount, {
            forwardAmount,
            forwardPayload
        })

        expect(result.transactions.length).toBe(3)

        expect(result.transactions).toHaveTransaction({
            from: anyone.address,
            to: financial.address,
            value: tonAmount,
            success: false,
            exitCode: FinancialErrors.insufficientMsgValue
        })

        expect(result.transactions).toHaveTransaction({
            from: financial.address,
            to: anyone.address,
            value: (x) => {
                return x! <= tonAmount
            },
            success: true
        })

        const financialData = await financial.getFinancialData()
        expect(financialData.tonTotalSupply).toBe(initialFinancialData.tonTotalSupply)
        expect(financialData.jettonTotalSupply).toBe(initialFinancialData.jettonTotalSupply)
        expect(financialData.commissionTotalSupply).toBe(initialFinancialData.commissionTotalSupply)
    })

    it('[stake] should mint jettons to anyone, pools increase and send msg to sender from jetton wallet', async () => {
        const anyone = await blockchain.treasury('anyone')

        const reward = 1000
        await financial.sendTonWithReward(anyone.getSender(), toNano(1000), {reward})

        const anyoneJettonWalletAddress = await financial.getWalletAddress(anyone.address.toString())

        const initialFinancialData = await financial.getFinancialData()
        const commission = reward * initialFinancialData.commissionFactor / 1000
        expect(initialFinancialData.tonTotalSupply).toBe(1 + reward - commission)
        expect(initialFinancialData.jettonTotalSupply).toBe(1)
        expect(initialFinancialData.commissionTotalSupply).toBe(commission)
        const stakeAmount = 10000

        const forwardAmount = toNano('10')
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
        const tonAmount = toNano((stakeAmount).toString()) + getMintFee(forwardAmount, forwardPayload, null, true)

        const result = await financial.sendStake(anyone.getSender(), tonAmount, {
            forwardAmount: Number(fromNano(forwardAmount)),
            forwardPayload
        })

        const stakeBody = beginCell()
            .storeUint(FinancialOpcodes.stake, 32)
            .storeUint(0, 64)
            .storeCoins(forwardAmount)
            .storeMaybeRef(forwardPayload)
            .endCell()

        expect(result.transactions.length).toBe(5)

        expect(result.transactions).toHaveTransaction({
            from: anyone.address,
            to: financial.address,
            value: tonAmount,
            body: stakeBody,
            success: true
        })

        const stakeJettonAmount = Number((initialFinancialData.jettonTotalSupply * stakeAmount / initialFinancialData.tonTotalSupply).toFixed(9))

        const mintBody = beginCell()
            .storeUint(JettonWalletOpCodes.internalTransfer, 32)
            .storeUint(0, 64)
            .storeCoins(toNano(stakeJettonAmount.toString()))
            .storeAddress(financial.address)
            .storeAddress(anyone.address)
            .storeCoins(forwardAmount)
            .storeMaybeRef(forwardPayload)
            .endCell()

        expect(result.transactions).toHaveTransaction({
            from: financial.address,
            to: anyoneJettonWalletAddress,
            body: mintBody,
            success: true
        })

        const transferNotificationBody = beginCell()
            .storeUint(JettonWalletOpCodes.transferNotification ,32)
            .storeUint(0,64)
            .storeCoins(toNano(stakeJettonAmount.toFixed(9)))
            .storeAddress(financial.address)
            .storeMaybeRef(forwardPayload)
            .endCell()

        expect(result.transactions).toHaveTransaction({
            from: anyoneJettonWalletAddress,
            to: anyone.address,
            body: transferNotificationBody,
            value: forwardAmount,
            success: true
        })

        expect(result.transactions).toHaveTransaction({
            from: anyoneJettonWalletAddress,
            to: anyone.address,
            body: beginCell()
                .storeUint(JettonWalletOpCodes.excesses, 32)
                .storeUint(0, 64)
                .endCell(),
            success: true
        })

        const financialData = await financial.getFinancialData()
        expect(financialData.tonTotalSupply).toBe(initialFinancialData.tonTotalSupply + stakeAmount)
        expect(financialData.jettonTotalSupply).toBe(initialFinancialData.jettonTotalSupply + stakeJettonAmount)
        expect(financialData.commissionTotalSupply).toBe(initialFinancialData.commissionTotalSupply)

        const anyoneJettonWallet = blockchain.openContract(await JettonWallet.createFromAddress(anyoneJettonWalletAddress))
        const jettonWalletData1 = await anyoneJettonWallet.getWalletData()
        expect(jettonWalletData1.balance).toBe(stakeJettonAmount)

        const stakeTx = findTransactionRequired(result.transactions, {
            from: anyone.address,
            to: financial.address,
            value: tonAmount,
            success: true,
            body: stakeBody,
            exitCode: FinancialErrors.noErrors
        });

        printTxGasStats("Stake", stakeTx)
    })

    it('[receive ton with reward] should throw error when msg value less than reward', async () => {
        const anyone = await blockchain.treasury('anyone')
        const tonAmount = toNano(100)

        const initialFinancialData = await financial.getFinancialData()
        expect(initialFinancialData.tonTotalSupply).toBe(1)
        expect(initialFinancialData.jettonTotalSupply).toBe(1)
        expect(initialFinancialData.commissionTotalSupply).toBe(0)

        const result = await financial.sendTonWithReward(anyone.getSender(), tonAmount, {reward: 101})

        expect(result.transactions.length).toBe(3)

        expect(result.transactions).toHaveTransaction({
            from: anyone.address,
            to: financial.address,
            value: tonAmount,
            success: false,
            exitCode: FinancialErrors.msgValueLessThanReward
        })

        expect(result.transactions).toHaveTransaction({
            from: financial.address,
            to: anyone.address,
            value: (x) => {
                return x! <= tonAmount
            },
            success: true
        })

        const financialData = await financial.getFinancialData()
        expect(financialData.tonTotalSupply).toBe(initialFinancialData.tonTotalSupply)
        expect(financialData.jettonTotalSupply).toBe(initialFinancialData.jettonTotalSupply)
        expect(financialData.commissionTotalSupply).toBe(initialFinancialData.commissionTotalSupply)
    })

    it('[receive ton with reward] should not increase pools when there is no reward', async () => {
        const anyone = await blockchain.treasury('anyone')
        const tonAmount = toNano(100)

        const initialFinancialData = await financial.getFinancialData()
        expect(initialFinancialData.tonTotalSupply).toBe(1)
        expect(initialFinancialData.jettonTotalSupply).toBe(1)
        expect(initialFinancialData.commissionTotalSupply).toBe(0)

        const result = await financial.sendTonWithReward(anyone.getSender(), tonAmount, {reward: 0})

        expect(result.transactions.length).toBe(2)

        expect(result.transactions).toHaveTransaction({
            from: anyone.address,
            to: financial.address,
            value: tonAmount,
            success: true
        })

        const financialData = await financial.getFinancialData()
        expect(financialData.tonTotalSupply).toBe(initialFinancialData.tonTotalSupply)
        expect(financialData.jettonTotalSupply).toBe(initialFinancialData.jettonTotalSupply)
        expect(financialData.commissionTotalSupply).toBe(initialFinancialData.commissionTotalSupply)
    })

    it('[receive ton with reward] should increase ton and commission pools', async () => {
        const anyone = await blockchain.treasury('anyone')
        const tonAmount = toNano(101)

        const initialFinancialData = await financial.getFinancialData()
        expect(initialFinancialData.tonTotalSupply).toBe(1)
        expect(initialFinancialData.jettonTotalSupply).toBe(1)
        expect(initialFinancialData.commissionTotalSupply).toBe(0)

        const reward = 100

        const result = await financial.sendTonWithReward(anyone.getSender(), tonAmount, {reward})

        expect(result.transactions.length).toBe(2)

        expect(result.transactions).toHaveTransaction({
            from: anyone.address,
            to: financial.address,
            value: tonAmount,
            success: true
        })

        const commission = reward * initialFinancialData.commissionFactor / 1000

        const financialData = await financial.getFinancialData()
        expect(financialData.tonTotalSupply).toBe(initialFinancialData.tonTotalSupply + reward - commission)
        expect(financialData.jettonTotalSupply).toBe(initialFinancialData.jettonTotalSupply)
        expect(financialData.commissionTotalSupply).toBe(initialFinancialData.commissionTotalSupply + commission)
    })

    it('[get pools] should return pools', async () => {
        const financialData = await financial.getFinancialData()

        const anyone = await blockchain.treasury('anyone')
        const tonAmount = toNano('0.1')

        const result = await financial.sendGetPools(anyone.getSender(), tonAmount)

        expect(result.transactions.length).toBe(3)
        expect(result.transactions).toHaveTransaction({
            from: financial.address,
            to: anyone.address,
            body: beginCell().storeUint(FinancialOpcodes.getPools, 32).storeCoins(toNano(financialData.jettonTotalSupply)).storeCoins(toNano(financialData.tonTotalSupply)).endCell(),
            success: true
        })

        // less than minimum sum

        const smallTonAmount = toNano('0.01')

        const result2 = await financial.sendGetPools(anyone.getSender(), smallTonAmount)

        expect(result2.transactions.length).toBe(3)
        expect(result2.transactions).toHaveTransaction({
            from: anyone.address,
            to: financial.address,
            success: false,
            exitCode: FinancialErrors.insufficientMsgValue
        })

    })

    it('[get quote] should return pools', async () => {
        const financialData = await financial.getFinancialData()

        const anyone = await blockchain.treasury('anyone')
        const tonAmount = toNano('0.1')
        const queryId = 1111
        let customPayload = beginCell().storeUint(456, 14).endCell()

        const result = await financial.sendGetQuote(anyone.getSender(), tonAmount, {
            queryId: queryId,
            customPayload: customPayload
        })

        expect(result.transactions.length).toBe(3)
        expect(result.transactions).toHaveTransaction({
            from: financial.address,
            to: anyone.address,
            body: beginCell().storeUint(FinancialOpcodes.takeQuote, 32).storeUint(queryId, 64).storeUint(toNano(financialData.tonTotalSupply), 128).storeUint(toNano(financialData.jettonTotalSupply), 128).storeMaybeRef(customPayload).endCell(),
            success: true
        })

        // less than minimum sum

        const smallTonAmount = toNano('0.01')

        const result2 = await financial.sendGetQuote(anyone.getSender(), smallTonAmount, {
            queryId: queryId,
            customPayload: customPayload
        })

        expect(result2.transactions.length).toBe(3)
        expect(result2.transactions).toHaveTransaction({
            from: anyone.address,
            to: financial.address,
            success: false,
            exitCode: FinancialErrors.insufficientMsgValue
        })

    })

    it('[changing admin] should throw error if sender is not admin', async () => {
        const anyone = await blockchain.treasury('anyone')
        const tonAmount = toNano(1)

        const initialFinancialData = await financial.getFinancialData()
        expect(initialFinancialData.adminAddress).toBe(admin.address.toString())

        const result = await financial.sendChangeAdmin(anyone.getSender(), tonAmount, {
            newAdminAddress: anyone.address.toString()
        })

        expect(result.transactions.length).toBe(3)

        expect(result.transactions).toHaveTransaction({
            from: anyone.address,
            to: financial.address,
            value: tonAmount,
            success: false,
            exitCode: 73
        })

        expect(result.transactions).toHaveTransaction({
            from: financial.address,
            to: anyone.address,
            value: (x) => {
                return x! <= tonAmount
            },
            success: true
        })

        const financialData = await financial.getFinancialData()
        expect(financialData.adminAddress).toBe(initialFinancialData.adminAddress)
    })

    it('[changing admin] should change admin', async () => {
        const anyone = await blockchain.treasury('anyone')
        const tonAmount = toNano(1)

        const initialFinancialData = await financial.getFinancialData()
        expect(initialFinancialData.adminAddress).toBe(admin.address.toString())

        const result = await financial.sendChangeAdmin(admin.getSender(), tonAmount, {
            newAdminAddress: anyone.address.toString()
        })

        expect(result.transactions.length).toBe(2)

        expect(result.transactions).toHaveTransaction({
            from: admin.address,
            to: financial.address,
            value: tonAmount,
            success: true
        })

        const financialData = await financial.getFinancialData()
        expect(financialData.adminAddress).toBe(anyone.address.toString())
    })

    it('[changing transaction admin] should throw error if sender is not admin', async () => {
        const anyone = await blockchain.treasury('anyone')
        const tonAmount = toNano(1)

        const initialFinancialData = await financial.getFinancialData()
        expect(initialFinancialData.transactionAdminAddress).toBe(transactionAdmin.address.toString())
        expect(initialFinancialData.adminAddress).toBe(admin.address.toString())

        const result = await financial.sendChangeTransactionAdmin(anyone.getSender(), tonAmount, {
            newTransactionAdminAddress: anyone.address.toString()
        })

        expect(result.transactions.length).toBe(3)

        expect(result.transactions).toHaveTransaction({
            from: anyone.address,
            to: financial.address,
            value: tonAmount,
            success: false,
            exitCode: 73
        })

        expect(result.transactions).toHaveTransaction({
            from: financial.address,
            to: anyone.address,
            value: (x) => {
                return x! <= tonAmount
            },
            success: true
        })

        const financialData = await financial.getFinancialData()
        expect(financialData.transactionAdminAddress).toBe(initialFinancialData.transactionAdminAddress)
        expect(financialData.adminAddress).toBe(initialFinancialData.adminAddress)
    })

    it('[changing transaction admin] should change transaction admin', async () => {
        const anyone = await blockchain.treasury('anyone')
        const tonAmount = toNano(1)

        const initialFinancialData = await financial.getFinancialData()
        expect(initialFinancialData.adminAddress).toBe(admin.address.toString())

        const result = await financial.sendChangeTransactionAdmin(admin.getSender(), tonAmount, {
            newTransactionAdminAddress: anyone.address.toString()
        })

        expect(result.transactions.length).toBe(2)

        expect(result.transactions).toHaveTransaction({
            from: admin.address,
            to: financial.address,
            value: tonAmount,
            success: true
        })

        const financialData = await financial.getFinancialData()
        expect(financialData.transactionAdminAddress).toBe(anyone.address.toString())
        expect(financialData.adminAddress).toBe(admin.address.toString())
    })

    it('[changing content] should throw error if sender is not admin', async () => {
        const anyone = await blockchain.treasury('anyone')
        const tonAmount = toNano(1)
        const initialFinancialData = await financial.getFinancialData()
        expect(initialFinancialData.metadata.name).toBe('test')
        expect(initialFinancialData.metadata.description).toBe('test ton staking jetton')
        expect(initialFinancialData.metadata.symbol).toBe('TEST')

        const result = await financial.sendChangeContent(anyone.getSender(), tonAmount, {
            newContent: {
                name: "new",
                description: "new",
                symbol: "new"
            }
        })

        expect(result.transactions.length).toBe(3)

        expect(result.transactions).toHaveTransaction({
            from: anyone.address,
            to: financial.address,
            value: tonAmount,
            success: false,
            exitCode: 73
        })

        expect(result.transactions).toHaveTransaction({
            from: financial.address,
            to: anyone.address,
            value: (x) => {
                return x! <= tonAmount
            },
            success: true
        })

        const financialData = await financial.getFinancialData()
        expect(financialData.metadata.name).toBe(initialFinancialData.metadata.name)
        expect(financialData.metadata.description).toBe(initialFinancialData.metadata.description)
        expect(financialData.metadata.symbol).toBe(initialFinancialData.metadata.symbol)
    })

    it('[changing content] should change content', async () => {
        const tonAmount = toNano(1)
        const initialFinancialData = await financial.getFinancialData()
        expect(initialFinancialData.metadata.name).toBe('test')
        expect(initialFinancialData.metadata.description).toBe('test ton staking jetton')
        expect(initialFinancialData.metadata.symbol).toBe('TEST')

        const description = "Fanzee — это платформа для взаимодействия с фанатами, разработанная, чтобы помочь спортивным и развлекательным организациям наладить значимую связь со своими фанатами с помощью иммерсивной геймификации."
        const content = {
            description,
            name: "FNZ",
            symbol: "new",
            decimals: '9',
            image: "https://github.com/ton-community/ton-core/tree/main/src/dict"
        }

        const result = await financial.sendChangeContent(admin.getSender(), tonAmount, {
            newContent: content
        })

        expect(result.transactions.length).toBe(2)

        expect(result.transactions).toHaveTransaction({
            from: admin.address,
            to: financial.address,
            value: tonAmount,
            success: true
        })

        const financialData = await financial.getFinancialData()
        expect(financialData.metadata.name).toBe(content.name)
        expect(financialData.metadata.description).toBe(content.description)
        expect(financialData.metadata.symbol).toBe(content.symbol)
        expect(financialData.metadata.decimals).toBe(content.decimals)
        expect(financialData.metadata.image).toBe(content.image)
    })

    it('[changing commission factor] should throw error if sender is not admin', async () => {
        const anyone = await blockchain.treasury('anyone')
        const tonAmount = toNano(1)

        const initialFinancialData = await financial.getFinancialData()
        expect(initialFinancialData.commissionFactor).toBe(50)

        const result = await financial.sendChangeCommissionFactor(anyone.getSender(), tonAmount, {
            newCommissionFactor: 60
        })

        expect(result.transactions.length).toBe(3)

        expect(result.transactions).toHaveTransaction({
            from: anyone.address,
            to: financial.address,
            value: tonAmount,
            success: false,
            exitCode: 73
        })

        expect(result.transactions).toHaveTransaction({
            from: financial.address,
            to: anyone.address,
            value: (x) => {
                return x! <= tonAmount
            },
            success: true
        })

        const financialData = await financial.getFinancialData()
        expect(financialData.commissionFactor).toBe(initialFinancialData.commissionFactor)
    })

    it('[changing commission factor] should throw error if commission factor greater than commission base', async () => {
        const tonAmount = toNano(1)

        const initialFinancialData = await financial.getFinancialData()
        expect(initialFinancialData.commissionFactor).toBe(50)

        const result = await financial.sendChangeCommissionFactor(admin.getSender(), tonAmount, {
            newCommissionFactor: 2000
        })

        expect(result.transactions.length).toBe(3)

        expect(result.transactions).toHaveTransaction({
            from: admin.address,
            to: financial.address,
            value: tonAmount,
            exitCode: FinancialErrors.invalidCommissionFactor,
            success: false
        })

        expect(result.transactions).toHaveTransaction({
            from: financial.address,
            to: admin.address,
            value: (x) => {
                return x! <= tonAmount
            },
            success: true
        })

        const financialData = await financial.getFinancialData()
        expect(financialData.commissionFactor).toBe(initialFinancialData.commissionFactor)
    })

    it('[changing commission factor] should change commission factor', async () => {
        const tonAmount = toNano(1)

        const initialFinancialData = await financial.getFinancialData()
        expect(initialFinancialData.commissionFactor).toBe(50)

        const result = await financial.sendChangeCommissionFactor(admin.getSender(), tonAmount, {
            newCommissionFactor: 60
        })

        expect(result.transactions.length).toBe(2)

        expect(result.transactions).toHaveTransaction({
            from: admin.address,
            to: financial.address,
            value: tonAmount,
            success: true
        })

        const financialData = await financial.getFinancialData()
        expect(financialData.commissionFactor).toBe(60)
    })

    it('[changing commission address] should throw error if sender is not admin', async () => {
        const anyone = await blockchain.treasury('anyone')
        const tonAmount = toNano(1)

        const initialFinancialData = await financial.getFinancialData()
        expect(initialFinancialData.commissionAddress).toBe(commissionWallet.address.toString())

        const result = await financial.sendChangeCommissionAddress(anyone.getSender(), tonAmount, {
            newCommissionAddress: anyone.address.toString()
        })

        expect(result.transactions.length).toBe(3)

        expect(result.transactions).toHaveTransaction({
            from: anyone.address,
            to: financial.address,
            value: tonAmount,
            success: false,
            exitCode: 73
        })

        expect(result.transactions).toHaveTransaction({
            from: financial.address,
            to: anyone.address,
            value: (x) => {
                return x! <= tonAmount
            },
            success: true
        })

        const financialData = await financial.getFinancialData()
        expect(financialData.commissionAddress).toBe(initialFinancialData.commissionAddress)
    })

    it('[changing commission address] should change commission address', async () => {
        const anyone = await blockchain.treasury('anyone')
        const tonAmount = toNano(1)

        const initialFinancialData = await financial.getFinancialData()
        expect(initialFinancialData.commissionAddress).toBe(commissionWallet.address.toString())

        const result = await financial.sendChangeCommissionAddress(admin.getSender(), tonAmount, {
            newCommissionAddress: anyone.address.toString()
        })

        expect(result.transactions.length).toBe(2)

        expect(result.transactions).toHaveTransaction({
            from: admin.address,
            to: financial.address,
            value: tonAmount,
            success: true
        })

        const financialData = await financial.getFinancialData()
        expect(financialData.commissionAddress).toBe(anyone.address.toString())
    })

    it('[updating code] should throw error if sender is not admin', async () => {
        const anyone = await blockchain.treasury('anyone')
        const tonAmount = toNano(1)

        expect(financial.init?.code.toString()).toBe(code.toString())

        const initialUpdateCodeData = await financial.getTestUpgradeCodeInfo()
        expect(initialUpdateCodeData).toBe(false)

        const result = await financial.sendUpdateCode(anyone.getSender(), tonAmount, {
            newCode: await compile("NewFinancialForUpdateCodeTest")
        })

        expect(result.transactions.length).toBe(3)

        expect(result.transactions).toHaveTransaction({
            from: anyone.address,
            to: financial.address,
            value: tonAmount,
            success: false,
            exitCode: 73
        })

        expect(result.transactions).toHaveTransaction({
            from: financial.address,
            to: anyone.address,
            value: (x) => {
                return x! <= tonAmount
            },
            success: true
        })

        expect(financial.init?.code.toString()).toBe(code.toString())

        const updateCodeData = await financial.getTestUpgradeCodeInfo()
        expect(updateCodeData).toBe(false)
    })

    it('[updating code] should change code', async () => {
        const tonAmount = toNano(1)

        expect(financial.init?.code.toString()).toBe(code.toString())

        const initialUpdateCodeData = await financial.getTestUpgradeCodeInfo()
        expect(initialUpdateCodeData).toBe(false)

        const result = await financial.sendUpdateCode(admin.getSender(), tonAmount, {
            newCode: await compile("NewFinancialForUpdateCodeTest")
        })

        expect(result.transactions.length).toBe(2)

        expect(result.transactions).toHaveTransaction({
            from: admin.address,
            to: financial.address,
            value: tonAmount,
            success: true
        })

        const updateCodeData = await financial.getTestUpgradeCodeInfo()
        expect(updateCodeData).toBe(true)
    })

    it('[send ton] should throw error if sender is not admin', async () => {
        const anyone = await blockchain.treasury('anyone')

        await financial.sendTonToFinancial(anyone.getSender(), toNano(101))

        const tonAmount = toNano(100)
        const result = await financial.sendTonFromFinancial(anyone.getSender(), tonAmount, {
            destinationAddress: anyone.address.toString(),
            amount: 1
        })

        expect(result.transactions.length).toBe(3)

        expect(result.transactions).toHaveTransaction({
            from: anyone.address,
            to: financial.address,
            value: tonAmount,
            success: false,
            exitCode: FinancialErrors.notFromTransactionAdmin
        })

        expect(result.transactions).toHaveTransaction({
            from: financial.address,
            to: anyone.address,
            value: (x) => {
                return x! <= tonAmount
            },
            success: true
        })
    })

    it('[send ton] should throw error when not enough balance', async () => {
        const anyone = await blockchain.treasury('anyone')
        await financial.sendTonToFinancial(anyone.getSender(), toNano(101))

        const tonAmount = toNano(1)
        const result = await financial.sendTonFromFinancial(transactionAdmin.getSender(), tonAmount, {
            destinationAddress: anyone.address.toString(),
            amount: 1000
        })

        expect(result.transactions.length).toBe(3)

        expect(result.transactions).toHaveTransaction({
            from: transactionAdmin.address,
            to: financial.address,
            value: tonAmount,
            success: false,
            exitCode: FinancialErrors.insufficientBalance
        })

        expect(result.transactions).toHaveTransaction({
            from: financial.address,
            to: transactionAdmin.address,
            value: (x) => {
                return x! <= tonAmount
            },
            success: true
        })
    })

    it('[send ton] should bounce when destination not deployed', async () => {
        const anyone = await blockchain.treasury('anyone')
        await financial.sendTonToFinancial(anyone.getSender(), toNano(101))

        const tonAmount = toNano(1)
        const amountToDestination = 100
        const destinationAddress = 'EQDU_SWtzDnS4rIJOQLJMlm3hpn1f0qCh3ZDD1AH35dC7eLl'
        const result = await financial.sendTonFromFinancial(transactionAdmin.getSender(), tonAmount, {
            destinationAddress,
            amount: amountToDestination
        })

        expect(result.transactions.length).toBe(4)

        expect(result.transactions).toHaveTransaction({
            from: transactionAdmin.address,
            to: financial.address,
            value: tonAmount,
            success: true
        })

        expect(result.transactions).toHaveTransaction({
            from: financial.address,
            to: Address.parse(destinationAddress),
            value: toNano(amountToDestination),
            success: false
        })

        expect(result.transactions).toHaveTransaction({
            from: Address.parse(destinationAddress),
            to: financial.address,
            value: (x) => {
                return x! <= toNano(amountToDestination)
            },
            success: true
        })
    })

    it('[send ton] should send ton to destination', async () => {
        const anyone = await blockchain.treasury('anyone')
        await financial.sendTonToFinancial(anyone.getSender(), toNano(101))

        const tonAmount = toNano(1)
        const amountToDestination = 100
        const result = await financial.sendTonFromFinancial(transactionAdmin.getSender(), tonAmount, {
            destinationAddress: anyone.address.toString(),
            amount: amountToDestination
        })

        expect(result.transactions.length).toBe(3)

        expect(result.transactions).toHaveTransaction({
            from: transactionAdmin.address,
            to: financial.address,
            value: tonAmount,
            success: true
        })

        expect(result.transactions).toHaveTransaction({
            from: financial.address,
            to: anyone.address,
            value: toNano(amountToDestination),
            success: true,
            body: beginCell().endCell()
        })

    })

    it('[send commission] should throw error if sender is not admin', async () => {
        const anyone = await blockchain.treasury('anyone')

        const reward = 100
        await financial.sendTonWithReward(anyone.getSender(), toNano(101), {reward})

        const initialFinancialData = await financial.getFinancialData()

        const commission = reward * initialFinancialData.commissionFactor / 1000
        expect(initialFinancialData.commissionTotalSupply).toBe(commission)

        const tonAmount = toNano(1)
        const result = await financial.sendCommissionFromFinancial(anyone.getSender(), tonAmount)

        expect(result.transactions.length).toBe(3)

        expect(result.transactions).toHaveTransaction({
            from: anyone.address,
            to: financial.address,
            value: tonAmount,
            success: false,
            exitCode: 73
        })

        expect(result.transactions).toHaveTransaction({
            from: financial.address,
            to: anyone.address,
            value: (x) => {
                return x! <= tonAmount
            },
            success: true
        })

        const financialData = await financial.getFinancialData()
        expect(financialData.commissionTotalSupply).toBe(initialFinancialData.commissionTotalSupply)
    })

    it('[send commission] should throw error when commission pool is empty', async () => {
        const reward = 0
        await financial.sendTonWithReward(admin.getSender(), toNano(101), {reward})

        const initialFinancialData = await financial.getFinancialData()
        expect(initialFinancialData.commissionTotalSupply).toBe(0)

        const tonAmount = toNano(1)
        const result = await financial.sendCommissionFromFinancial(admin.getSender(), tonAmount)

        expect(result.transactions.length).toBe(3)

        expect(result.transactions).toHaveTransaction({
            from: admin.address,
            to: financial.address,
            value: tonAmount,
            success: false,
            exitCode: 104
        })

        expect(result.transactions).toHaveTransaction({
            from: financial.address,
            to: admin.address,
            value: (x) => {
                return x! <= tonAmount
            },
            success: true
        })

        const financialData = await financial.getFinancialData()
        expect(financialData.commissionTotalSupply).toBe(initialFinancialData.commissionTotalSupply)
    })

    it('[send commission] should send commission ton to commission address', async () => {
        const reward = 100
        await financial.sendTonWithReward(admin.getSender(), toNano(101), {reward})

        const initialFinancialData = await financial.getFinancialData()

        const commission = reward * initialFinancialData.commissionFactor / 1000
        expect(initialFinancialData.commissionTotalSupply).toBe(commission)

        const tonAmount = toNano(1)
        const result = await financial.sendCommissionFromFinancial(admin.getSender(), tonAmount)

        expect(result.transactions.length).toBe(3)

        expect(result.transactions).toHaveTransaction({
            from: admin.address,
            to: financial.address,
            value: tonAmount,
            success: true
        })

        expect(result.transactions).toHaveTransaction({
            from: financial.address,
            to: commissionWallet.address,
            value: toNano(initialFinancialData.commissionTotalSupply),
            success: true
        })

        const financialData = await financial.getFinancialData()
        expect(financialData.commissionTotalSupply).toBe(0)
    })

    it('[transfer jetton] should throw error if sender is not admin', async () => {
        const anyone = await blockchain.treasury('anyone')
        const jettonWallet = anyone

        const tonAmount = toNano(1)
        const jettonAmount = 100
        const result = await financial.sendTransferJetton(anyone.getSender(), tonAmount, {
            jettonAmount,
            destinationAddress: anyone.address.toString(),
            jettonWalletAddress: jettonWallet.address.toString()
        })

        expect(result.transactions.length).toBe(3)

        expect(result.transactions).toHaveTransaction({
            from: anyone.address,
            to: financial.address,
            value: tonAmount,
            success: false,
            exitCode: FinancialErrors.notFromAdmin
        })

        expect(result.transactions).toHaveTransaction({
            from: financial.address,
            to: anyone.address,
            value: (x) => {
                return x! <= tonAmount
            },
            success: true
        })
    })

    it('[transfer jetton] should throw error if not enough msg value', async () => {
        const anyone = await blockchain.treasury('anyone')
        const jettonWallet = anyone

        const tonAmount = toNano('0.03')
        const jettonAmount = 100
        const result = await financial.sendTransferJetton(admin.getSender(), tonAmount, {
            jettonAmount,
            destinationAddress: anyone.address.toString(),
            jettonWalletAddress: jettonWallet.address.toString()
        })

        expect(result.transactions.length).toBe(3)

        expect(result.transactions).toHaveTransaction({
            from: admin.address,
            to: financial.address,
            value: tonAmount,
            success: false,
            exitCode: FinancialErrors.insufficientMsgValue
        })

        expect(result.transactions).toHaveTransaction({
            from: financial.address,
            to: admin.address,
            value: (x) => {
                return x! <= tonAmount
            },
            success: true
        })
    })

    it('[transfer jetton] should transfer jetton', async () => {
        const anyone = await blockchain.treasury('anyone')

        await financial.sendTonToFinancial(anyone.getSender(), toNano(101))
        const anyoneJettonWallet = await financial.getWalletAddress(anyone.address.toString())

        const jettonWallet = blockchain.openContract(await JettonWallet.createFromConfig({
            balance: 0,
            jettonMasterAddress: financial.address.toString(),
            ownerAddress: financial.address.toString()
        }, jettonWalletCode))

        const jettonAmount = 100
        const stakeAmount = toNano((jettonAmount).toString()) + getMintFee(stakeNotificationAmount, null, null, false)
        await financial.sendTonToFinancial(blockchain.sender(financial.address), stakeAmount)

        let jettonWalletData = await jettonWallet.getWalletData()
        expect(jettonWalletData.balance).toBe(jettonAmount)
        expect(jettonWalletData.ownerAddress).toBe(financial.address.toString())

        const tonAmount = toNano('0.06')
        const result = await financial.sendTransferJetton(admin.getSender(), tonAmount, {
            jettonAmount,
            destinationAddress: anyone.address.toString(),
            jettonWalletAddress: jettonWallet.address.toString()
        })

        expect(result.transactions.length).toBe(5)

        expect(result.transactions).toHaveTransaction({
            from: admin.address,
            to: financial.address,
            value: tonAmount,
            success: true,
            body: beginCell()
                .storeUint(FinancialOpcodes.transferJetton, 32)
                .storeAddress(jettonWallet.address)
                .storeAddress(anyone.address)
                .storeCoins(toNano(jettonAmount.toString()))
                .endCell(),
            exitCode: FinancialErrors.noErrors
        })

        expect(result.transactions).toHaveTransaction({
            from: financial.address,
            to: jettonWallet.address,
            value: (x) => {
                return x! <= tonAmount
            },
            success: true
        })

        expect(result.transactions).toHaveTransaction({
            from: jettonWallet.address,
            to: anyoneJettonWallet,
            value: (x) => {
                return x! <= tonAmount
            },
            success: true
        })

        expect(result.transactions).toHaveTransaction({
            from: anyoneJettonWallet,
            to: anyone.address,
            value: (x) => {
                return x! <= tonAmount
            },
            success: true
        })

        jettonWalletData = await jettonWallet.getWalletData()
        expect(jettonWalletData.balance).toBe(0)
    })

    it('[op burn_notification] should throw error if sender is not a jetton wallet', async () => {
        const anyone = await blockchain.treasury('anyone')
        const tonAmount = toNano(101)

        const initialFinancialData = await financial.getFinancialData()
        expect(initialFinancialData.tonTotalSupply).toBe(1)
        expect(initialFinancialData.jettonTotalSupply).toBe(1)
        expect(initialFinancialData.commissionTotalSupply).toBe(0)

        const withdrawJettonAmount = 100

        const result = await financial.sendBurnNotification(anyone.getSender(), tonAmount, {
            withdrawJettonAmount,
            fromAddress: anyone.address.toString()
        })

        expect(result.transactions.length).toBe(3)

        expect(result.transactions).toHaveTransaction({
            from: anyone.address,
            to: financial.address,
            value: tonAmount,
            success: false,
            exitCode: 74
        })

        expect(result.transactions).toHaveTransaction({
            from: financial.address,
            to: anyone.address,
            value: (x) => {
                return x! <= tonAmount
            },
            success: true
        })

        const financialData = await financial.getFinancialData()
        expect(financialData.tonTotalSupply).toBe(initialFinancialData.tonTotalSupply)
        expect(financialData.jettonTotalSupply).toBe(initialFinancialData.jettonTotalSupply)
        expect(financialData.commissionTotalSupply).toBe(initialFinancialData.commissionTotalSupply)
    })

    it('[op burn_notification] should deploy unstake request, change supplies, refresh lockup config (null forwardPayload)', async () => {
        const anyone = await blockchain.treasury('anyone')
        const lockupPeriod = await financial.getLockupPeriod()
        const depositFee = Number(fromNano(getMintFee(stakeNotificationAmount, null, null, true)));
        const initialFinancialData1 = await financial.getFinancialData()
        expect(initialFinancialData1.tonTotalSupply).toBe(1)
        expect(initialFinancialData1.jettonTotalSupply).toBe(1)
        expect(initialFinancialData1.commissionTotalSupply).toBe(0)
        expect(initialFinancialData1.lastLockupEpoch).toBe(0)
        expect(initialFinancialData1.lockupSupply).toBe(0)
        expect(initialFinancialData1.nextLockupSupply).toBe(0)
        expect(initialFinancialData1.laterLockupSupply).toBe(0)
        expect(initialFinancialData1.nextUnstakeRequestIndex).toBe(0)

        const tonAmount = toNano("101")
        await financial.sendTonToFinancial(anyone.getSender(), tonAmount)

        const reward = 1000
        await financial.sendTonWithReward(anyone.getSender(), toNano(1000), {reward})

        const initialFinancialData2 = await financial.getFinancialData()
        const commission = reward * initialFinancialData2.commissionFactor / 1000
        expect(initialFinancialData2.tonTotalSupply).toBe(initialFinancialData1.tonTotalSupply + Number(fromNano(tonAmount)) - depositFee + reward - commission)
        expect(initialFinancialData2.jettonTotalSupply).toBe(initialFinancialData1.jettonTotalSupply + Number(fromNano(tonAmount)) - depositFee)
        expect(initialFinancialData2.commissionTotalSupply).toBe(commission)
        expect(initialFinancialData2.lastLockupEpoch).toBe(0)
        expect(initialFinancialData2.lockupSupply).toBe(0)
        expect(initialFinancialData2.nextLockupSupply).toBe(0)
        expect(initialFinancialData2.laterLockupSupply).toBe(0)
        expect(initialFinancialData2.nextUnstakeRequestIndex).toBe(0)

        const anyoneJettonWalletAddress = await financial.getWalletAddress(anyone.address.toString())
        const anyoneJettonWallet = blockchain.openContract(await JettonWallet.createFromAddress(anyoneJettonWalletAddress))
        await anyoneJettonWallet.sendReceive(blockchain.sender(financial.address), toNano('0.05'), {jettonAmount: 100})
        const initialJettonWalletData = await anyoneJettonWallet.getWalletData()
        expect(initialJettonWalletData.balance).toBe(Number(fromNano(tonAmount)) - depositFee + 100)

        const burnJettonAmount = 100
        const burnTonAmount = toNano(1)
        const epoch = Math.trunc(Math.floor(Date.now() / 1000) / lockupPeriod)
        const result = await anyoneJettonWallet.sendBurn(anyone.getSender(), burnTonAmount, {
            jettonAmount: burnJettonAmount
        })

        expect(result.transactions.length).toBe(4)

        expect(result.transactions).toHaveTransaction({
            from: anyone.address,
            to: anyoneJettonWallet.address,
            value: burnTonAmount,
            success: true
        })

        const burnNotificationBody = beginCell()
            .storeUint(JettonWalletOpCodes.burnNotification, 32)
            .storeUint(0, 64)
            .storeCoins(toNano(burnJettonAmount))
            .storeAddress(anyone.address)
            .storeAddress(anyone.address)
            .storeMaybeRef(null)
            .endCell()

        expect(result.transactions).toHaveTransaction({
            from: anyoneJettonWallet.address,
            to: financial.address,
            value: (x) => {
                return x! <= burnTonAmount
            },
            success: true,
            body: burnNotificationBody
        })
        const withdrawTonNanoAmount = toNano(initialFinancialData2.tonTotalSupply.toString()) * toNano(burnJettonAmount.toString()) / toNano(initialFinancialData2.jettonTotalSupply.toString())

        const unstakeRequestAddress = await financial.getUnstakeRequestAddress(initialFinancialData2.nextUnstakeRequestIndex!)

        const deployUnstakeRequestBody = beginCell()
            .storeUint(FinancialOpcodes.deployUnstakeRequest, 32)
            .storeAddress(anyone.address)
            .storeCoins(withdrawTonNanoAmount)
            .storeCoins(toNano(burnJettonAmount.toString()))
            .storeMaybeRef(null)
            .storeUint((epoch + 2) * lockupPeriod, 32)
            .endCell()

        expect(result.transactions).toHaveTransaction({
            from: financial.address,
            to: unstakeRequestAddress,
            value: (x) => {
                return x! <= burnTonAmount
            },
            success: true,
            body: deployUnstakeRequestBody
        })

        const unstakeRequest = blockchain.openContract(await UnstakeRequest.createFromAddress(unstakeRequestAddress))
        const unstakeRequestData = await unstakeRequest.getUnstakeData()

        expect(unstakeRequestData.index).toBe(initialFinancialData2.nextUnstakeRequestIndex)
        expect(unstakeRequestData.financialAddress).toBe(financial.address.toString())
        expect(unstakeRequestData.ownerAddress).toBe(anyone.address.toString())
        expect(unstakeRequestData.withdrawTonAmount).toBe(Number(fromNano(withdrawTonNanoAmount)))
        expect(unstakeRequestData.withdrawJettonAmount).toBe(burnJettonAmount)
        expect(unstakeRequestData.unlockTimestamp).toBe((epoch + 2) * lockupPeriod)
        expect(unstakeRequestData.forwardPayload).toBe(null)

        const financialData = await financial.getFinancialData()
        expect(financialData.tonTotalSupply).toBe(Number(fromNano(toNano(initialFinancialData2.tonTotalSupply.toString()) - withdrawTonNanoAmount)))
        expect(financialData.jettonTotalSupply).toBe(Number(fromNano(toNano(initialFinancialData2.jettonTotalSupply.toString()) - toNano(burnJettonAmount.toString()))))
        expect(financialData.commissionTotalSupply).toBe(initialFinancialData2.commissionTotalSupply)
        expect(financialData.lastLockupEpoch).toBe(epoch)
        expect(financialData.lockupSupply).toBe(initialFinancialData2.lockupSupply)
        expect(financialData.nextLockupSupply).toBe(initialFinancialData2.nextLockupSupply)
        expect(financialData.laterLockupSupply).toBe(Number(fromNano(withdrawTonNanoAmount)))
        expect(financialData.nextUnstakeRequestIndex).toBe(initialFinancialData2.nextUnstakeRequestIndex! + 1)

        const jettonWalletData = await anyoneJettonWallet.getWalletData()

        expect(jettonWalletData.balance).toBe(Number((initialJettonWalletData.balance - burnJettonAmount).toFixed(10)))

        const burnNotificationTx = findTransactionRequired(result.transactions, {
            from: anyoneJettonWallet.address,
            to: financial.address,
            success: true,
            body: burnNotificationBody,
            exitCode: FinancialErrors.noErrors
        });
        const deployUnstakeRequestTx = findTransactionRequired(result.transactions, {
            from: financial.address,
            to: unstakeRequestAddress,
            value: (x) => {
                return x! <= burnTonAmount
            },
            success: true,
            body: deployUnstakeRequestBody
        });

        printTxGasStats("Burn Notification without forward payload", burnNotificationTx)
        printTxGasStats("Deploy UnstakeRequest without forward payload", deployUnstakeRequestTx)
    })

    it('[op burn_notification] should deploy unstake request, change supplies, refresh lockup config (with forwardPayload)', async () => {
        const anyone = await blockchain.treasury('anyone')
        const lockupPeriod = await financial.getLockupPeriod()
        const depositFee = Number(fromNano(getMintFee(stakeNotificationAmount, null, null, true)));
        const initialFinancialData1 = await financial.getFinancialData()
        expect(initialFinancialData1.tonTotalSupply).toBe(1)
        expect(initialFinancialData1.jettonTotalSupply).toBe(1)
        expect(initialFinancialData1.commissionTotalSupply).toBe(0)
        expect(initialFinancialData1.lastLockupEpoch).toBe(0)
        expect(initialFinancialData1.lockupSupply).toBe(0)
        expect(initialFinancialData1.nextLockupSupply).toBe(0)
        expect(initialFinancialData1.laterLockupSupply).toBe(0)
        expect(initialFinancialData1.nextUnstakeRequestIndex).toBe(0)

        const tonAmount = toNano("101")
        await financial.sendTonToFinancial(anyone.getSender(), tonAmount)

        const reward = 1000
        await financial.sendTonWithReward(anyone.getSender(), toNano(1000), {reward})

        const initialFinancialData2 = await financial.getFinancialData()
        const commission = reward * initialFinancialData2.commissionFactor / 1000
        expect(initialFinancialData2.tonTotalSupply).toBe(initialFinancialData1.tonTotalSupply + Number(fromNano(tonAmount)) - depositFee + reward - commission)
        expect(initialFinancialData2.jettonTotalSupply).toBe(initialFinancialData1.jettonTotalSupply + Number(fromNano(tonAmount)) - depositFee)
        expect(initialFinancialData2.commissionTotalSupply).toBe(commission)
        expect(initialFinancialData2.lastLockupEpoch).toBe(0)
        expect(initialFinancialData2.lockupSupply).toBe(0)
        expect(initialFinancialData2.nextLockupSupply).toBe(0)
        expect(initialFinancialData2.laterLockupSupply).toBe(0)
        expect(initialFinancialData2.nextUnstakeRequestIndex).toBe(0)

        const anyoneJettonWalletAddress = await financial.getWalletAddress(anyone.address.toString())
        const anyoneJettonWallet = blockchain.openContract(await JettonWallet.createFromAddress(anyoneJettonWalletAddress))
        await anyoneJettonWallet.sendReceive(blockchain.sender(financial.address), toNano('0.05'), {jettonAmount: 100})
        const initialJettonWalletData = await anyoneJettonWallet.getWalletData()
        expect(initialJettonWalletData.balance).toBe(Number(fromNano(tonAmount)) - depositFee + 100)

        const burnJettonAmount = 100
        const burnTonAmount = toNano(1)
        const epoch = Math.trunc(Math.floor(Date.now() / 1000) / lockupPeriod)

        const anotherOne = await blockchain.treasury('anotherOne')
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

        const result = await anyoneJettonWallet.sendBurn(anyone.getSender(), burnTonAmount, {
            jettonAmount: burnJettonAmount,
            receiverAddress: anotherOne.address.toString(),
            forwardPayload
        })

        expect(result.transactions.length).toBe(4)

        expect(result.transactions).toHaveTransaction({
            from: anyone.address,
            to: anyoneJettonWallet.address,
            value: burnTonAmount,
            success: true
        })

        const burnNotificationBody = beginCell()
            .storeUint(JettonWalletOpCodes.burnNotification, 32)
            .storeUint(0, 64)
            .storeCoins(toNano(burnJettonAmount))
            .storeAddress(anyone.address)
            .storeAddress(anotherOne.address)
            .storeMaybeRef(forwardPayload)
            .endCell()

        expect(result.transactions).toHaveTransaction({
            from: anyoneJettonWallet.address,
            to: financial.address,
            value: (x) => {
                return x! <= burnTonAmount
            },
            success: true,
            body: burnNotificationBody
        })
        const withdrawTonNanoAmount = toNano(initialFinancialData2.tonTotalSupply.toString()) * toNano(burnJettonAmount.toString()) / toNano(initialFinancialData2.jettonTotalSupply.toString())

        const unstakeRequestAddress = await financial.getUnstakeRequestAddress(initialFinancialData2.nextUnstakeRequestIndex!)

        const deployUnstakeRequestBody = beginCell()
            .storeUint(FinancialOpcodes.deployUnstakeRequest, 32)
            .storeAddress(anotherOne.address)
            .storeCoins(withdrawTonNanoAmount)
            .storeCoins(toNano(burnJettonAmount.toString()))
            .storeMaybeRef(forwardPayload)
            .storeUint((epoch + 2) * lockupPeriod, 32)
            .endCell()

        expect(result.transactions).toHaveTransaction({
            from: financial.address,
            to: unstakeRequestAddress,
            value: (x) => {
                return x! <= burnTonAmount
            },
            success: true,
            body: deployUnstakeRequestBody
        })

        const unstakeRequest = blockchain.openContract(await UnstakeRequest.createFromAddress(unstakeRequestAddress))
        const unstakeRequestData = await unstakeRequest.getUnstakeData()

        expect(unstakeRequestData.index).toBe(initialFinancialData2.nextUnstakeRequestIndex)
        expect(unstakeRequestData.financialAddress).toBe(financial.address.toString())
        expect(unstakeRequestData.ownerAddress).toBe(anotherOne.address.toString())
        expect(unstakeRequestData.withdrawTonAmount).toBe(Number(fromNano(withdrawTonNanoAmount)))
        expect(unstakeRequestData.withdrawJettonAmount).toBe(burnJettonAmount)
        expect(unstakeRequestData.unlockTimestamp).toBe((epoch + 2) * lockupPeriod)
        expect(unstakeRequestData.forwardPayload!.hash().toString()).toBe(forwardPayload.hash().toString())

        const financialData = await financial.getFinancialData()
        expect(financialData.tonTotalSupply).toBe(Number(fromNano(toNano(initialFinancialData2.tonTotalSupply.toString()) - withdrawTonNanoAmount)))
        expect(financialData.jettonTotalSupply).toBe(Number(fromNano(toNano(initialFinancialData2.jettonTotalSupply.toString()) - toNano(burnJettonAmount.toString()))))
        expect(financialData.commissionTotalSupply).toBe(initialFinancialData2.commissionTotalSupply)
        expect(financialData.lastLockupEpoch).toBe(epoch)
        expect(financialData.lockupSupply).toBe(initialFinancialData2.lockupSupply)
        expect(financialData.nextLockupSupply).toBe(initialFinancialData2.nextLockupSupply)
        expect(financialData.laterLockupSupply).toBe(Number(fromNano(withdrawTonNanoAmount)))
        expect(financialData.nextUnstakeRequestIndex).toBe(initialFinancialData2.nextUnstakeRequestIndex! + 1)

        const jettonWalletData = await anyoneJettonWallet.getWalletData()

        expect(jettonWalletData.balance).toBe(Number((initialJettonWalletData.balance - burnJettonAmount).toFixed(10)))

        const burnNotificationTx = findTransactionRequired(result.transactions, {
            from: anyoneJettonWallet.address,
            to: financial.address,
            success: true,
            body: burnNotificationBody,
            exitCode: FinancialErrors.noErrors
        });
        const deployUnstakeRequestTx = findTransactionRequired(result.transactions, {
            from: financial.address,
            to: unstakeRequestAddress,
            value: (x) => {
                return x! <= burnTonAmount
            },
            success: true,
            body: deployUnstakeRequestBody
        });

        printTxGasStats("Burn Notification with forward payload", burnNotificationTx)
        printTxGasStats("Deploy UnstakeRequest with forward payload", deployUnstakeRequestTx)
    })

    it('[op unstake] should throw error if sender is not a unstake request', async () => {
        const lockupPeriod = await financial.getLockupPeriod()
        const epoch = Math.trunc(Math.floor(Date.now() / 1000) / lockupPeriod)
        const withdrawTonAmount = 100;
        const withdrawJettonAmount = 100;
        const newFinancial = blockchain.openContract(await Financial.createFromConfig({
            commissionAddress: commissionWallet.address.toString(),
            adminAddress: admin.address.toString(),
            transactionAdminAddress: transactionAdmin.address.toString(),
            commissionFactor: 50,
            commissionTotalSupply: 0,
            content: {
                name: "test",
                description: "test ton staking jetton",
                symbol: "TEST"
            },
            jettonTotalSupply: 1,
            tonTotalSupply: 1,
            jettonWalletCode: jettonWalletCode,
            unstakeRequestCode: unstakeRequestCode,
            lastLockupEpoch: epoch - 2,
            laterLockupSupply: withdrawJettonAmount,
            nextUnstakeRequestIndex: 1
        }, code))

        const deployer = await blockchain.treasury('deployer1')
        const finDeployResult = await newFinancial.sendDeploy(deployer.getSender(), toNano('1'))

        expect(finDeployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: newFinancial.address,
            deploy: true,
        })

        let financialData = await newFinancial.getFinancialData()
        expect(financialData.tonTotalSupply).toBe(1)
        expect(financialData.jettonTotalSupply).toBe(1)
        expect(financialData.commissionTotalSupply).toBe(0)
        expect(financialData.lastLockupEpoch).toBe(epoch - 2)
        expect(financialData.lockupSupply).toBe(0)
        expect(financialData.nextLockupSupply).toBe(0)
        expect(financialData.laterLockupSupply).toBe(withdrawJettonAmount)
        expect(financialData.nextUnstakeRequestIndex).toBe(1)

        const anyone = await blockchain.treasury('anyone')

        const result = await newFinancial.sendUnstake(anyone.getSender(), toNano('1'), {
            index: 0,
            ownerAddress: anyone.address.toString(),
            withdrawTonAmount,
            withdrawJettonAmount
        })

        expect(result.transactions).toHaveTransaction({
            from: anyone.address,
            to: newFinancial.address,
            body: beginCell()
                .storeUint(FinancialOpcodes.unstake, 32)
                .storeUint(0, 64)
                .storeAddress(anyone.address)
                .storeCoins(toNano(withdrawTonAmount.toString()))
                .storeCoins(toNano(withdrawJettonAmount.toString()))
                .storeMaybeRef(null)
                .endCell(),
            success: false,
            exitCode: FinancialErrors.notFromUnstakeRequest
        })

        financialData = await newFinancial.getFinancialData()
        expect(financialData.tonTotalSupply).toBe(1)
        expect(financialData.jettonTotalSupply).toBe(1)
        expect(financialData.commissionTotalSupply).toBe(0)
        expect(financialData.lastLockupEpoch).toBe(epoch - 2)
        expect(financialData.lockupSupply).toBe(0)
        expect(financialData.nextLockupSupply).toBe(0)
        expect(financialData.laterLockupSupply).toBe(withdrawJettonAmount)
        expect(financialData.nextUnstakeRequestIndex).toBe(1)
    })

    it('[op unstake] should return unstake request if not enough balance', async () => {
        const lockupPeriod = await financial.getLockupPeriod()
        const epoch = Math.trunc(Math.floor(Date.now() / 1000) / lockupPeriod)
        const withdrawTonAmount = 100;
        const withdrawJettonAmount = 100;
        const unstakeRequestIndex = 0;
        const newFinancial = blockchain.openContract(await Financial.createFromConfig({
            commissionAddress: commissionWallet.address.toString(),
            adminAddress: admin.address.toString(),
            transactionAdminAddress: transactionAdmin.address.toString(),
            commissionFactor: 50,
            commissionTotalSupply: 0,
            content: {
                name: "test",
                description: "test ton staking jetton",
                symbol: "TEST"
            },
            jettonTotalSupply: 1,
            tonTotalSupply: 1,
            jettonWalletCode: jettonWalletCode,
            unstakeRequestCode: unstakeRequestCode,
            lastLockupEpoch: epoch - 2,
            laterLockupSupply: withdrawJettonAmount,
            nextUnstakeRequestIndex: unstakeRequestIndex + 1
        }, code))

        const deployer = await blockchain.treasury('deployer1')
        const finDeployResult = await newFinancial.sendDeploy(deployer.getSender(), toNano('3'))

        expect(finDeployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: newFinancial.address,
            deploy: true,
        })

        let financialData = await newFinancial.getFinancialData()
        expect(financialData.tonTotalSupply).toBe(1)
        expect(financialData.jettonTotalSupply).toBe(1)
        expect(financialData.commissionTotalSupply).toBe(0)
        expect(financialData.lastLockupEpoch).toBe(epoch - 2)
        expect(financialData.lockupSupply).toBe(0)
        expect(financialData.nextLockupSupply).toBe(0)
        expect(financialData.laterLockupSupply).toBe(withdrawJettonAmount)
        expect(financialData.nextUnstakeRequestIndex).toBe(unstakeRequestIndex + 1)

        const unstakeRequestAddress = await newFinancial.getUnstakeRequestAddress(unstakeRequestIndex)

        const unstakeRequest = blockchain.openContract(UnstakeRequest.createFromConfig({
            financialAddress: newFinancial.address.toString(),
            index: unstakeRequestIndex
        }, unstakeRequestCode))

        const anyone = await blockchain.treasury('anyone')

        await unstakeRequest.sendDeploy(deployer.getSender(), toNano('0.05'))
        await unstakeRequest.sendInit(blockchain.sender(newFinancial.address), toNano('0.5'), {
            ownerAddress: anyone.address.toString(),
            withdrawTonAmount,
            withdrawJettonAmount,
            unlockTimestamp: 100
        })

        const currentTimestamp = Math.trunc(Math.floor(Date.now() / 1000))

        const result = await newFinancial.sendUnstake(blockchain.sender(unstakeRequestAddress), toNano('0.5'), {
            index: unstakeRequestIndex,
            ownerAddress: anyone.address.toString(),
            withdrawTonAmount,
            withdrawJettonAmount
        })

        expect(result.transactions.length).toBe(2)

        expect(result.transactions).toHaveTransaction({
            from: unstakeRequestAddress,
            to: newFinancial.address,
            body: beginCell()
                .storeUint(FinancialOpcodes.unstake, 32)
                .storeUint(unstakeRequestIndex, 64)
                .storeAddress(anyone.address)
                .storeCoins(toNano(withdrawTonAmount.toString()))
                .storeCoins(toNano(withdrawJettonAmount.toString()))
                .storeMaybeRef(null)
                .endCell(),
            success: true
        })

        expect(result.transactions).toHaveTransaction({
            from: newFinancial.address,
            to: unstakeRequestAddress,
            body: beginCell()
                .storeUint(FinancialOpcodes.returnUnstakeRequest, 32)
                .storeUint(currentTimestamp + lockupPeriod / 2, 32)
                .endCell(),
            success: true
        })

        financialData = await newFinancial.getFinancialData()
        expect(financialData.tonTotalSupply).toBe(1)
        expect(financialData.jettonTotalSupply).toBe(1)
        expect(financialData.commissionTotalSupply).toBe(0)
        expect(financialData.lastLockupEpoch).toBe(epoch - 2)
        expect(financialData.lockupSupply).toBe(0)
        expect(financialData.nextLockupSupply).toBe(0)
        expect(financialData.laterLockupSupply).toBe(withdrawJettonAmount)
        expect(financialData.nextUnstakeRequestIndex).toBe(unstakeRequestIndex + 1)

        const unstakeRequestData = await unstakeRequest.getUnstakeData()
        expect(unstakeRequestData.index).toBe(0)
        expect(unstakeRequestData.financialAddress).toBe(newFinancial.address.toString())
        expect(unstakeRequestData.ownerAddress).toBe(anyone.address.toString())
        expect(unstakeRequestData.withdrawTonAmount).toBe(withdrawTonAmount)
        expect(unstakeRequestData.withdrawJettonAmount).toBe(withdrawJettonAmount)
        expect(unstakeRequestData.unlockTimestamp).toBe(currentTimestamp + lockupPeriod / 2)
    });

    it('[op unstake] should send ton to user (null forward payload)', async () => {
        const lockupPeriod = await financial.getLockupPeriod()
        const epoch = Math.trunc(Math.floor(Date.now() / 1000) / lockupPeriod)
        const withdrawTonAmount = 100;
        const withdrawJettonAmount = 100;
        const unstakeRequestIndex = 0;
        const laterLockupSupply = 1000;
        const newFinancial = blockchain.openContract(await Financial.createFromConfig({
            commissionAddress: commissionWallet.address.toString(),
            adminAddress: admin.address.toString(),
            transactionAdminAddress: transactionAdmin.address.toString(),
            commissionFactor: 50,
            commissionTotalSupply: 0,
            content: {
                name: "test",
                description: "test ton staking jetton",
                symbol: "TEST"
            },
            jettonTotalSupply: 1,
            tonTotalSupply: 1,
            jettonWalletCode: jettonWalletCode,
            unstakeRequestCode: unstakeRequestCode,
            lastLockupEpoch: epoch - 2,
            laterLockupSupply: laterLockupSupply,
            nextUnstakeRequestIndex: unstakeRequestIndex + 1
        }, code))

        const deployer = await blockchain.treasury('deployer1')
        const finDeployResult = await newFinancial.sendDeploy(deployer.getSender(), toNano('1000'))

        expect(finDeployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: newFinancial.address,
            deploy: true,
        })

        let financialData = await newFinancial.getFinancialData()
        expect(financialData.tonTotalSupply).toBe(1)
        expect(financialData.jettonTotalSupply).toBe(1)
        expect(financialData.commissionTotalSupply).toBe(0)
        expect(financialData.lastLockupEpoch).toBe(epoch - 2)
        expect(financialData.lockupSupply).toBe(0)
        expect(financialData.nextLockupSupply).toBe(0)
        expect(financialData.laterLockupSupply).toBe(laterLockupSupply)
        expect(financialData.nextUnstakeRequestIndex).toBe(unstakeRequestIndex + 1)

        const unstakeRequestAddress = await newFinancial.getUnstakeRequestAddress(unstakeRequestIndex)

        const anyone = await blockchain.treasury('anyone')
        const msgValue = 0.5

        const result = await newFinancial.sendUnstake(blockchain.sender(unstakeRequestAddress), toNano(msgValue.toString()), {
            index: unstakeRequestIndex,
            ownerAddress: anyone.address.toString(),
            withdrawTonAmount,
            withdrawJettonAmount
        })

        expect(result.transactions.length).toBe(2)

        const unstakeBody = beginCell()
            .storeUint(FinancialOpcodes.unstake, 32)
            .storeUint(unstakeRequestIndex, 64)
            .storeAddress(anyone.address)
            .storeCoins(toNano(withdrawTonAmount.toString()))
            .storeCoins(toNano(withdrawJettonAmount.toString()))
            .storeMaybeRef(null)
            .endCell()

        expect(result.transactions).toHaveTransaction({
            from: unstakeRequestAddress,
            to: newFinancial.address,
            body: unstakeBody,
            success: true
        })

        const unstakeNotificationBody = beginCell()
            .storeUint(FinancialOpcodes.unstakeNotification, 32)
            .storeUint(0, 64)
            .storeMaybeRef(null)
            .endCell()

        expect(result.transactions).toHaveTransaction({
            from: newFinancial.address,
            to: anyone.address,
            success: true,
            value: (x) => {
                return x! <= toNano(withdrawTonAmount.toString()) + toNano(msgValue.toString())
            },
            body: unstakeNotificationBody
        })

        financialData = await newFinancial.getFinancialData()
        expect(financialData.tonTotalSupply).toBe(1)
        expect(financialData.jettonTotalSupply).toBe(1)
        expect(financialData.commissionTotalSupply).toBe(0)
        expect(financialData.lastLockupEpoch).toBe(Math.trunc(Math.floor(Date.now() / 1000) / lockupPeriod))
        expect(financialData.lockupSupply).toBe(laterLockupSupply - withdrawTonAmount)
        expect(financialData.nextLockupSupply).toBe(0)
        expect(financialData.laterLockupSupply).toBe(0)
        expect(financialData.nextUnstakeRequestIndex).toBe(unstakeRequestIndex + 1)

        const unstakeTx = findTransactionRequired(result.transactions, {
            from: unstakeRequestAddress,
            to: newFinancial.address,
            success: true,
            body: unstakeBody,
            exitCode: FinancialErrors.noErrors
        });

        printTxGasStats("Unstake without forward payload", unstakeTx)
    });

    it('[op unstake] should send ton to user (with forward payload)', async () => {
        const lockupPeriod = await financial.getLockupPeriod()
        const epoch = Math.trunc(Math.floor(Date.now() / 1000) / lockupPeriod)
        const withdrawTonAmount = 100;
        const withdrawJettonAmount = 100;
        const unstakeRequestIndex = 0;
        const laterLockupSupply = 1000;
        const newFinancial = blockchain.openContract(await Financial.createFromConfig({
            commissionAddress: commissionWallet.address.toString(),
            adminAddress: admin.address.toString(),
            transactionAdminAddress: transactionAdmin.address.toString(),
            commissionFactor: 50,
            commissionTotalSupply: 0,
            content: {
                name: "test",
                description: "test ton staking jetton",
                symbol: "TEST"
            },
            jettonTotalSupply: 1,
            tonTotalSupply: 1,
            jettonWalletCode: jettonWalletCode,
            unstakeRequestCode: unstakeRequestCode,
            lastLockupEpoch: epoch - 2,
            laterLockupSupply: laterLockupSupply,
            nextUnstakeRequestIndex: unstakeRequestIndex + 1
        }, code))

        const deployer = await blockchain.treasury('deployer1')
        const finDeployResult = await newFinancial.sendDeploy(deployer.getSender(), toNano('1000'))

        expect(finDeployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: newFinancial.address,
            deploy: true,
        })

        let financialData = await newFinancial.getFinancialData()
        expect(financialData.tonTotalSupply).toBe(1)
        expect(financialData.jettonTotalSupply).toBe(1)
        expect(financialData.commissionTotalSupply).toBe(0)
        expect(financialData.lastLockupEpoch).toBe(epoch - 2)
        expect(financialData.lockupSupply).toBe(0)
        expect(financialData.nextLockupSupply).toBe(0)
        expect(financialData.laterLockupSupply).toBe(laterLockupSupply)
        expect(financialData.nextUnstakeRequestIndex).toBe(unstakeRequestIndex + 1)

        const unstakeRequestAddress = await newFinancial.getUnstakeRequestAddress(unstakeRequestIndex)

        const anyone = await blockchain.treasury('anyone')
        const msgValue = 0.5

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
        const result = await newFinancial.sendUnstake(blockchain.sender(unstakeRequestAddress), toNano(msgValue.toString()), {
            index: unstakeRequestIndex,
            ownerAddress: anyone.address.toString(),
            withdrawTonAmount,
            withdrawJettonAmount,
            forwardPayload
        })

        expect(result.transactions.length).toBe(2)

        const unstakeBody = beginCell()
            .storeUint(FinancialOpcodes.unstake, 32)
            .storeUint(unstakeRequestIndex, 64)
            .storeAddress(anyone.address)
            .storeCoins(toNano(withdrawTonAmount.toString()))
            .storeCoins(toNano(withdrawJettonAmount.toString()))
            .storeMaybeRef(forwardPayload)
            .endCell()

        expect(result.transactions).toHaveTransaction({
            from: unstakeRequestAddress,
            to: newFinancial.address,
            body: unstakeBody,
            success: true
        })

        const unstakeNotificationBody = beginCell()
            .storeUint(FinancialOpcodes.unstakeNotification, 32)
            .storeUint(0, 64)
            .storeMaybeRef(forwardPayload)
            .endCell()

        expect(result.transactions).toHaveTransaction({
            from: newFinancial.address,
            to: anyone.address,
            success: true,
            value: (x) => {
                return x! <= toNano(withdrawTonAmount.toString()) + toNano(msgValue.toString())
            },
            body: unstakeNotificationBody
        })

        financialData = await newFinancial.getFinancialData()
        expect(financialData.tonTotalSupply).toBe(1)
        expect(financialData.jettonTotalSupply).toBe(1)
        expect(financialData.commissionTotalSupply).toBe(0)
        expect(financialData.lastLockupEpoch).toBe(Math.trunc(Math.floor(Date.now() / 1000) / lockupPeriod))
        expect(financialData.lockupSupply).toBe(laterLockupSupply - withdrawTonAmount)
        expect(financialData.nextLockupSupply).toBe(0)
        expect(financialData.laterLockupSupply).toBe(0)
        expect(financialData.nextUnstakeRequestIndex).toBe(unstakeRequestIndex + 1)

        const unstakeTx = findTransactionRequired(result.transactions, {
            from: unstakeRequestAddress,
            to: newFinancial.address,
            success: true,
            body: unstakeBody,
            exitCode: FinancialErrors.noErrors
        });

        printTxGasStats("Unstake with forward payload", unstakeTx)
    });

    it('[refresh lockup config] should throw error when sender sent not enough ton', async () => {
        const lockupPeriod = await financial.getLockupPeriod()
        const lastLockupEpoch = Math.trunc(Math.floor(Date.now() / 1000) / lockupPeriod) - 2

        const lockupSupply = 1000;
        const nextLockupSupply = 100;
        const laterLockupSupply = 1000;
        const newFinancial = blockchain.openContract(await Financial.createFromConfig({
            commissionAddress: commissionWallet.address.toString(),
            adminAddress: admin.address.toString(),
            transactionAdminAddress: transactionAdmin.address.toString(),
            commissionFactor: 50,
            commissionTotalSupply: 0,
            content: {
                name: "test",
                description: "test ton staking jetton",
                symbol: "TEST"
            },
            jettonTotalSupply: 1,
            tonTotalSupply: 1,
            jettonWalletCode: jettonWalletCode,
            unstakeRequestCode: unstakeRequestCode,
            lastLockupEpoch,
            lockupSupply,
            nextLockupSupply,
            laterLockupSupply
        }, code))

        const deployer = await blockchain.treasury('deployer1')
        await newFinancial.sendDeploy(deployer.getSender(), toNano('1000'))

        let financialData = await newFinancial.getFinancialData()
        expect(financialData.lastLockupEpoch).toBe(lastLockupEpoch)
        expect(financialData.lockupSupply).toBe(lockupSupply)
        expect(financialData.nextLockupSupply).toBe(nextLockupSupply)
        expect(financialData.laterLockupSupply).toBe(laterLockupSupply)

        const anyone = await blockchain.treasury('anyone')
        const result = await newFinancial.sendRefreshLockupConfig(anyone.getSender(), toNano("0.005"))

        expect(result.transactions).toHaveTransaction({
            from: anyone.address,
            to: newFinancial.address,
            success: false,
            body: beginCell()
                .storeUint(FinancialOpcodes.refreshLockupConfig, 32)
                .endCell(),
            exitCode: FinancialErrors.insufficientMsgValue
        })

        financialData = await newFinancial.getFinancialData()
        expect(financialData.lastLockupEpoch).toBe(lastLockupEpoch)
        expect(financialData.lockupSupply).toBe(lockupSupply)
        expect(financialData.nextLockupSupply).toBe(nextLockupSupply)
        expect(financialData.laterLockupSupply).toBe(laterLockupSupply)
    });

    it('[refresh lockup config] should refresh lockup token v1', async () => {
        const lockupPeriod = await financial.getLockupPeriod()
        const lastLockupEpoch = Math.trunc(Math.floor(Date.now() / 1000) / lockupPeriod) - 2

        const lockupSupply = 1000;
        const nextLockupSupply = 1000;
        const laterLockupSupply = 1000;
        const newFinancial = blockchain.openContract(await Financial.createFromConfig({
            commissionAddress: commissionWallet.address.toString(),
            adminAddress: admin.address.toString(),
            transactionAdminAddress: transactionAdmin.address.toString(),
            commissionFactor: 50,
            commissionTotalSupply: 0,
            content: {
                name: "test",
                description: "test ton staking jetton",
                symbol: "TEST"
            },
            jettonTotalSupply: 1,
            tonTotalSupply: 1,
            jettonWalletCode: jettonWalletCode,
            unstakeRequestCode: unstakeRequestCode,
            lastLockupEpoch,
            lockupSupply,
            nextLockupSupply,
            laterLockupSupply
        }, code))

        const deployer = await blockchain.treasury('deployer1')
        await newFinancial.sendDeploy(deployer.getSender(), toNano('1000'))

        let financialData = await newFinancial.getFinancialData()
        expect(financialData.lastLockupEpoch).toBe(lastLockupEpoch)
        expect(financialData.lockupSupply).toBe(lockupSupply)
        expect(financialData.nextLockupSupply).toBe(nextLockupSupply)
        expect(financialData.laterLockupSupply).toBe(laterLockupSupply)

        const anyone = await blockchain.treasury('anyone')
        const result = await newFinancial.sendRefreshLockupConfig(anyone.getSender(), toNano("0.05"))

        expect(result.transactions).toHaveTransaction({
            from: anyone.address,
            to: newFinancial.address,
            success: true,
            body: beginCell()
                .storeUint(FinancialOpcodes.refreshLockupConfig, 32)
                .endCell()
        })

        financialData = await newFinancial.getFinancialData()
        expect(financialData.lastLockupEpoch).toBe(Math.trunc(Math.floor(Date.now() / 1000) / lockupPeriod))
        expect(financialData.lockupSupply).toBe(lockupSupply + nextLockupSupply + laterLockupSupply)
        expect(financialData.nextLockupSupply).toBe(0)
        expect(financialData.laterLockupSupply).toBe(0)
    });

    it('[refresh lockup config] should refresh lockup token v2', async () => {
        const lockupPeriod = await financial.getLockupPeriod()
        const lastLockupEpoch = Math.trunc(Math.floor(Date.now() / 1000) / lockupPeriod) - 1

        const lockupSupply = 1000;
        const nextLockupSupply = 100;
        const laterLockupSupply = 1000;
        const newFinancial = blockchain.openContract(await Financial.createFromConfig({
            commissionAddress: commissionWallet.address.toString(),
            adminAddress: admin.address.toString(),
            transactionAdminAddress: transactionAdmin.address.toString(),
            commissionFactor: 50,
            commissionTotalSupply: 0,
            content: {
                name: "test",
                description: "test ton staking jetton",
                symbol: "TEST"
            },
            jettonTotalSupply: 1,
            tonTotalSupply: 1,
            jettonWalletCode: jettonWalletCode,
            unstakeRequestCode: unstakeRequestCode,
            lastLockupEpoch,
            lockupSupply,
            nextLockupSupply,
            laterLockupSupply
        }, code))

        const deployer = await blockchain.treasury('deployer1')
        await newFinancial.sendDeploy(deployer.getSender(), toNano('1000'))

        let financialData = await newFinancial.getFinancialData()
        expect(financialData.lastLockupEpoch).toBe(lastLockupEpoch)
        expect(financialData.lockupSupply).toBe(lockupSupply)
        expect(financialData.nextLockupSupply).toBe(nextLockupSupply)
        expect(financialData.laterLockupSupply).toBe(laterLockupSupply)

        const anyone = await blockchain.treasury('anyone')
        const result = await newFinancial.sendRefreshLockupConfig(anyone.getSender(), toNano("0.05"))

        expect(result.transactions).toHaveTransaction({
            from: anyone.address,
            to: newFinancial.address,
            success: true,
            body: beginCell()
                .storeUint(FinancialOpcodes.refreshLockupConfig, 32)
                .endCell()
        })

        financialData = await newFinancial.getFinancialData()
        expect(financialData.lastLockupEpoch).toBe(Math.trunc(Math.floor(Date.now() / 1000) / lockupPeriod))
        expect(financialData.lockupSupply).toBe(lockupSupply + nextLockupSupply)
        expect(financialData.nextLockupSupply).toBe(laterLockupSupply)
        expect(financialData.laterLockupSupply).toBe(0)
    });

    it('[refresh lockup config] should refresh lockup token v3', async () => {
        const lockupPeriod = await financial.getLockupPeriod()
        const lastLockupEpoch = Math.trunc(Math.floor(Date.now() / 1000) / lockupPeriod)

        const lockupSupply = 1000;
        const nextLockupSupply = 100;
        const laterLockupSupply = 1000;
        const newFinancial = blockchain.openContract(await Financial.createFromConfig({
            commissionAddress: commissionWallet.address.toString(),
            adminAddress: admin.address.toString(),
            transactionAdminAddress: transactionAdmin.address.toString(),
            commissionFactor: 50,
            commissionTotalSupply: 0,
            content: {
                name: "test",
                description: "test ton staking jetton",
                symbol: "TEST"
            },
            jettonTotalSupply: 1,
            tonTotalSupply: 1,
            jettonWalletCode: jettonWalletCode,
            unstakeRequestCode: unstakeRequestCode,
            lastLockupEpoch,
            lockupSupply,
            nextLockupSupply,
            laterLockupSupply
        }, code))

        const deployer = await blockchain.treasury('deployer1')
        await newFinancial.sendDeploy(deployer.getSender(), toNano('1000'))

        let financialData = await newFinancial.getFinancialData()
        expect(financialData.lastLockupEpoch).toBe(lastLockupEpoch)
        expect(financialData.lockupSupply).toBe(lockupSupply)
        expect(financialData.nextLockupSupply).toBe(nextLockupSupply)
        expect(financialData.laterLockupSupply).toBe(laterLockupSupply)

        const anyone = await blockchain.treasury('anyone')
        const result = await newFinancial.sendRefreshLockupConfig(anyone.getSender(), toNano("0.05"))

        expect(result.transactions).toHaveTransaction({
            from: anyone.address,
            to: newFinancial.address,
            success: true,
            body: beginCell()
                .storeUint(FinancialOpcodes.refreshLockupConfig, 32)
                .endCell()
        })

        financialData = await newFinancial.getFinancialData()
        expect(financialData.lastLockupEpoch).toBe(lastLockupEpoch)
        expect(financialData.lockupSupply).toBe(lockupSupply)
        expect(financialData.nextLockupSupply).toBe(nextLockupSupply)
        expect(financialData.laterLockupSupply).toBe(laterLockupSupply)
    });
})
