import {Address, beginCell, Cell, fromNano, Slice, toNano} from '@ton/core'
import {compile, NetworkProvider, sleep} from '@ton/blueprint'
import {NominatorProxy} from "../wrappers/NominatorProxy";
import {Financial} from "../wrappers/Financial";
import {NominatorPool} from "../wrappers/NominatorPool";
import {mnemonicNew, mnemonicToPrivateKey} from "ton-crypto";
import {JettonWallet} from "../wrappers/JettonWallet";
import {UnstakeRequest} from "../wrappers/UnstakeRequest";
import {TonClient} from "@ton/ton";

export async function run(provider: NetworkProvider) {

    // const mnemo = await mnemonicNew(24)
    // console.log(mnemo.join(" "))
    // const keyPair = await mnemonicToPrivateKey(mnemo)
    // console.log(keyPair.publicKey.toString("hex"))
    // const wallet = WalletContractV3R2.create({workchain: 0, publicKey: keyPair.publicKey})
    // console.log(wallet.address.toString({bounceable: true}))
    // console.log(wallet.address.toString({bounceable: false}))
    //const proxy = provider.open(NominatorProxy.createFromAddress(Address.parse("EQBI6pbgQb4O5CZ-qL9m55I3RnCWU4nmNxNtfReLUbQgyq7S")))
    // const pool = provider.open(NominatorPool.createFromAddress(Address.parse("EQC7eUPyUIoiXycPuhKbqT2qw7RLR13pxYfu99t5GqQWhbpW")))
    // await proxy.sendTonToNominatorProxy(provider.sender(), toNano("0.6"))
    // console.log(await proxy.getProxyData())
    // //
    // // await proxy.sendTonToFinancial(provider.sender(), toNano("0.05"))
    // await sleep(8000)
    // console.log(await proxy.getProxyData())
    // console.log(await pool.getNominatorList())
    //
    // let mnemonics = []
    // for (let i = 0; i < 3; i++) {
    //     const mnemonic = await mnemonicNew(24)
    //     mnemonics.push(mnemonic.join(" "))
    // }
    //
    // console.log(mnemonics)

    const unstake = provider.open(UnstakeRequest.createFromAddress(Address.parse("")))
    // console.log(await unstake.getUnstakeData())

    await unstake.sendVestingUnstake(provider.sender(), toNano("0.1"))

    // const cell = Cell.fromBase64('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')
    //
    // const bCell = await compile("Financial")
    //
    // console.log(cell.hash().toString() == bCell.hash().toString())


    //const fin = provider.open(Financial.createFromAddress(Address.parse("EQDNhy-nxYFgUqzfUzImBEP67JqsyMIcyk2S5_RwNNEYku0k")))
    // console.log(await fin.getFinancialData())

    // const jettonWallet = provider.open(JettonWallet.createFromAddress(Address.parse("EQDgnSA7bwWIQAj7TA9W5adbwuy9-wjw1xb9AditKUjQPekm")))
    //
    // await jettonWallet.sendTransfer(provider.sender(), toNano("0.16"), {
    //     jettonAmount: 100,
    //     toOwnerAddress: "EQD-2liSGT5swkxY0xHZExIQMUJ5MDIgPYZI5fJnqOmYSd_Z",
    //     responseAddress: "EQCEuIGH8I2bkAf8rLpuxkWmDJ_xZedEHDvjs6aCAN2FrkFp",
    //     forwardTonAmount: 0.12,
    // })

    // const pool = provider.open(NominatorPool.createFromAddress(Address.parse('Ef9bWSTLQneJVBx_dzjwr0lmTEKFoMXoUXCNGhrbMNyOPcUb')))
    // // await pool.sendUpdateValidatorSet(provider.sender(), toNano('1'))
    // await pool.sendRecoveryStake(provider.sender(), toNano('1'))
    //
    //await fin.sendTonWithReward(provider.sender(), toNano("0.5"), {reward: 0})

    // const a = await fetchJettonWalletAddress("UQAQQTyWQnLTmerS0GWQYrFYtLogGuXAW_kG5gw-50RVpMge","EQAvlWFDxGF2lXm67y4yzC17wYKD9A0guwPkMs1gOsM__NOT")
    // console.log(a)
    // const b = await getJettonBalance(a)
    // console.log(b)
}

export const fetchJettonWalletAddress = async(userAddress: string, jettonAddress: string) => {
    const client = new TonClient({
        endpoint: 'https://toncenter.bemo.finance/jsonRPC',
    });

    const address = Address.parse(userAddress);
    const cell = beginCell().storeAddress(address).endCell();
    const result = await client.runMethod(Address.parse(jettonAddress), 'get_wallet_address', [{
        type: 'slice',
        cell,
    }]);

    return result.stack.readAddress().toString();
};

export const getJettonBalance = async(address: string) => {
    const client = new TonClient({
        endpoint: 'https://toncenter.bemo.finance/jsonRPC',
    });

    const result = await client.runMethod(Address.parse(address), 'get_wallet_data', []);
    console.log(result)
    return Number(fromNano(result.stack.readNumber()));
};



