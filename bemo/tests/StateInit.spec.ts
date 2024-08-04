import {Blockchain, SandboxContract} from '@ton/sandbox'
import {Address, beginCell, Cell, Dictionary, storeStateInit, toNano} from '@ton/core'
import {Financial} from '../wrappers/Financial'
import '@ton/test-utils'
import {compile} from '@ton/blueprint'
import {JettonWallet, JettonWalletOpCodes} from "../wrappers/JettonWallet";
import {UnstakeRequest, UnstakeRequestOpCodes} from "../wrappers/UnstakeRequest";
import {collectCellStats} from "./GasUtils";

describe('Financial', () => {
    let code: Cell
    let blockchain: Blockchain
    let jettonWalletCode: Cell
    let unstakeRequestCode: Cell
    let financial: SandboxContract<Financial>


    let userWallet: (address: Address) => Promise<SandboxContract<JettonWallet>>;
    let indexUnstakeRequest: (index: number) => Promise<SandboxContract<UnstakeRequest>>;

    beforeAll(async () => {
        code = await compile('Financial')
    })

    beforeEach(async () => {
        blockchain = await Blockchain.create()

        const admin = await blockchain.treasury('admin')
        const transactionAdmin = await blockchain.treasury('transactionAdmin')
        const commissionWallet = await blockchain.treasury('commissionAddress')

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

        userWallet = async (address: Address) => blockchain.openContract(
            JettonWallet.createFromAddress(
                await financial.getWalletAddress(address.toString())
            )
        );

        indexUnstakeRequest = async (index: number) => blockchain.openContract(
            UnstakeRequest.createFromAddress(
                await financial.getUnstakeRequestAddress(index)
            )
        );
    })

    it('collect stats for financial', async () => {
        const smc = await blockchain.getContract(financial.address);
        if (smc.accountState === undefined)
            throw new Error("Can't access wallet account state");
        if (smc.accountState.type !== "active")
            throw new Error("Wallet account is not active");
        if (smc.account.account === undefined || smc.account.account === null)
            throw new Error("Can't access wallet account!");
        console.log("Financial max storage stats:", smc.account.account.storageStats.used);
        const state = smc.accountState.state;
        const stateCell = beginCell().store(storeStateInit(state)).endCell();
        console.log("Financial state init stats:", collectCellStats(stateCell, []));
    })

    it('collect stats for jetton wallet', async () => {
        const deployer = await blockchain.treasury('deployer')
        await financial.sendAcceptTon(deployer.getSender(), toNano('10'))
        const tonValue = toNano("100");
        const deployerWallet = await userWallet(deployer.address);
        const res = await financial.sendTonToFinancial(
            deployer.getSender(),
            tonValue
        );
        expect(res.transactions).toHaveTransaction({
            to: deployerWallet.address,
            op: JettonWalletOpCodes.internalTransfer,
            success: true,
        });

        const smc = await blockchain.getContract(deployerWallet.address);
        if (smc.accountState === undefined)
            throw new Error("Can't access wallet account state");
        if (smc.accountState.type !== "active")
            throw new Error("Wallet account is not active");
        if (smc.account.account === undefined || smc.account.account === null)
            throw new Error("Can't access wallet account!");
        console.log("Jetton wallet max storage stats:", smc.account.account.storageStats.used);
        const state = smc.accountState.state;
        const stateCell = beginCell().store(storeStateInit(state)).endCell();
        console.log("State init stats:", collectCellStats(stateCell, []));
    });

    it('collect stats for unstake request', async () => {
        const anyone = await blockchain.treasury('anyone')

        const tonAmount = toNano("101")
        await financial.sendTonToFinancial(anyone.getSender(), tonAmount)

        const reward = 10
        await financial.sendTonWithReward(anyone.getSender(), toNano(100), {reward})

        const anyoneJettonWalletAddress = await financial.getWalletAddress(anyone.address.toString())
        const anyoneJettonWallet = blockchain.openContract(await JettonWallet.createFromAddress(anyoneJettonWalletAddress))
        await anyoneJettonWallet.sendReceive(blockchain.sender(financial.address), toNano('0.05'), {jettonAmount: 100})

        const burnJettonAmount = 100
        const burnTonAmount = toNano(1)
        const forwardPayload = beginCell()
            .storeUint(0,32)
            .storeUint(0,64)
            .storeCoins(0n)
            .storeMaybeRef(
                beginCell()
                    .storeUint(0,32)
                    .storeUint(0,64)
                    .storeCoins(0n)
                    .storeCoins(0n)
                    .endCell()
            ).endCell()

        console.log("forwardPayload stats:", collectCellStats(forwardPayload, []));
        const result = await anyoneJettonWallet.sendBurn(anyone.getSender(), burnTonAmount, {
            jettonAmount: burnJettonAmount,
            receiverAddress: anyone.address.toString(),
            forwardPayload
        })

        const unstakeRequest = await indexUnstakeRequest(0);

        expect(result.transactions).toHaveTransaction({
            to: unstakeRequest.address,
            op: UnstakeRequestOpCodes.deploy,
            success: true,
        });

        const smc = await blockchain.getContract(unstakeRequest.address);
        if (smc.accountState === undefined)
            throw new Error("Can't access cоntract state");
        if (smc.accountState.type !== "active")
            throw new Error("Contract is not active");
        if (smc.account.account === undefined || smc.account.account === null)
            throw new Error("Can't access wallet account!");
        console.log("Unstake storage stats:", smc.account.account.storageStats.used);
        const state = smc.accountState.state;
        const stateCell = beginCell().store(storeStateInit(state)).endCell();
        console.log("State init stats:", collectCellStats(stateCell, []));

    });
})
