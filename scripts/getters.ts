import {Address, toNano} from 'ton-core'
import {NetworkProvider, sleep} from '@ton-community/blueprint'
import {NominatorProxy} from "../wrappers/NominatorProxy";
import {Financial} from "../wrappers/Financial";
import {NominatorPool} from "../wrappers/NominatorPool";
import {mnemonicNew, mnemonicToPrivateKey} from "ton-crypto";

export async function run(provider: NetworkProvider) {
    const proxy = provider.open(NominatorProxy.createFromAddress(Address.parse("EQBI6pbgQb4O5CZ-qL9m55I3RnCWU4nmNxNtfReLUbQgyq7S")))
    // const pool = provider.open(NominatorPool.createFromAddress(Address.parse("Ef9Q3y_JQr7uIoB6uKKFXhcpCwnIq4nUP-eDdVuQYdYsUERp")))
    await proxy.sendTonToNominatorProxy(provider.sender(), toNano("0.6"))
    console.log(await proxy.getProxyData())
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

    // const fin = provider.open(Financial.createFromAddress(Address.parse("EQBRwApRPlpMzxdrugjAIdwKYIua19xMtUlhI-Qa6GpbWajC")))
    // console.log(await fin.getFinancialData())
}

